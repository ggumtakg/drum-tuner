export interface PitchDetectionOptions {
  minHz?: number;
  maxHz?: number;
  threshold?: number;
}

export interface PitchDetectionResult {
  frequencyHz: number;
  confidence: number;
}

const DEFAULT_MIN_HZ = 35;
const DEFAULT_MAX_HZ = 600;
const DEFAULT_THRESHOLD = 0.25;
const MIN_SIGNAL_RMS = 1e-6;
const GOLDEN_RATIO_CONJ = 0.6180339887498949;

/**
 * Evaluates squared magnitude of the Hann-windowed DTFT at an arbitrary frequency.
 * Hann window sidelobes (< -44 dB at >= 3 bins) isolate the fundamental from
 * inharmonic circular-membrane overtones (1.59x, 2.14x).
 */
function windowedDtftPower(
  samples: Float32Array,
  sampleRate: number,
  freqHz: number,
): number {
  const n = samples.length;
  const omega = (2 * Math.PI * freqHz) / sampleRate;
  const cosStep = Math.cos(omega);
  const sinStep = Math.sin(omega);
  const hannStep = (2 * Math.PI) / (n - 1);

  let cosVal = 1;
  let sinVal = 0;
  let re = 0;
  let im = 0;

  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos(hannStep * i));
    const x = samples[i] * w;
    re += x * cosVal;
    im -= x * sinVal;

    const nextCos = cosVal * cosStep - sinVal * sinStep;
    const nextSin = sinVal * cosStep + cosVal * sinStep;
    cosVal = nextCos;
    sinVal = nextSin;
  }

  return re * re + im * im;
}

/**
 * Refines YIN's coarse fundamental estimate using golden-section search on the
 * Hann-windowed DTFT power within ±3.5% of yinHz to eliminate inharmonic overtone pull.
 */
function refineFundamentalViaDtft(
  samples: Float32Array,
  sampleRate: number,
  yinHz: number,
  minHz: number,
  maxHz: number,
): number {
  let a = Math.max(minHz, yinHz * 0.965);
  let b = Math.min(maxHz, yinHz * 1.035);
  if (b - a < 0.05) {
    return yinHz;
  }

  let c = b - GOLDEN_RATIO_CONJ * (b - a);
  let d = a + GOLDEN_RATIO_CONJ * (b - a);
  let fc = windowedDtftPower(samples, sampleRate, c);
  let fd = windowedDtftPower(samples, sampleRate, d);

  for (let iter = 0; iter < 16; iter++) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - GOLDEN_RATIO_CONJ * (b - a);
      fc = windowedDtftPower(samples, sampleRate, c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + GOLDEN_RATIO_CONJ * (b - a);
      fd = windowedDtftPower(samples, sampleRate, d);
    }
  }

  const refinedHz = (a + b) * 0.5;
  const yinPower = windowedDtftPower(samples, sampleRate, yinHz);
  const refinedPower = windowedDtftPower(samples, sampleRate, refinedHz);

  // Only adopt refinement if it strictly improves or matches spectral peak energy
  return refinedPower >= yinPower ? refinedHz : yinHz;
}

/**
 * Drum-fundamental specialized YIN (CMNDF) pitch detector with parabolic interpolation
 * and subharmonic octave-halving guard to resist inharmonic membrane overtones.
 */
export function detectDrumPitch(
  samples: Float32Array,
  sampleRate: number,
  options: PitchDetectionOptions = {},
): PitchDetectionResult | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }

  const length = samples.length;
  if (length < 64) {
    return null;
  }

  const minHz = Math.max(20, options.minHz ?? DEFAULT_MIN_HZ);
  const maxHz = Math.min(sampleRate * 0.45, options.maxHz ?? DEFAULT_MAX_HZ);
  if (maxHz <= minHz) {
    return null;
  }

  const threshold = Math.max(0.02, Math.min(0.5, options.threshold ?? DEFAULT_THRESHOLD));

  // Remove DC offset and verify signal energy
  let mean = 0;
  for (let i = 0; i < length; i++) {
    mean += samples[i];
  }
  mean /= length;

  const centered = new Float32Array(length);
  let sumSq = 0;
  for (let i = 0; i < length; i++) {
    const v = samples[i] - mean;
    centered[i] = v;
    sumSq += v * v;
  }

  const rms = Math.sqrt(sumSq / length);
  if (!Number.isFinite(rms) || rms < MIN_SIGNAL_RMS) {
    return null;
  }

  const integrationWindow = Math.floor(length / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.ceil(sampleRate / minHz), length - integrationWindow - 1);

  if (tauMax <= tauMin + 2) {
    return null;
  }

  // Step 1 & 2: Difference function and Cumulative Mean Normalized Difference Function (CMNDF)
  const cmndf = new Float32Array(tauMax + 1);
  cmndf[0] = 1;

  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let diffSum = 0;
    for (let j = 0; j < integrationWindow; j++) {
      const delta = centered[j] - centered[j + tau];
      diffSum += delta * delta;
    }

    runningSum += diffSum;
    cmndf[tau] = runningSum > 0 ? (diffSum * tau) / runningSum : 1;
  }

  // Step 3: Prefer first deep local minimum below threshold
  let bestTau = -1;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmndf[tau] < threshold) {
      while (tau + 1 < tauMax && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  // Fallback for drums with strong inharmonic overtones where true fundamental valley sits slightly above threshold
  const fallbackCeiling = Math.min(0.45, Math.max(threshold * 2.2, 0.38));
  if (bestTau === -1) {
    let globalMinVal = Infinity;
    let globalMinTau = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cmndf[tau] < globalMinVal) {
        globalMinVal = cmndf[tau];
        globalMinTau = tau;
      }
    }
    if (globalMinTau === -1 || globalMinVal > fallbackCeiling) {
      return null;
    }
    bestTau = globalMinTau;
  }

  // Subharmonic guard: if inharmonic overtones caused a beat period (~2*T0 or ~3*T0)
  // to dip deeper than T0, promote T0 whenever a clear local minimum exists near bestTau/div
  // and carries stronger actual spectral power than the phantom subharmonic.
  let promoted = true;
  while (promoted) {
    promoted = false;
    const bestPower = windowedDtftPower(centered, sampleRate, sampleRate / bestTau);

    for (const divisor of [2, 3] as const) {
      const targetCenter = bestTau / divisor;
      if (targetCenter < tauMin) {
        continue;
      }

      const searchLow = Math.max(tauMin, Math.floor(targetCenter * 0.88));
      const searchHigh = Math.min(tauMax - 1, Math.ceil(targetCenter * 1.12));
      let localTau = -1;
      let localVal = Infinity;

      for (let t = searchLow; t <= searchHigh; t++) {
        if (cmndf[t] < localVal) {
          localVal = cmndf[t];
          localTau = t;
        }
      }

      if (
        localTau >= tauMin &&
        localTau < tauMax &&
        localVal < 0.45 &&
        cmndf[localTau] <= cmndf[localTau - 1] &&
        cmndf[localTau] <= cmndf[localTau + 1]
      ) {
        const subPower = windowedDtftPower(centered, sampleRate, sampleRate / localTau);
        if (subPower >= bestPower * 1.2 || localVal < 0.35) {
          bestTau = localTau;
          promoted = true;
          break;
        }
      }
    }
  }

  // Step 4: Parabolic interpolation around bestTau
  let refinedTau = bestTau;
  let refinedMin = cmndf[bestTau];

  if (bestTau > 1 && bestTau < tauMax) {
    const y0 = cmndf[bestTau - 1];
    const y1 = cmndf[bestTau];
    const y2 = cmndf[bestTau + 1];
    const denom = 2 * (y0 - 2 * y1 + y2);

    if (Math.abs(denom) > 1e-12) {
      const shift = Math.max(-1, Math.min(1, (y0 - y2) / denom));
      refinedTau = bestTau + shift;
      refinedMin = Math.max(0, y1 - 0.25 * (y0 - y2) * shift);
    }
  }

  const yinHz = sampleRate / refinedTau;
  if (!Number.isFinite(yinHz) || yinHz < minHz * 0.95 || yinHz > maxHz * 1.05) {
    return null;
  }

  const frequencyHz = refineFundamentalViaDtft(centered, sampleRate, yinHz, minHz, maxHz);
  const confidence = Math.max(0, Math.min(1, 1 - refinedMin));
  return {
    frequencyHz,
    confidence,
  };
}
