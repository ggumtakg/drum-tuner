import { CascadedBandpassFilter, computeBandpassRange } from './biquad.ts';
import { detectDrumPitch } from './pitch.ts';

export interface DrumHitAnalyzerConfig {
  sampleRate: number;
  targetHz: number;
  gateThresholdDb: number;
  targetFilterEnabled: boolean;
  targetFilterSpanPct: number;
}

export type DrumHitAnalyzerUpdate = Partial<Omit<DrumHitAnalyzerConfig, 'sampleRate'>>;

export type HitStatus = 'valid' | 'clipped' | 'low-confidence';

export interface DrumHitResult {
  status: HitStatus;
  measuredHz: number | null;
  confidence: number;
  rmsDb: number;
  peak: number;
  timestamp: number;
}

export interface CalibrationResult {
  noiseFloorDb: number;
  recommendedGateThresholdDb: number;
}

export interface FrameAnalysisResult {
  levelDb: number;
  peak: number;
  gateThresholdDb: number;
  noiseFloorDb: number;
  isCalibrating: boolean;
  calibrationProgress: number;
  calibrationResult: CalibrationResult | null;
  hit: DrumHitResult | null;
}

type AnalyzerState = 'idle' | 'settling' | 'capturing' | 'cooldown';

const ANALYSIS_WINDOW_MS = 140;
const SUB_WINDOW_MS = 110;
const SETTLE_MS = 20;
const COOLDOWN_MS = 220;
const TRANSIENT_SUBBLOCK_MS = 21.333;
const TRANSIENT_RISE_RATIO = 2.2;
const ATTACK_SLOPE_RATIO = 1.6;
const CLIPPING_PEAK_THRESHOLD = 0.98;
const MIN_VALID_CONFIDENCE = 0.6;
const MIN_SUBWINDOW_CONFIDENCE = 0.55;
const MAX_PITCH_DRIFT_RATIO = 0.045;
const DEFAULT_TARGET_HZ = 100;
const DEFAULT_GATE_THRESHOLD_DB = -36;
const DEFAULT_TARGET_FILTER_SPAN_PCT = 40;
const DEFAULT_CALIBRATION_DURATION_MS = 2000;
const CALIBRATION_PERCENTILE = 0.95;
const CALIBRATION_HEADROOM_DB = 10;
const MIN_DB = -96;
const MIN_LINEAR = 10 ** (MIN_DB / 20);
const NOISE_FLOOR_EMA_UP = 0.08;
const NOISE_FLOOR_EMA_DOWN = 0.12;

export function linearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= MIN_LINEAR) {
    return MIN_DB;
  }
  return Math.max(MIN_DB, 20 * Math.log10(linear));
}

export function dbToLinear(db: number): number {
  if (!Number.isFinite(db) || db <= MIN_DB) {
    return MIN_LINEAR;
  }
  return 10 ** (db / 20);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computePercentile(values: readonly number[], percentile: number): number {
  if (values.length === 0) {
    return MIN_LINEAR;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rankIndex = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentile) - 1),
  );
  return sorted[rankIndex];
}

export class DrumHitAnalyzer {
  private readonly sampleRate: number;
  private targetHz: number;
  private gateThresholdDb: number;
  private targetFilterEnabled: boolean;
  private targetFilterSpanPct: number;

  private readonly bandpassFilter: CascadedBandpassFilter;
  private readonly analysisWindowSamples: number;
  private readonly subWindowSamples: number;
  private readonly subWindowOffset: number;
  private readonly transientSubblockSamples: number;
  private readonly settleSamples: number;
  private readonly cooldownSamples: number;

  private state: AnalyzerState = 'idle';
  private settleRemaining = 0;
  private cooldownRemaining = 0;
  private readonly captureBuffer: Float32Array;
  private captureIndex = 0;
  private hitPeakRaw = 0;
  private triggerNoiseFloorRms = MIN_LINEAR;

  private noiseFloorRms = dbToLinear(-60);
  private noiseFloorInitialized = false;
  private prevShortRms = dbToLinear(-60);
  private prevPrevShortRms = dbToLinear(-60);
  private shortWindowSumSq = 0;
  private shortWindowPeakRaw = 0;
  private shortWindowCount = 0;

  private isCalibrating = false;
  private calibrationTargetSamples = 0;
  private calibrationCollectedSamples = 0;
  private calibrationShortRmsList: number[] = [];
  private calibrationSubblockSumSq = 0;
  private calibrationSubblockCount = 0;

  constructor(config: DrumHitAnalyzerConfig) {
    if (!Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
      throw new RangeError(`Invalid sampleRate: ${config.sampleRate}`);
    }

    this.sampleRate = config.sampleRate;
    this.targetHz =
      Number.isFinite(config.targetHz) && config.targetHz > 0
        ? config.targetHz
        : DEFAULT_TARGET_HZ;
    this.gateThresholdDb = Number.isFinite(config.gateThresholdDb)
      ? clamp(config.gateThresholdDb, -60, -6)
      : DEFAULT_GATE_THRESHOLD_DB;
    this.targetFilterEnabled = Boolean(config.targetFilterEnabled);
    this.targetFilterSpanPct = Number.isFinite(config.targetFilterSpanPct)
      ? clamp(config.targetFilterSpanPct, 15, 80)
      : DEFAULT_TARGET_FILTER_SPAN_PCT;

    const band = computeBandpassRange({
      targetHz: this.targetHz,
      targetFilterEnabled: this.targetFilterEnabled,
      targetFilterSpanPct: this.targetFilterSpanPct,
    });
    this.bandpassFilter = new CascadedBandpassFilter(this.sampleRate, band.lowHz, band.highHz);

    this.analysisWindowSamples = Math.max(
      2048,
      Math.round((this.sampleRate * ANALYSIS_WINDOW_MS) / 1000),
    );
    this.subWindowSamples = Math.max(
      1536,
      Math.round((this.sampleRate * SUB_WINDOW_MS) / 1000),
    );
    this.subWindowOffset = this.analysisWindowSamples - this.subWindowSamples;
    this.transientSubblockSamples = Math.max(
      256,
      Math.round((this.sampleRate * TRANSIENT_SUBBLOCK_MS) / 1000),
    );
    this.captureBuffer = new Float32Array(this.analysisWindowSamples);

    this.settleSamples = Math.max(1, Math.round((this.sampleRate * SETTLE_MS) / 1000));
    this.cooldownSamples = Math.max(1, Math.round((this.sampleRate * COOLDOWN_MS) / 1000));
  }

  updateConfig(update: DrumHitAnalyzerUpdate): void {
    if (update.targetHz !== undefined && Number.isFinite(update.targetHz) && update.targetHz > 0) {
      this.targetHz = update.targetHz;
    }
    if (update.gateThresholdDb !== undefined && Number.isFinite(update.gateThresholdDb)) {
      this.gateThresholdDb = clamp(update.gateThresholdDb, -60, -6);
    }
    if (update.targetFilterEnabled !== undefined) {
      this.targetFilterEnabled = update.targetFilterEnabled;
    }
    if (update.targetFilterSpanPct !== undefined && Number.isFinite(update.targetFilterSpanPct)) {
      this.targetFilterSpanPct = clamp(update.targetFilterSpanPct, 15, 80);
    }

    const band = computeBandpassRange({
      targetHz: this.targetHz,
      targetFilterEnabled: this.targetFilterEnabled,
      targetFilterSpanPct: this.targetFilterSpanPct,
    });
    this.bandpassFilter.setRange(band.lowHz, band.highHz);
  }

  startCalibration(durationMs: number = DEFAULT_CALIBRATION_DURATION_MS): void {
    const safeDurationMs = Number.isFinite(durationMs)
      ? clamp(durationMs, 200, 10000)
      : DEFAULT_CALIBRATION_DURATION_MS;
    this.isCalibrating = true;
    this.calibrationTargetSamples = Math.max(1, Math.round((this.sampleRate * safeDurationMs) / 1000));
    this.calibrationCollectedSamples = 0;
    this.calibrationShortRmsList = [];
    this.calibrationSubblockSumSq = 0;
    this.calibrationSubblockCount = 0;

    // Abort any in-progress hit capture cleanly
    this.state = 'idle';
    this.captureIndex = 0;
    this.settleRemaining = 0;
    this.cooldownRemaining = 0;
  }

  cancelCalibration(): void {
    this.isCalibrating = false;
    this.calibrationCollectedSamples = 0;
    this.calibrationShortRmsList = [];
    this.calibrationSubblockSumSq = 0;
    this.calibrationSubblockCount = 0;
  }

  clearCapture(): void {
    this.state = 'idle';
    this.settleRemaining = 0;
    this.cooldownRemaining = 0;
    this.captureIndex = 0;
    this.hitPeakRaw = 0;
    this.shortWindowSumSq = 0;
    this.shortWindowPeakRaw = 0;
    this.shortWindowCount = 0;
  }

  reset(): void {
    this.bandpassFilter.reset();
    this.state = 'idle';
    this.settleRemaining = 0;
    this.cooldownRemaining = 0;
    this.captureIndex = 0;
    this.hitPeakRaw = 0;
    this.noiseFloorRms = dbToLinear(-60);
    this.noiseFloorInitialized = false;
    this.prevShortRms = dbToLinear(-60);
    this.prevPrevShortRms = dbToLinear(-60);
    this.shortWindowSumSq = 0;
    this.shortWindowPeakRaw = 0;
    this.shortWindowCount = 0;
    this.cancelCalibration();
  }

  processFrame(frame: Float32Array, timestampMs: number = Date.now()): FrameAnalysisResult {
    const length = frame.length;
    if (length === 0) {
      return {
        levelDb: MIN_DB,
        peak: 0,
        gateThresholdDb: this.gateThresholdDb,
        noiseFloorDb: linearToDb(this.noiseFloorRms),
        isCalibrating: this.isCalibrating,
        calibrationProgress: this.getCalibrationProgress(),
        calibrationResult: null,
        hit: null,
      };
    }

    const filtered = new Float32Array(length);
    let framePeak = 0;
    let frameFilteredSumSq = 0;

    for (let i = 0; i < length; i++) {
      const raw = frame[i];
      const absRaw = Math.abs(raw);
      if (absRaw > framePeak) {
        framePeak = absRaw;
      }
      const f = this.bandpassFilter.processSample(raw);
      filtered[i] = f;
      frameFilteredSumSq += f * f;
    }

    const frameRms = Math.sqrt(frameFilteredSumSq / length);
    const levelDb = linearToDb(frameRms);

    let calibrationResult: CalibrationResult | null = null;
    if (this.isCalibrating) {
      let calOffset = 0;
      while (calOffset < length && this.calibrationCollectedSamples < this.calibrationTargetSamples) {
        const remainingTarget = this.calibrationTargetSamples - this.calibrationCollectedSamples;
        const neededSubblock = this.transientSubblockSamples - this.calibrationSubblockCount;
        const toConsume = Math.min(remainingTarget, neededSubblock, length - calOffset);

        for (let i = calOffset; i < calOffset + toConsume; i++) {
          const f = filtered[i];
          this.calibrationSubblockSumSq += f * f;
        }

        this.calibrationSubblockCount += toConsume;
        this.calibrationCollectedSamples += toConsume;
        calOffset += toConsume;

        if (this.calibrationSubblockCount >= this.transientSubblockSamples) {
          this.calibrationShortRmsList.push(
            Math.sqrt(this.calibrationSubblockSumSq / this.calibrationSubblockCount),
          );
          this.calibrationSubblockSumSq = 0;
          this.calibrationSubblockCount = 0;
        }
      }

      if (this.calibrationCollectedSamples >= this.calibrationTargetSamples) {
        if (
          this.calibrationSubblockCount > 0 &&
          (this.calibrationShortRmsList.length === 0 ||
            this.calibrationSubblockCount >= this.transientSubblockSamples / 2)
        ) {
          this.calibrationShortRmsList.push(
            Math.sqrt(this.calibrationSubblockSumSq / this.calibrationSubblockCount),
          );
        }

        const measuredRms = computePercentile(
          this.calibrationShortRmsList,
          CALIBRATION_PERCENTILE,
        );
        const measuredDb = linearToDb(measuredRms);
        const recommendedGate = clamp(Math.round(measuredDb + CALIBRATION_HEADROOM_DB), -54, -6);

        this.noiseFloorRms = Math.max(measuredRms, MIN_LINEAR);
        this.noiseFloorInitialized = true;
        this.prevShortRms = this.noiseFloorRms;
        this.prevPrevShortRms = this.noiseFloorRms;
        this.shortWindowSumSq = 0;
        this.shortWindowPeakRaw = 0;
        this.shortWindowCount = 0;
        this.gateThresholdDb = recommendedGate;
        this.isCalibrating = false;
        this.calibrationShortRmsList = [];
        this.calibrationSubblockSumSq = 0;
        this.calibrationSubblockCount = 0;

        calibrationResult = {
          noiseFloorDb: measuredDb,
          recommendedGateThresholdDb: recommendedGate,
        };
      }

      return {
        levelDb,
        peak: framePeak,
        gateThresholdDb: this.gateThresholdDb,
        noiseFloorDb: linearToDb(this.noiseFloorRms),
        isCalibrating: this.isCalibrating,
        calibrationProgress: calibrationResult ? 1 : this.getCalibrationProgress(),
        calibrationResult,
        hit: null,
      };
    }

    let emittedHit: DrumHitResult | null = null;
    let offset = 0;

    while (offset < length) {
      if (this.state === 'idle') {
        const needed = this.transientSubblockSamples - this.shortWindowCount;
        const toConsume = Math.min(needed, length - offset);

        for (let i = offset; i < offset + toConsume; i++) {
          const f = filtered[i];
          this.shortWindowSumSq += f * f;
          const absRaw = Math.abs(frame[i]);
          if (absRaw > this.shortWindowPeakRaw) {
            this.shortWindowPeakRaw = absRaw;
          }
        }

        this.shortWindowCount += toConsume;
        offset += toConsume;

        if (this.shortWindowCount >= this.transientSubblockSamples) {
          const chunkRms = Math.sqrt(this.shortWindowSumSq / this.shortWindowCount);
          const chunkPeak = this.shortWindowPeakRaw;
          this.shortWindowSumSq = 0;
          this.shortWindowPeakRaw = 0;
          this.shortWindowCount = 0;

          const gateLinear = dbToLinear(this.gateThresholdDb);

          if (!this.noiseFloorInitialized) {
            this.noiseFloorRms = Math.max(chunkRms, MIN_LINEAR);
            this.prevShortRms = this.noiseFloorRms;
            this.prevPrevShortRms = this.noiseFloorRms;
            this.noiseFloorInitialized = true;
          } else {
            const isAboveGate = chunkRms > gateLinear;
            const isAboveNoiseFloor =
              chunkRms >= Math.max(this.noiseFloorRms, MIN_LINEAR) * TRANSIENT_RISE_RATIO;
            const referenceRecentRms = Math.max(
              Math.min(this.prevShortRms, this.prevPrevShortRms),
              MIN_LINEAR,
            );
            const isRisingAttack = chunkRms >= referenceRecentRms * ATTACK_SLOPE_RATIO;

            if (isAboveGate && isAboveNoiseFloor && isRisingAttack) {
              this.state = 'settling';
              this.settleRemaining = this.settleSamples;
              this.captureIndex = 0;
              this.hitPeakRaw = chunkPeak;
              this.triggerNoiseFloorRms = this.noiseFloorRms;
            } else {
              // Only pull noiseFloor upward if signal is NOT a decaying ring-out tail above gate
              const isDecayingTail = chunkRms > gateLinear && chunkRms < this.prevShortRms;
              if (!isDecayingTail) {
                const alpha =
                  chunkRms > this.noiseFloorRms ? NOISE_FLOOR_EMA_UP : NOISE_FLOOR_EMA_DOWN;
                this.noiseFloorRms = Math.max(
                  MIN_LINEAR,
                  this.noiseFloorRms + alpha * (chunkRms - this.noiseFloorRms),
                );
              }
            }

            this.prevPrevShortRms = this.prevShortRms;
            this.prevShortRms = Math.max(chunkRms, MIN_LINEAR);
          }
        }
      } else if (this.state === 'settling') {
        const toConsume = Math.min(this.settleRemaining, length - offset);
        for (let i = offset; i < offset + toConsume; i++) {
          const absRaw = Math.abs(frame[i]);
          if (absRaw > this.hitPeakRaw) {
            this.hitPeakRaw = absRaw;
          }
        }
        this.settleRemaining -= toConsume;
        offset += toConsume;

        if (this.settleRemaining <= 0) {
          this.state = 'capturing';
        }
      } else if (this.state === 'capturing') {
        const needed = this.analysisWindowSamples - this.captureIndex;
        const toCopy = Math.min(needed, length - offset);

        for (let i = 0; i < toCopy; i++) {
          const sampleIdx = offset + i;
          this.captureBuffer[this.captureIndex + i] = filtered[sampleIdx];
          const absRaw = Math.abs(frame[sampleIdx]);
          if (absRaw > this.hitPeakRaw) {
            this.hitPeakRaw = absRaw;
          }
        }

        this.captureIndex += toCopy;
        offset += toCopy;

        if (this.captureIndex >= this.analysisWindowSamples) {
          emittedHit = this.evaluateCapturedHit(timestampMs);
          this.state = 'cooldown';
          this.cooldownRemaining = this.cooldownSamples;
          this.captureIndex = 0;
          this.shortWindowSumSq = 0;
          this.shortWindowPeakRaw = 0;
          this.shortWindowCount = 0;
        }
      } else {
        // cooldown: keep tracking recent RMS so decaying tail cannot re-trigger upon returning to idle
        const toConsume = Math.min(this.cooldownRemaining, length - offset);
        for (let i = offset; i < offset + toConsume; i++) {
          const f = filtered[i];
          this.shortWindowSumSq += f * f;
          this.shortWindowCount++;
          if (this.shortWindowCount >= this.transientSubblockSamples) {
            const tailRms = Math.sqrt(this.shortWindowSumSq / this.shortWindowCount);
            this.prevPrevShortRms = this.prevShortRms;
            this.prevShortRms = Math.max(tailRms, MIN_LINEAR);
            this.shortWindowSumSq = 0;
            this.shortWindowCount = 0;
          }
        }
        this.cooldownRemaining -= toConsume;
        offset += toConsume;

        if (this.cooldownRemaining <= 0) {
          if (this.shortWindowCount > 0) {
            const tailRms = Math.sqrt(this.shortWindowSumSq / this.shortWindowCount);
            this.prevPrevShortRms = this.prevShortRms;
            this.prevShortRms = Math.max(tailRms, MIN_LINEAR);
            this.shortWindowSumSq = 0;
            this.shortWindowCount = 0;
          }
          this.shortWindowPeakRaw = 0;
          this.state = 'idle';
        }
      }
    }

    return {
      levelDb,
      peak: framePeak,
      gateThresholdDb: this.gateThresholdDb,
      noiseFloorDb: linearToDb(this.noiseFloorRms),
      isCalibrating: false,
      calibrationProgress: 0,
      calibrationResult: null,
      hit: emittedHit,
    };
  }

  private getCalibrationProgress(): number {
    if (!this.isCalibrating || this.calibrationTargetSamples <= 0) {
      return 0;
    }
    return Math.min(1, this.calibrationCollectedSamples / this.calibrationTargetSamples);
  }

  private evaluateCapturedHit(timestamp: number): DrumHitResult {
    let sumSq = 0;
    for (let i = 0; i < this.analysisWindowSamples; i++) {
      const v = this.captureBuffer[i];
      sumSq += v * v;
    }
    const analysisRms = Math.sqrt(sumSq / this.analysisWindowSamples);
    const rmsDb = linearToDb(analysisRms);

    if (this.hitPeakRaw >= CLIPPING_PEAK_THRESHOLD) {
      return {
        status: 'clipped',
        measuredHz: null,
        confidence: 0,
        rmsDb,
        peak: this.hitPeakRaw,
        timestamp,
      };
    }

    // Reject brief non-resonant clicks whose energy already dissipated before the analysis window
    const minSustainedRms = Math.max(
      this.triggerNoiseFloorRms * 1.15,
      dbToLinear(this.gateThresholdDb) * 0.2,
    );
    if (analysisRms < minSustainedRms) {
      return {
        status: 'low-confidence',
        measuredHz: null,
        confidence: 0,
        rmsDb,
        peak: this.hitPeakRaw,
        timestamp,
      };
    }

    const activeRange = this.bandpassFilter.getRange();
    const detectOptions = {
      minHz: Math.max(26, activeRange.lowHz * 0.9),
      maxHz: Math.min(650, activeRange.highHz * 1.1),
    };
    const pitch = detectDrumPitch(this.captureBuffer, this.sampleRate, detectOptions);

    if (!pitch || pitch.confidence < MIN_VALID_CONFIDENCE) {
      return {
        status: 'low-confidence',
        measuredHz: pitch ? pitch.frequencyHz : null,
        confidence: pitch ? pitch.confidence : 0,
        rmsDb,
        peak: this.hitPeakRaw,
        timestamp,
      };
    }

    // Verify temporal pitch stability across two overlapping sub-windows
    // to reject speech pitch glides and beating polyphonic band chords.
    const firstSubPitch = detectDrumPitch(
      this.captureBuffer.subarray(0, this.subWindowSamples),
      this.sampleRate,
      detectOptions,
    );
    const secondSubPitch = detectDrumPitch(
      this.captureBuffer.subarray(this.subWindowOffset, this.analysisWindowSamples),
      this.sampleRate,
      detectOptions,
    );

    if (
      !firstSubPitch ||
      !secondSubPitch ||
      firstSubPitch.confidence < MIN_SUBWINDOW_CONFIDENCE ||
      secondSubPitch.confidence < MIN_SUBWINDOW_CONFIDENCE
    ) {
      return {
        status: 'low-confidence',
        measuredHz: null,
        confidence: Math.min(
          pitch.confidence,
          firstSubPitch?.confidence ?? 0,
          secondSubPitch?.confidence ?? 0,
        ),
        rmsDb,
        peak: this.hitPeakRaw,
        timestamp,
      };
    }

    const subWindowDriftRatio =
      Math.abs(firstSubPitch.frequencyHz - secondSubPitch.frequencyHz) / pitch.frequencyHz;
    const fullDeviationRatio =
      Math.max(
        Math.abs(firstSubPitch.frequencyHz - pitch.frequencyHz),
        Math.abs(secondSubPitch.frequencyHz - pitch.frequencyHz),
      ) / pitch.frequencyHz;

    if (
      subWindowDriftRatio > MAX_PITCH_DRIFT_RATIO ||
      fullDeviationRatio > MAX_PITCH_DRIFT_RATIO
    ) {
      return {
        status: 'low-confidence',
        measuredHz: null,
        confidence: Math.min(pitch.confidence, firstSubPitch.confidence, secondSubPitch.confidence),
        rmsDb,
        peak: this.hitPeakRaw,
        timestamp,
      };
    }

    return {
      status: 'valid',
      measuredHz: pitch.frequencyHz,
      confidence: pitch.confidence,
      rmsDb,
      peak: this.hitPeakRaw,
      timestamp,
    };
  }
}
