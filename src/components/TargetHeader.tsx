import { useEffect, useRef, useState, type FormEvent } from 'react';
import { frequencyToNote } from '../dsp/index.ts';
import { MAX_NAME_LENGTH, MAX_TARGET_HZ, MIN_TARGET_HZ } from '../storage/tunerStore.ts';

export interface TargetHeaderProps {
  mode: 'single' | 'kit';
  activePresetName: string | null;
  targetHz: number;
  isTemporaryOverride: boolean;
  onChangeTargetHz: (nextHz: number) => void;
  onQuickSavePreset: (name: string, targetHz: number) => string | null;
}

const NUDGE_DELTAS = [-5, -1, 1, 5] as const;

function formatHzValue(hz: number): string {
  return Number.isInteger(hz) ? String(hz) : hz.toFixed(1);
}

function clampHz(hz: number): number {
  const clamped = Math.max(MIN_TARGET_HZ, Math.min(MAX_TARGET_HZ, hz));
  return Math.round(clamped * 10) / 10;
}

export function TargetHeader({
  mode,
  activePresetName,
  targetHz,
  isTemporaryOverride,
  onChangeTargetHz,
  onQuickSavePreset,
}: TargetHeaderProps) {
  const [inputText, setInputText] = useState(() => formatHzValue(targetHz));
  const [inputError, setInputError] = useState<string | null>(null);
  const isEditingRef = useRef(false);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveHzText, setSaveHzText] = useState(() => formatHzValue(targetHz));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditingRef.current) {
      setInputText(formatHzValue(targetHz));
      setInputError(null);
    }
  }, [targetHz]);

  useEffect(() => {
    if (!saveNotice) {
      return;
    }
    const timer = window.setTimeout(() => setSaveNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [saveNotice]);

  const targetNote = frequencyToNote(targetHz);
  const isManualSingle = mode === 'single' && activePresetName === null;
  const showQuickSaveTrigger = isManualSingle || isTemporaryOverride;

  const commitHzText = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      setInputText(formatHzValue(targetHz));
      setInputError(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < MIN_TARGET_HZ || parsed > MAX_TARGET_HZ) {
      setInputError(`목표 주파수는 ${MIN_TARGET_HZ}~${MAX_TARGET_HZ} Hz 범위여야 합니다.`);
      return;
    }
    const normalized = clampHz(parsed);
    setInputError(null);
    setInputText(formatHzValue(normalized));
    onChangeTargetHz(normalized);
  };

  const handleInputChange = (nextRaw: string) => {
    setInputText(nextRaw);
    if (nextRaw.trim() === '') {
      setInputError(null);
      return;
    }
    const parsed = Number(nextRaw);
    if (Number.isFinite(parsed)) {
      if (parsed >= MIN_TARGET_HZ && parsed <= MAX_TARGET_HZ) {
        setInputError(null);
        onChangeTargetHz(clampHz(parsed));
      } else {
        setInputError(`목표 주파수는 ${MIN_TARGET_HZ}~${MAX_TARGET_HZ} Hz 범위여야 합니다.`);
      }
    }
  };

  const handleNudge = (delta: number) => {
    const nextHz = clampHz(targetHz + delta);
    setInputError(null);
    setInputText(formatHzValue(nextHz));
    onChangeTargetHz(nextHz);
  };

  const handleOpenQuickSave = () => {
    setSaveName(activePresetName ? `${activePresetName} (${formatHzValue(targetHz)}Hz)` : '');
    setSaveHzText(formatHzValue(targetHz));
    setSaveError(null);
    setSaveOpen(true);
  };

  const handleQuickSaveSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsedHz = Number(saveHzText);
    if (!Number.isFinite(parsedHz)) {
      setSaveError(`목표 주파수는 ${MIN_TARGET_HZ}~${MAX_TARGET_HZ} Hz 숫자여야 합니다.`);
      return;
    }
    const error = onQuickSavePreset(saveName, parsedHz);
    if (error) {
      setSaveError(error);
      return;
    }
    setSaveError(null);
    setSaveOpen(false);
    setSaveNotice(`"${saveName.trim()}" 프리셋이 저장되었습니다.`);
  };

  return (
    <section className="card target-header" aria-label="목표 주파수 설정">
      <div className="target-title-row">
        <div className="target-identity">
          <span className="target-label">현재 목표</span>
          <div className="target-name-line">
            <h1 className="target-name">{activePresetName ?? '직접 입력'}</h1>
            {isTemporaryOverride && (
              <span className="badge badge-warn">임시 변경</span>
            )}
            <span className="badge badge-note" aria-label={`참고 음이름 ${targetNote.label}`}>
              {targetNote.label}
            </span>
          </div>
        </div>

        {showQuickSaveTrigger && !saveOpen && (
          <button
            type="button"
            className="btn btn-accent-outline btn-compact"
            onClick={handleOpenQuickSave}
          >
            프리셋으로 저장
          </button>
        )}
      </div>

      <div className="target-controls-row">
        <label className="hz-input-box">
          <span className="sr-only">목표 주파수 (Hz)</span>
          <input
            type="number"
            inputMode="decimal"
            min={MIN_TARGET_HZ}
            max={MAX_TARGET_HZ}
            step="0.1"
            value={inputText}
            onFocus={() => {
              isEditingRef.current = true;
            }}
            onChange={(e) => handleInputChange(e.target.value)}
            onBlur={(e) => {
              isEditingRef.current = false;
              commitHzText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            aria-label="목표 주파수 입력 (Hz)"
            className="hz-number-input"
          />
          <span className="hz-unit">Hz</span>
        </label>

        <div className="nudge-group" role="group" aria-label="주파수 미세조정">
          {NUDGE_DELTAS.map((delta) => (
            <button
              key={delta}
              type="button"
              className="btn btn-nudge"
              onClick={() => handleNudge(delta)}
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
        </div>
      </div>

      {inputError && (
        <p className="field-error" role="alert">
          {inputError}
        </p>
      )}

      {saveNotice && (
        <p className="field-success" role="status">
          {saveNotice}
        </p>
      )}

      {saveOpen && (
        <form className="quick-save-panel" onSubmit={handleQuickSaveSubmit}>
          <div className="quick-save-header">
            <strong>프리셋으로 저장</strong>
            <button
              type="button"
              className="btn btn-ghost btn-compact"
              onClick={() => {
                setSaveOpen(false);
                setSaveError(null);
              }}
            >
              취소
            </button>
          </div>
          <div className="quick-save-fields">
            <label className="form-field">
              <span>드럼 이름</span>
              <input
                type="text"
                maxLength={MAX_NAME_LENGTH}
                placeholder="예: 메인 스네어"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                autoFocus
              />
            </label>
            <label className="form-field form-field-hz">
              <span>주파수 (Hz)</span>
              <input
                type="number"
                inputMode="decimal"
                min={MIN_TARGET_HZ}
                max={MAX_TARGET_HZ}
                step="0.1"
                value={saveHzText}
                onChange={(e) => setSaveHzText(e.target.value)}
              />
            </label>
          </div>
          {saveError && (
            <p className="field-error" role="alert">
              {saveError}
            </p>
          )}
          <div className="quick-save-actions">
            <button type="submit" className="btn btn-primary btn-compact">
              저장
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
