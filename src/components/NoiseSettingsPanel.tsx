import { useState } from 'react';
import { computeBandpassRange } from '../dsp/index.ts';
import {
  MAX_GATE_THRESHOLD_DB,
  MAX_TARGET_FILTER_SPAN_PCT,
  MAX_TOLERANCE_HZ,
  MIN_GATE_THRESHOLD_DB,
  MIN_TARGET_FILTER_SPAN_PCT,
  MIN_TOLERANCE_HZ,
  type TunerSettings,
} from '../storage/tunerStore.ts';

export interface NoiseSettingsPanelProps {
  settings: TunerSettings;
  targetHz: number;
  isCalibrating: boolean;
  calibrationProgress: number;
  calibrationNotice: string | null;
  onStartCalibration: () => void;
  onCancelCalibration: () => void;
  onUpdateSettings: (patch: Partial<TunerSettings>) => void;
}

const QUICK_TOLERANCES = [0.5, 1.0, 2.0] as const;

export function NoiseSettingsPanel({
  settings,
  targetHz,
  isCalibrating,
  calibrationProgress,
  calibrationNotice,
  onStartCalibration,
  onCancelCalibration,
  onUpdateSettings,
}: NoiseSettingsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const activeBand = computeBandpassRange({
    targetHz,
    targetFilterEnabled: settings.targetFilterEnabled,
    targetFilterSpanPct: settings.targetFilterSpanPct,
  });

  const progressPct = Math.round(Math.max(0, Math.min(1, calibrationProgress)) * 100);

  return (
    <section className="card settings-panel" aria-label="소음 억제 및 튜닝 설정">
      <button
        type="button"
        className="settings-toggle-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="settings-toggle-info">
          <strong>소음 · 튜닝 설정</strong>
          <span className="settings-summary-text tabular">
            게이트 {settings.gateThresholdDb}dB · 대역필터{' '}
            {settings.targetFilterEnabled ? `±${settings.targetFilterSpanPct}%` : 'OFF'} · ±
            {settings.toleranceHz.toFixed(1)}Hz
          </span>
        </div>
        <span className="settings-chevron" aria-hidden="true">
          {expanded ? '접기 ▲' : '열기 ▼'}
        </span>
      </button>

      {/* Keep active calibration progress or completion banner visible even if collapsed */}
      {isCalibrating && (
        <div className="calibration-banner" role="status" aria-live="polite">
          <div className="calibration-banner-top">
            <span>주변 소음 측정 중 ({progressPct}%) — 잠시 타격을 멈춰 주세요</span>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={onCancelCalibration}
            >
              취소
            </button>
          </div>
          <div className="calibration-progress-track">
            <div
              className="calibration-progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {!isCalibrating && calibrationNotice && (
        <p className="field-success settings-notice" role="status">
          {calibrationNotice}
        </p>
      )}

      {expanded && (
        <div className="settings-body">
          {/* 1. Ambient noise 2s calibration */}
          <div className="setting-group">
            <div className="setting-row-between">
              <div>
                <div className="setting-label">주변 소음 자동 측정</div>
                <p className="setting-help">
                  2초간 주변 악기·대화 소음을 측정해 권장 노이즈 게이트를 자동 설정합니다.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                disabled={isCalibrating}
                onClick={onStartCalibration}
              >
                {isCalibrating ? '측정 중...' : '주변 소음 측정 (2초)'}
              </button>
            </div>
          </div>

          {/* 2. Noise gate threshold slider */}
          <div className="setting-group">
            <div className="setting-row-between">
              <label htmlFor="gate-threshold-slider" className="setting-label">
                노이즈 게이트 감도
              </label>
              <strong className="setting-value tabular">{settings.gateThresholdDb} dB</strong>
            </div>
            <input
              id="gate-threshold-slider"
              type="range"
              min={MIN_GATE_THRESHOLD_DB}
              max={MAX_GATE_THRESHOLD_DB}
              step={1}
              value={settings.gateThresholdDb}
              onChange={(e) =>
                onUpdateSettings({ gateThresholdDb: Number(e.target.value) })
              }
              className="range-slider"
            />
            <div className="range-labels">
              <span>민감 ({MIN_GATE_THRESHOLD_DB} dB)</span>
              <span>강한 타격만 ({MAX_GATE_THRESHOLD_DB} dB)</span>
            </div>
          </div>

          {/* 3. Target bandpass filter toggle & span */}
          <div className="setting-group">
            <div className="setting-row-between">
              <div>
                <div className="setting-label">목표 주파수 대역 필터</div>
                <p className="setting-help tabular">
                  통과 대역: {Math.round(activeBand.lowHz)} ~ {Math.round(activeBand.highHz)} Hz
                  {settings.targetFilterEnabled ? ' (목표 집중)' : ' (전체 드럼 대역)'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.targetFilterEnabled}
                className={`toggle-switch ${settings.targetFilterEnabled ? 'is-on' : ''}`}
                onClick={() =>
                  onUpdateSettings({ targetFilterEnabled: !settings.targetFilterEnabled })
                }
              >
                <span className="toggle-knob" />
                <span className="toggle-text">
                  {settings.targetFilterEnabled ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>

            {settings.targetFilterEnabled && (
              <div className="setting-sub-control">
                <div className="setting-row-between">
                  <label htmlFor="filter-span-slider" className="setting-sub-label">
                    필터 대역 폭
                  </label>
                  <strong className="setting-value tabular">
                    ±{settings.targetFilterSpanPct}%
                  </strong>
                </div>
                <input
                  id="filter-span-slider"
                  type="range"
                  min={MIN_TARGET_FILTER_SPAN_PCT}
                  max={MAX_TARGET_FILTER_SPAN_PCT}
                  step={5}
                  value={settings.targetFilterSpanPct}
                  onChange={(e) =>
                    onUpdateSettings({ targetFilterSpanPct: Number(e.target.value) })
                  }
                  className="range-slider"
                />
                <div className="range-labels">
                  <span>좁게 (±{MIN_TARGET_FILTER_SPAN_PCT}%)</span>
                  <span>넓게 (±{MAX_TARGET_FILTER_SPAN_PCT}%)</span>
                </div>
              </div>
            )}
          </div>

          {/* 4. Tolerance Hz quick buttons + slider */}
          <div className="setting-group">
            <div className="setting-row-between">
              <label htmlFor="tolerance-slider" className="setting-label">
                일치 허용 오차
              </label>
              <strong className="setting-value tabular">
                ±{settings.toleranceHz.toFixed(1)} Hz
              </strong>
            </div>

            <div className="quick-tolerance-row" role="group" aria-label="허용 오차 빠른 선택">
              {QUICK_TOLERANCES.map((tol) => {
                const isSelected = Math.abs(settings.toleranceHz - tol) < 0.05;
                return (
                  <button
                    key={tol}
                    type="button"
                    className={`btn btn-chip ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => onUpdateSettings({ toleranceHz: tol })}
                  >
                    ±{tol.toFixed(1)} Hz
                  </button>
                );
              })}
            </div>

            <input
              id="tolerance-slider"
              type="range"
              min={MIN_TOLERANCE_HZ}
              max={MAX_TOLERANCE_HZ}
              step={0.1}
              value={settings.toleranceHz}
              onChange={(e) =>
                onUpdateSettings({ toleranceHz: Number(e.target.value) })
              }
              className="range-slider"
            />
            <div className="range-labels">
              <span>정밀 (±{MIN_TOLERANCE_HZ.toFixed(1)} Hz)</span>
              <span>여유 (±{MAX_TOLERANCE_HZ.toFixed(1)} Hz)</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
