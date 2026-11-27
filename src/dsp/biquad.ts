export type BiquadFilterType = 'highpass' | 'lowpass';

export interface BandpassRange {
  lowHz: number;
  highHz: number;
}

export interface TargetBandOptions {
  targetHz: number;
  targetFilterEnabled: boolean;
  targetFilterSpanPct?: number;
}

export const DEFAULT_DRUM_BAND: BandpassRange = {
  lowHz: 30,
  highHz: 600,
};

const TARGET_BAND_MIN_HZ = 30;
const TARGET_BAND_MAX_HZ = 650;
const MIN_BANDWIDTH_HZ = 25;
const BUTTERWORTH_Q = Math.SQRT1_2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Computes the active bandpass range for either default drum band (30~600 Hz)
 * or target-focused mode with guaranteed minimum bandwidth.
 */
export function computeBandpassRange(options: TargetBandOptions): BandpassRange {
  if (!options.targetFilterEnabled || !Number.isFinite(options.targetHz) || options.targetHz <= 0) {
    return { ...DEFAULT_DRUM_BAND };
  }

  const spanPct = clamp(options.targetFilterSpanPct ?? 40, 15, 80);
  const fraction = spanPct / 100;
  let lowHz = Math.max(TARGET_BAND_MIN_HZ, options.targetHz * (1 - fraction));
  let highHz = Math.min(TARGET_BAND_MAX_HZ, options.targetHz * (1 + fraction));

  if (highHz - lowHz < MIN_BANDWIDTH_HZ) {
    const center = clamp(options.targetHz, TARGET_BAND_MIN_HZ, TARGET_BAND_MAX_HZ);
    const halfBand = MIN_BANDWIDTH_HZ / 2;
    lowHz = Math.max(TARGET_BAND_MIN_HZ, center - halfBand);
    highHz = Math.min(TARGET_BAND_MAX_HZ, lowHz + MIN_BANDWIDTH_HZ);
    lowHz = Math.max(TARGET_BAND_MIN_HZ, highHz - MIN_BANDWIDTH_HZ);
  }

  return { lowHz, highHz };
}

/**
 * 2nd-order RBJ biquad filter (Direct Form II Transposed for numerical stability at low frequencies).
 */
export class BiquadFilter {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly type: BiquadFilterType,
    cutoffHz: number,
    q: number = BUTTERWORTH_Q,
  ) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError(`Invalid sampleRate: ${sampleRate}`);
    }
    this.updateCutoff(cutoffHz, q);
  }

  static createHighpass(sampleRate: number, cutoffHz: number, q: number = BUTTERWORTH_Q): BiquadFilter {
    return new BiquadFilter(sampleRate, 'highpass', cutoffHz, q);
  }

  static createLowpass(sampleRate: number, cutoffHz: number, q: number = BUTTERWORTH_Q): BiquadFilter {
    return new BiquadFilter(sampleRate, 'lowpass', cutoffHz, q);
  }

  updateCutoff(cutoffHz: number, q: number = BUTTERWORTH_Q): void {
    const nyquist = this.sampleRate * 0.5;
    const safeCutoff = clamp(cutoffHz, 10, nyquist * 0.9);
    const safeQ = clamp(q, 0.25, 10);

    const omega = (2 * Math.PI * safeCutoff) / this.sampleRate;
    const cosW = Math.cos(omega);
    const sinW = Math.sin(omega);
    const alpha = sinW / (2 * safeQ);

    let b0: number;
    let b1: number;
    let b2: number;

    if (this.type === 'highpass') {
      b0 = (1 + cosW) * 0.5;
      b1 = -(1 + cosW);
      b2 = (1 + cosW) * 0.5;
    } else {
      b0 = (1 - cosW) * 0.5;
      b1 = 1 - cosW;
      b2 = (1 - cosW) * 0.5;
    }

    const a0 = 1 + alpha;
    const a1 = -2 * cosW;
    const a2 = 1 - alpha;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  processSample(x: number): number {
    if (!Number.isFinite(x)) {
      return 0;
    }
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  processBlock(input: Float32Array, output?: Float32Array): Float32Array {
    const out = output && output.length === input.length ? output : new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      out[i] = this.processSample(input[i]);
    }
    return out;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/**
 * Cascaded highpass + lowpass biquad bandpass filter for drum fundamental isolation.
 * Defaults to 1 stage per edge (2nd-order Butterworth HPF + 2nd-order Butterworth LPF)
 * for flat passband response and fast transient settling.
 */
export class CascadedBandpassFilter {
  private readonly highpassStages: BiquadFilter[] = [];
  private readonly lowpassStages: BiquadFilter[] = [];
  private lowHz: number;
  private highHz: number;

  constructor(
    private readonly sampleRate: number,
    lowHz: number = DEFAULT_DRUM_BAND.lowHz,
    highHz: number = DEFAULT_DRUM_BAND.highHz,
    stages: number = 1,
  ) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError(`Invalid sampleRate: ${sampleRate}`);
    }

    const safeStages = Math.max(1, Math.min(4, Math.floor(stages)));
    const normalized = this.normalizeRange(lowHz, highHz);
    this.lowHz = normalized.lowHz;
    this.highHz = normalized.highHz;

    for (let i = 0; i < safeStages; i++) {
      this.highpassStages.push(BiquadFilter.createHighpass(sampleRate, this.lowHz));
      this.lowpassStages.push(BiquadFilter.createLowpass(sampleRate, this.highHz));
    }
  }

  private normalizeRange(lowHz: number, highHz: number): BandpassRange {
    const maxAllowed = this.sampleRate * 0.45;
    let low = clamp(lowHz, 20, maxAllowed - MIN_BANDWIDTH_HZ);
    let high = clamp(highHz, low + MIN_BANDWIDTH_HZ, maxAllowed);
    if (high - low < MIN_BANDWIDTH_HZ) {
      low = Math.max(20, high - MIN_BANDWIDTH_HZ);
    }
    return { lowHz: low, highHz: high };
  }

  setRange(lowHz: number, highHz: number): void {
    const normalized = this.normalizeRange(lowHz, highHz);
    if (
      Math.abs(normalized.lowHz - this.lowHz) < 1e-6 &&
      Math.abs(normalized.highHz - this.highHz) < 1e-6
    ) {
      return;
    }

    this.lowHz = normalized.lowHz;
    this.highHz = normalized.highHz;

    for (const hpf of this.highpassStages) {
      hpf.updateCutoff(this.lowHz);
    }
    for (const lpf of this.lowpassStages) {
      lpf.updateCutoff(this.highHz);
    }
  }

  getRange(): BandpassRange {
    return { lowHz: this.lowHz, highHz: this.highHz };
  }

  processSample(x: number): number {
    if (!Number.isFinite(x)) {
      return 0;
    }
    let v = x;
    for (let i = 0; i < this.highpassStages.length; i++) {
      v = this.highpassStages[i].processSample(v);
    }
    for (let i = 0; i < this.lowpassStages.length; i++) {
      v = this.lowpassStages[i].processSample(v);
    }
    return v;
  }

  processBlock(input: Float32Array, output?: Float32Array): Float32Array {
    const out = output && output.length === input.length ? output : new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      out[i] = this.processSample(input[i]);
    }
    return out;
  }

  reset(): void {
    for (const hpf of this.highpassStages) {
      hpf.reset();
    }
    for (const lpf of this.lowpassStages) {
      lpf.reset();
    }
  }
}
