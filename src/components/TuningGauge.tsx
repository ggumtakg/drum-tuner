import {
  evaluateTuning,
  frequencyToNote,
  type DrumHitResult,
  type TuningEvaluation,
} from '../dsp/index.ts';

export type HitNoticeKind = 'clipped' | 'low-confidence' | null;

export interface TuningGaugeProps {
  targetHz: number;
  toleranceHz: number;
  heldHit: DrumHitResult | null;
  hitNotice: HitNoticeKind;
  isMicRunning: boolean;
  onResetMeasurement: () => void;
}

const MAX_TRACK_HALF_PCT = 46;

function computeGaugeGeometry(
  targetHz: number,
  toleranceHz: number,
  deltaHz: number | null,
): { toleranceWidthPct: number; needleLeftPct: number } {
  const fullScaleHz = Math.max(toleranceHz * 8, targetHz * 0.12, 8);
  const toleranceWidthPct =
    toleranceHz <= 0
      ? 0
      : Math.max(8, Math.min(44, (toleranceHz / fullScaleHz) * (MAX_TRACK_HALF_PCT * 2)));
  const zoneHalfPct = toleranceWidthPct / 2;

  if (deltaHz === null) {
    return { toleranceWidthPct, needleLeftPct: 50 };
  }

  const absDelta = Math.abs(deltaHz);
  const sign = deltaHz < 0 ? -1 : deltaHz > 0 ? 1 : 0;

  let offsetPct: number;
  if (absDelta <= toleranceHz) {
    offsetPct = toleranceHz <= 0 ? 0 : (deltaHz / toleranceHz) * zoneHalfPct;
  } else {
    const outerSpanHz = Math.max(fullScaleHz - toleranceHz, 1e-6);
    const outerFraction = Math.min(1, (absDelta - toleranceHz) / outerSpanHz);
    offsetPct = sign * (zoneHalfPct + outerFraction * (MAX_TRACK_HALF_PCT - zoneHalfPct));
  }

  return {
    toleranceWidthPct,
    needleLeftPct: 50 + offsetPct,
  };
}

function formatDeltaHz(deltaHz: number): string {
  const rounded = Math.round(deltaHz * 10) / 10;
  if (Math.abs(rounded) < 0.05) {
    return '0.0 Hz';
  }
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)} Hz`;
}

function formatCents(cents: number): string {
  if (cents === 0) {
    return '0¢';
  }
  return cents > 0 ? `+${cents}¢` : `${cents}¢`;
}

export function TuningGauge({
  targetHz,
  toleranceHz,
  heldHit,
  hitNotice,
  isMicRunning,
  onResetMeasurement,
}: TuningGaugeProps) {
  const targetNote = frequencyToNote(targetHz);

  let evaluation: TuningEvaluation | null = null;
  if (heldHit && heldHit.status === 'valid' && heldHit.measuredHz !== null) {
    evaluation = evaluateTuning(heldHit.measuredHz, targetHz, toleranceHz);
  }

  const statusClass = evaluation ? `status-${evaluation.status}` : 'status-waiting';

  let statusLabel = '드럼을 타격하세요';
  if (evaluation) {
    if (evaluation.status === 'in-tune') {
      statusLabel = '잘 맞음';
    } else if (evaluation.status === 'low') {
      statusLabel = '낮음 · 조이세요 (↑)';
    } else {
      statusLabel = '높음 · 푸세요 (↓)';
    }
  }

  const { toleranceWidthPct, needleLeftPct } = computeGaugeGeometry(
    targetHz,
    toleranceHz,
    evaluation ? evaluation.deltaHz : null,
  );

  return (
    <section className={`card tuning-gauge ${statusClass}`} aria-label="튜닝 게이지">
      <div className="gauge-status-bar">
        <span className={`status-pill ${statusClass}`} role="status" aria-live="polite">
          {statusLabel}
        </span>

        <button
          type="button"
          className="btn btn-ghost btn-compact"
          onClick={onResetMeasurement}
          disabled={!heldHit && !hitNotice}
        >
          측정 초기화
        </button>
      </div>

      {hitNotice === 'clipped' && (
        <div className="hit-notice hit-notice-clip" role="alert">
          클리핑 — 마이크를 조금 멀리 두세요
        </div>
      )}

      {hitNotice === 'low-confidence' && (
        <div className="hit-notice hit-notice-low" role="status">
          신뢰도 낮음 — 다시 타격해 주세요
        </div>
      )}

      <div className="readout-block">
        <div className="measured-hz-row">
          <span className="measured-hz-value">
            {heldHit?.measuredHz !== null && heldHit?.measuredHz !== undefined
              ? heldHit.measuredHz.toFixed(1)
              : '---.-'}
          </span>
          <span className="measured-hz-unit">Hz</span>
        </div>

        <div className="measured-sub-row">
          {evaluation ? (
            <>
              <span className="note-pill" title="측정 참고 음이름">
                {evaluation.measuredNote.label}
                <span className="note-cents">{formatCents(evaluation.measuredNote.cents)}</span>
              </span>
              <span className={`delta-pill ${statusClass}`}>
                {formatDeltaHz(evaluation.deltaHz)}
              </span>
            </>
          ) : (
            <span className="waiting-hint">
              {isMicRunning
                ? '타격 후 직전 측정값이 홀드됩니다'
                : '하단 마이크 시작 버튼을 눌러 측정을 시작하세요'}
            </span>
          )}
        </div>
      </div>

      <div className="gauge-visual" aria-hidden="true">
        <div className="gauge-scale-labels">
          <span>낮음 (조이기)</span>
          <span>목표 ±{toleranceHz.toFixed(1)}Hz</span>
          <span>높음 (풀기)</span>
        </div>

        <div className="gauge-track">
          <div
            className="gauge-tolerance-zone"
            style={{ width: `${toleranceWidthPct}%` }}
          />
          <div className="gauge-center-tick" />
          <div className="gauge-quarter-tick gauge-quarter-left" />
          <div className="gauge-quarter-tick gauge-quarter-right" />
          {evaluation && (
            <div
              className={`gauge-needle ${statusClass}`}
              style={{ left: `${needleLeftPct}%` }}
            />
          )}
        </div>
      </div>

      <div className="target-summary-row">
        <span>
          목표 <strong>{targetHz.toFixed(1)} Hz</strong> ({targetNote.label})
        </span>
        <span className="target-summary-sep">·</span>
        <span>
          허용 오차 <strong>±{toleranceHz.toFixed(1)} Hz</strong>
        </span>
      </div>
    </section>
  );
}
