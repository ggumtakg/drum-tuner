import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MicEngine,
  type MicEngineError,
  type MicEngineStatus,
} from './audio/micEngine.ts';
import { BottomNav, type AppTab } from './components/BottomNav.tsx';
import { InputMeter } from './components/InputMeter.tsx';
import { KitsTab } from './components/KitsTab.tsx';
import { KitStepBar } from './components/KitStepBar.tsx';
import { NoiseSettingsPanel } from './components/NoiseSettingsPanel.tsx';
import { PresetsTab } from './components/PresetsTab.tsx';
import { TargetHeader } from './components/TargetHeader.tsx';
import { TuningGauge, type HitNoticeKind } from './components/TuningGauge.tsx';
import {
  evaluateTuning,
  type DrumHitResult,
  type FrameAnalysisResult,
} from './dsp/index.ts';
import {
  addKit,
  addPreset,
  deleteKit,
  deletePreset,
  loadState,
  saveState,
  updateKit,
  updateLastSelection,
  updatePreset,
  updateSettings,
  type DrumKit,
  type DrumPreset,
  type PersistedState,
  type TunerSettings,
} from './storage/tunerStore.ts';

const METER_THROTTLE_MS = 50;

interface LiveMeterState {
  levelDb: number;
  noiseFloorDb: number;
}

interface ActiveTuningContext {
  targetHz: number;
  toleranceHz: number;
  kitId: string | null;
  kitIndex: number | null;
  kitPresetId: string | null;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '입력 값을 확인해 주세요.';
}

export function App() {
  const [state, setState] = useState<PersistedState>(() => loadState());
  const [activeTab, setActiveTab] = useState<AppTab>('tuner');

  // Temporary Hz override when nudging frequency inside kit mode without mutating the preset
  const [kitTempTargetHz, setKitTempTargetHz] = useState<number | null>(null);

  // Ephemeral session state for tuner feedback and kit completion checkmarks
  const [heldHit, setHeldHit] = useState<DrumHitResult | null>(null);
  const [hitNotice, setHitNotice] = useState<HitNoticeKind>(null);
  const [tunedPresetIds, setTunedPresetIds] = useState<Set<string>>(() => new Set());

  // Mic & live meter state
  const [micStatus, setMicStatus] = useState<MicEngineStatus>('idle');
  const [micError, setMicError] = useState<MicEngineError | null>(null);
  const [meter, setMeter] = useState<LiveMeterState>({ levelDb: -96, noiseFloorDb: -60 });
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationNotice, setCalibrationNotice] = useState<string | null>(null);

  // Persist every state change to localStorage
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Resolve active presets & kit from canonical persisted state
  const presetMap = useMemo(
    () => new Map(state.presets.map((preset) => [preset.id, preset])),
    [state.presets],
  );

  const activeKit = useMemo(() => {
    if (!state.lastSelection.activeKitId) {
      return null;
    }
    return state.kits.find((kit) => kit.id === state.lastSelection.activeKitId) ?? null;
  }, [state.kits, state.lastSelection.activeKitId]);

  const activeKitPresets = useMemo(() => {
    if (!activeKit) {
      return [];
    }
    return activeKit.presetIds
      .map((id) => presetMap.get(id))
      .filter((preset): preset is DrumPreset => Boolean(preset));
  }, [activeKit, presetMap]);

  const isKitMode =
    state.lastSelection.mode === 'kit' && activeKit !== null && activeKitPresets.length > 0;

  const safeKitIndex = isKitMode
    ? Math.max(0, Math.min(activeKitPresets.length - 1, state.lastSelection.activeKitIndex))
    : 0;

  const activeKitPreset = isKitMode ? activeKitPresets[safeKitIndex] : null;
  const activeSinglePreset =
    !isKitMode && state.lastSelection.activePresetId !== null
      ? presetMap.get(state.lastSelection.activePresetId) ?? null
      : null;

  const activePreset = isKitMode ? activeKitPreset : activeSinglePreset;

  const activeTargetHz = isKitMode
    ? (kitTempTargetHz ?? activeKitPreset?.targetHz ?? state.lastSelection.manualTargetHz)
    : (activeSinglePreset?.targetHz ?? state.lastSelection.manualTargetHz);

  const isTemporaryOverride =
    isKitMode &&
    kitTempTargetHz !== null &&
    activeKitPreset !== null &&
    Math.abs(kitTempTargetHz - activeKitPreset.targetHz) >= 0.05;

  // Keep latest tuning context accessible to audio callbacks without recreating the engine
  const tuningContextRef = useRef<ActiveTuningContext>({
    targetHz: activeTargetHz,
    toleranceHz: state.settings.toleranceHz,
    kitId: isKitMode && activeKit ? activeKit.id : null,
    kitIndex: isKitMode && activeKit ? safeKitIndex : null,
    kitPresetId: activeKitPreset?.id ?? null,
  });

  tuningContextRef.current = {
    targetHz: activeTargetHz,
    toleranceHz: state.settings.toleranceHz,
    kitId: isKitMode && activeKit ? activeKit.id : null,
    kitIndex: isKitMode && activeKit ? safeKitIndex : null,
    kitPresetId: activeKitPreset?.id ?? null,
  };

  const lastMeterUpdateRef = useRef<number>(0);
  const micEngineRef = useRef<MicEngine | null>(null);

  const handleAudioFrame = useCallback((frame: FrameAnalysisResult) => {
    const now = performance.now();

    setIsCalibrating(frame.isCalibrating);

    if (frame.calibrationResult) {
      const { noiseFloorDb, recommendedGateThresholdDb } = frame.calibrationResult;
      setCalibrationProgress(0);
      setState((prev) =>
        updateSettings(prev, { gateThresholdDb: recommendedGateThresholdDb }),
      );
      setCalibrationNotice(
        `주변 소음 ${Math.round(noiseFloorDb)} dB 측정 완료 · 게이트 ${recommendedGateThresholdDb} dB 자동 적용`,
      );
    } else if (frame.isCalibrating) {
      if (now - lastMeterUpdateRef.current >= METER_THROTTLE_MS) {
        setCalibrationProgress(frame.calibrationProgress);
      }
    } else {
      setCalibrationProgress(0);
    }

    if (frame.hit) {
      if (frame.hit.status === 'valid' && frame.hit.measuredHz !== null) {
        setHeldHit(frame.hit);
        setHitNotice(null);

        const ctx = tuningContextRef.current;
        if (ctx.kitId && ctx.kitPresetId && ctx.kitIndex !== null) {
          const evalResult = evaluateTuning(
            frame.hit.measuredHz,
            ctx.targetHz,
            ctx.toleranceHz,
          );
          if (evalResult.status === 'in-tune') {
            const key = `${ctx.kitId}:${ctx.kitIndex}:${ctx.kitPresetId}`;
            setTunedPresetIds((prev) => {
              if (prev.has(key)) {
                return prev;
              }
              const next = new Set(prev);
              next.add(key);
              return next;
            });
          }
        }
      } else if (frame.hit.status === 'clipped') {
        setHitNotice('clipped');
      } else if (frame.hit.status === 'low-confidence') {
        setHitNotice('low-confidence');
      }
    }

    if (now - lastMeterUpdateRef.current >= METER_THROTTLE_MS) {
      lastMeterUpdateRef.current = now;
      setMeter({
        levelDb: frame.levelDb,
        noiseFloorDb: frame.noiseFloorDb,
      });
    }
  }, []);

  // Initialize MicEngine once and clean up completely on unmount
  useEffect(() => {
    const engine = new MicEngine(
      {
        targetHz: tuningContextRef.current.targetHz,
        gateThresholdDb: state.settings.gateThresholdDb,
        targetFilterEnabled: state.settings.targetFilterEnabled,
        targetFilterSpanPct: state.settings.targetFilterSpanPct,
      },
      {
        onFrame: handleAudioFrame,
        onStatusChange: (status) => {
          setMicStatus(status);
          if (status === 'running') {
            setMicError(null);
          } else if (status === 'idle' || status === 'error') {
            setIsCalibrating(false);
            setCalibrationProgress(0);
            if (status === 'idle') {
              setMeter({ levelDb: -96, noiseFloorDb: -60 });
            }
          }
        },
        onError: (error) => {
          setMicError(error);
          setIsCalibrating(false);
          setCalibrationProgress(0);
        },
      },
    );

    micEngineRef.current = engine;

    return () => {
      engine.stop();
      micEngineRef.current = null;
    };
    // Intentionally initialize engine once; dynamic config updates are synced below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleAudioFrame]);

  // Sync DSP analyzer configuration whenever target Hz or settings change
  useEffect(() => {
    micEngineRef.current?.updateConfig({
      targetHz: activeTargetHz,
      gateThresholdDb: state.settings.gateThresholdDb,
      targetFilterEnabled: state.settings.targetFilterEnabled,
      targetFilterSpanPct: state.settings.targetFilterSpanPct,
    });
  }, [
    activeTargetHz,
    state.settings.gateThresholdDb,
    state.settings.targetFilterEnabled,
    state.settings.targetFilterSpanPct,
  ]);

  const clearMeasurement = useCallback(() => {
    setHeldHit(null);
    setHitNotice(null);
    micEngineRef.current?.clearCapture();
  }, []);

  const handleToggleMic = useCallback(async () => {
    const engine = micEngineRef.current;
    if (!engine) {
      return;
    }
    if (engine.isRunning()) {
      engine.stop();
      return;
    }
    setMicError(null);
    await engine.start();
  }, []);

  const handleRetryMic = useCallback(async () => {
    const engine = micEngineRef.current;
    if (!engine) {
      return;
    }
    setMicError(null);
    engine.stop();
    await engine.start();
  }, []);

  const handleStartCalibration = useCallback(async () => {
    const engine = micEngineRef.current;
    if (!engine) {
      return;
    }
    setCalibrationNotice(null);
    setMicError(null);

    if (!engine.isRunning()) {
      const started = await engine.start();
      if (!started) {
        return;
      }
    }

    if (engine.startCalibration(2000)) {
      setIsCalibrating(true);
      setCalibrationProgress(0);
    }
  }, []);

  const handleCancelCalibration = useCallback(() => {
    micEngineRef.current?.cancelCalibration();
    setIsCalibrating(false);
    setCalibrationProgress(0);
  }, []);

  const handleUpdateSettings = useCallback((patch: Partial<TunerSettings>) => {
    setState((prev) => {
      try {
        return updateSettings(prev, patch);
      } catch {
        return prev;
      }
    });
  }, []);

  // Target frequency changes in Tuner tab
  const handleChangeTargetHz = useCallback(
    (nextHz: number) => {
      if (isKitMode && activeKitPreset) {
        if (Math.abs(nextHz - activeKitPreset.targetHz) < 0.05) {
          setKitTempTargetHz(null);
        } else {
          setKitTempTargetHz(nextHz);
        }
        return;
      }

      setState((prev) =>
        updateLastSelection(prev, {
          mode: 'single',
          activePresetId: null,
          manualTargetHz: nextHz,
        }),
      );
    },
    [isKitMode, activeKitPreset],
  );

  // Quick-save preset from Tuner tab
  const handleQuickSavePreset = useCallback(
    (name: string, targetHz: number): string | null => {
      try {
        const nextWithPreset = addPreset(state, { name, targetHz });
        const created = nextWithPreset.presets[nextWithPreset.presets.length - 1];
        if (!isKitMode && created) {
          setState(
            updateLastSelection(nextWithPreset, {
              mode: 'single',
              activePresetId: created.id,
              manualTargetHz: created.targetHz,
            }),
          );
        } else {
          setState(nextWithPreset);
        }
        return null;
      } catch (err) {
        return getErrorMessage(err);
      }
    },
    [state, isKitMode],
  );

  // Kit navigation
  const handleSelectKitIndex = useCallback(
    (index: number) => {
      if (!activeKit || activeKitPresets.length === 0) {
        return;
      }
      const clamped = Math.max(0, Math.min(activeKitPresets.length - 1, index));
      const nextPreset = activeKitPresets[clamped];
      setKitTempTargetHz(null);
      clearMeasurement();
      setState((prev) =>
        updateLastSelection(prev, {
          mode: 'kit',
          activeKitId: activeKit.id,
          activeKitIndex: clamped,
          activePresetId: nextPreset.id,
          manualTargetHz: nextPreset.targetHz,
        }),
      );
    },
    [activeKit, activeKitPresets, clearMeasurement],
  );

  const handleExitKitMode = useCallback(() => {
    const keepPresetId = !isTemporaryOverride && activeKitPreset ? activeKitPreset.id : null;
    const keepHz = activeTargetHz;
    setKitTempTargetHz(null);
    setState((prev) =>
      updateLastSelection(prev, {
        mode: 'single',
        activePresetId: keepPresetId,
        manualTargetHz: keepHz,
      }),
    );
  }, [isTemporaryOverride, activeKitPreset, activeTargetHz]);

  // Preset CRUD
  const handleAddPreset = useCallback(
    (name: string, targetHz: number): string | null => {
      try {
        const next = addPreset(state, { name, targetHz });
        setState(next);
        return null;
      } catch (err) {
        return getErrorMessage(err);
      }
    },
    [state],
  );

  const handleUpdatePreset = useCallback(
    (id: string, name: string, targetHz: number): string | null => {
      try {
        const next = updatePreset(state, id, { name, targetHz });
        setState(next);
        setKitTempTargetHz(null);
        // Clear session tuned checkmarks for this preset since its target may have changed
        setTunedPresetIds((prev) => {
          let changed = false;
          const updated = new Set<string>();
          for (const key of prev) {
            if (key.endsWith(`:${id}`)) {
              changed = true;
            } else {
              updated.add(key);
            }
          }
          return changed ? updated : prev;
        });
        return null;
      } catch (err) {
        return getErrorMessage(err);
      }
    },
    [state],
  );

  const handleDeletePreset = useCallback((id: string) => {
    setKitTempTargetHz(null);
    setState((prev) => deletePreset(prev, id));
  }, []);

  const handleSelectPreset = useCallback(
    (preset: DrumPreset) => {
      setKitTempTargetHz(null);
      clearMeasurement();
      setState((prev) =>
        updateLastSelection(prev, {
          mode: 'single',
          activePresetId: preset.id,
          manualTargetHz: preset.targetHz,
        }),
      );
      setActiveTab('tuner');
    },
    [clearMeasurement],
  );

  // Kit CRUD
  const handleAddKit = useCallback(
    (name: string, presetIds: string[]): string | null => {
      try {
        const next = addKit(state, { name, presetIds });
        setState(next);
        return null;
      } catch (err) {
        return getErrorMessage(err);
      }
    },
    [state],
  );

  const handleUpdateKit = useCallback(
    (id: string, name: string, presetIds: string[]): string | null => {
      try {
        const next = updateKit(state, id, { name, presetIds });
        setState(next);
        setTunedPresetIds((prev) => {
          let changed = false;
          const updated = new Set<string>();
          for (const key of prev) {
            if (key.startsWith(`${id}:`)) {
              changed = true;
            } else {
              updated.add(key);
            }
          }
          return changed ? updated : prev;
        });
        return null;
      } catch (err) {
        return getErrorMessage(err);
      }
    },
    [state],
  );

  const handleDeleteKit = useCallback((id: string) => {
    setKitTempTargetHz(null);
    setState((prev) => deleteKit(prev, id));
    setTunedPresetIds((prev) => {
      let changed = false;
      const updated = new Set<string>();
      for (const key of prev) {
        if (key.startsWith(`${id}:`)) {
          changed = true;
        } else {
          updated.add(key);
        }
      }
      return changed ? updated : prev;
    });
  }, []);

  const handleStartKitTuning = useCallback(
    (kit: DrumKit) => {
      const firstPresetId = kit.presetIds.find((id) => presetMap.has(id));
      if (!firstPresetId) {
        return;
      }
      const firstPreset = presetMap.get(firstPresetId)!;
      setKitTempTargetHz(null);
      clearMeasurement();
      setState((prev) =>
        updateLastSelection(prev, {
          mode: 'kit',
          activeKitId: kit.id,
          activeKitIndex: 0,
          activePresetId: firstPreset.id,
          manualTargetHz: firstPreset.targetHz,
        }),
      );
      setActiveTab('tuner');
    },
    [presetMap, clearMeasurement],
  );

  return (
    <div className="app-shell">
      <main className="app-main">
        {activeTab === 'tuner' && (
          <div className="tab-stack">
            {isKitMode && activeKit && (
              <KitStepBar
                kit={activeKit}
                kitPresets={activeKitPresets}
                activeIndex={safeKitIndex}
                tunedPresetIds={tunedPresetIds}
                onSelectIndex={handleSelectKitIndex}
                onExitKitMode={handleExitKitMode}
              />
            )}

            <TargetHeader
              mode={isKitMode ? 'kit' : 'single'}
              activePresetName={activePreset?.name ?? null}
              targetHz={activeTargetHz}
              isTemporaryOverride={isTemporaryOverride}
              onChangeTargetHz={handleChangeTargetHz}
              onQuickSavePreset={handleQuickSavePreset}
            />

            <TuningGauge
              targetHz={activeTargetHz}
              toleranceHz={state.settings.toleranceHz}
              heldHit={heldHit}
              hitNotice={hitNotice}
              isMicRunning={micStatus === 'running'}
              onResetMeasurement={clearMeasurement}
            />

            <InputMeter
              micStatus={micStatus}
              micError={micError}
              levelDb={meter.levelDb}
              noiseFloorDb={meter.noiseFloorDb}
              gateThresholdDb={state.settings.gateThresholdDb}
              isCalibrating={isCalibrating}
              onToggleMic={() => {
                void handleToggleMic();
              }}
              onRetryMic={() => {
                void handleRetryMic();
              }}
            />

            <NoiseSettingsPanel
              settings={state.settings}
              targetHz={activeTargetHz}
              isCalibrating={isCalibrating}
              calibrationProgress={calibrationProgress}
              calibrationNotice={calibrationNotice}
              onStartCalibration={() => {
                void handleStartCalibration();
              }}
              onCancelCalibration={handleCancelCalibration}
              onUpdateSettings={handleUpdateSettings}
            />
          </div>
        )}

        {activeTab === 'presets' && (
          <PresetsTab
            presets={state.presets}
            kits={state.kits}
            activePresetId={isKitMode ? activeKitPreset?.id ?? null : state.lastSelection.activePresetId}
            onAddPreset={handleAddPreset}
            onUpdatePreset={handleUpdatePreset}
            onDeletePreset={handleDeletePreset}
            onSelectPreset={handleSelectPreset}
          />
        )}

        {activeTab === 'kits' && (
          <KitsTab
            kits={state.kits}
            presets={state.presets}
            activeKitId={state.lastSelection.activeKitId}
            isKitMode={isKitMode}
            onAddKit={handleAddKit}
            onUpdateKit={handleUpdateKit}
            onDeleteKit={handleDeleteKit}
            onStartKitTuning={handleStartKitTuning}
          />
        )}
      </main>

      <BottomNav
        activeTab={activeTab}
        isMicRunning={micStatus === 'running'}
        presetCount={state.presets.length}
        kitCount={state.kits.length}
        onSelectTab={setActiveTab}
      />
    </div>
  );
}

export default App;
