import type { MicEngineError, MicEngineStatus } from '../audio/micEngine.ts';

export interface InputMeterProps {
  micStatus: MicEngineStatus;
  micError: MicEngineError | null;
  levelDb: number;
  noiseFloorDb: number;
  gateThresholdDb: number;
  isCalibrating: boolean;
  onToggleMic: () => void;
  onRetryMic: () => void;
}

const METER_MIN_DB = -72;
const METER_MAX_DB = 0;

function dbToPercent(db: number): number {
  if (!Number.isFinite(db)) {
    return 0;
  }
  const normalized = (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB);
  return Math.max(0, Math.min(100, normalized * 100));
}

export function InputMeter({
  micStatus,
  micError,
  levelDb,
  noiseFloorDb,
  gateThresholdDb,
  isCalibrating,
  onToggleMic,
  onRetryMic,
}: InputMeterProps) {
  const isRunning = micStatus === 'running';
  const isStarting = micStatus === 'starting';

  const levelPct = isRunning ? dbToPercent(levelDb) : 0;
  const gatePct = dbToPercent(gateThresholdDb);
  const isAboveGate = isRunning && levelDb >= gateThresholdDb;

  return (
    <section className="card input-meter-card" aria-label="마이크 입력 및 제어">
      <div className="meter-meta-row">
        <div className="meter-meta-item">
          <span className={`live-dot ${isRunning ? 'is-live' : ''}`} />
          <span>입력 레벨</span>
          <strong className="tabular">
            {isRunning ? `${Math.round(levelDb)} dB` : '-- dB'}
          </strong>
        </div>
        <div className="meter-meta-item">
          <span>주변 소음</span>
          <strong className="tabular">
            {isRunning ? `${Math.round(noiseFloorDb)} dB` : '-- dB'}
          </strong>
        </div>
      </div>

      <div
        className="meter-bar-track"
        role="meter"
        aria-label="실시간 마이크 입력 레벨"
        aria-valuemin={METER_MIN_DB}
        aria-valuemax={METER_MAX_DB}
        aria-valuenow={isRunning ? Math.round(levelDb) : METER_MIN_DB}
      >
        <div
          className={`meter-bar-fill ${isAboveGate ? 'is-hot' : ''} ${isCalibrating ? 'is-calibrating' : ''}`}
          style={{ width: `${levelPct}%` }}
        />
        <div
          className="meter-gate-marker"
          style={{ left: `${gatePct}%` }}
          title={`노이즈 게이트 ${gateThresholdDb} dB`}
        />
      </div>

      <div className="meter-scale-row">
        <span>-72 dB</span>
        <span className="meter-gate-label">게이트 임계치 {gateThresholdDb} dB</span>
        <span>0 dB</span>
      </div>

      <button
        type="button"
        className={`btn btn-mic ${isRunning ? 'btn-mic-stop' : 'btn-mic-start'}`}
        onClick={onToggleMic}
        disabled={isStarting}
      >
        {isStarting ? '마이크 연결 중...' : isRunning ? '일시정지' : '마이크 시작'}
      </button>

      {micError && (
        <div className="mic-error-box" role="alert">
          <div className="mic-error-title">{micError.message}</div>
          <p className="mic-error-guidance">{micError.guidance}</p>
          <button type="button" className="btn btn-secondary btn-compact" onClick={onRetryMic}>
            다시 시도
          </button>
        </div>
      )}
    </section>
  );
}
