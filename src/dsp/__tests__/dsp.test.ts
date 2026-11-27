import { describe, expect, it } from 'vitest';
import {
  CascadedBandpassFilter,
  DrumHitAnalyzer,
  computeBandpassRange,
  detectDrumPitch,
  evaluateTuning,
  frequencyToNote,
  linearToDb,
  type DrumHitResult,
} from '../index.ts';

const SAMPLE_RATE = 48000;
const FRAME_SIZE = 1024;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function generateNoise(length: number, amplitude: number, seed = 42): Float32Array {
  const rand = createSeededRandom(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (rand() * 2 - 1) * amplitude;
  }
  return out;
}

function generateSine(
  freqHz: number,
  length: number,
  sampleRate = SAMPLE_RATE,
  amplitude = 0.6,
): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

/**
 * Synthesizes a realistic drum hit:
 * - brief 5 ms broadband stick attack click
 * - exponentially decaying fundamental
 * - circular membrane inharmonic overtones at 1.59x and 2.14x
 */
function synthesizeDrumHit(options: {
  fundamentalHz: number;
  sampleRate?: number;
  durationSec?: number;
  amplitude?: number;
  decaySec?: number;
  overtone1Ratio?: number;
  overtone2Ratio?: number;
  clickAmplitude?: number;
  seed?: number;
}): Float32Array {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const durationSec = options.durationSec ?? 0.35;
  const amplitude = options.amplitude ?? 0.55;
  const decaySec = options.decaySec ?? 0.18;
  const overtone1Ratio = options.overtone1Ratio ?? 0.42;
  const overtone2Ratio = options.overtone2Ratio ?? 0.24;
  const clickAmplitude = options.clickAmplitude ?? 0.25;

  const totalSamples = Math.round(durationSec * sampleRate);
  const out = new Float32Array(totalSamples);
  const rand = createSeededRandom(options.seed ?? 1337);
  const clickSamples = Math.round(0.005 * sampleRate);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const envFund = Math.exp(-t / decaySec);
    const envOver1 = Math.exp(-t / (decaySec * 0.55));
    const envOver2 = Math.exp(-t / (decaySec * 0.35));

    const fundamental = Math.sin(2 * Math.PI * options.fundamentalHz * t) * envFund;
    const overtone1 =
      overtone1Ratio * Math.sin(2 * Math.PI * options.fundamentalHz * 1.59 * t) * envOver1;
    const overtone2 =
      overtone2Ratio * Math.sin(2 * Math.PI * options.fundamentalHz * 2.14 * t) * envOver2;

    let click = 0;
    if (i < clickSamples) {
      click = (rand() * 2 - 1) * clickAmplitude * (1 - i / clickSamples);
    }

    out[i] = amplitude * (fundamental + overtone1 + overtone2) + click;
  }

  return out;
}

function feedSignalInFrames(
  analyzer: DrumHitAnalyzer,
  signal: Float32Array,
  startTimestamp = 1000,
  sampleRate = SAMPLE_RATE,
): {
  hits: DrumHitResult[];
  calibrationResults: Array<{ noiseFloorDb: number; recommendedGateThresholdDb: number }>;
} {
  const hits: DrumHitResult[] = [];
  const calibrationResults: Array<{ noiseFloorDb: number; recommendedGateThresholdDb: number }> =
    [];

  for (let offset = 0; offset < signal.length; offset += FRAME_SIZE) {
    const frame = signal.subarray(offset, Math.min(signal.length, offset + FRAME_SIZE));
    const frameTime = startTimestamp + Math.round((offset / sampleRate) * 1000);
    const res = analyzer.processFrame(frame, frameTime);
    if (res.calibrationResult) {
      calibrationResults.push(res.calibrationResult);
    }
    if (res.hit) {
      hits.push(res.hit);
    }
  }

  return { hits, calibrationResults };
}

describe('note & tuning evaluation', () => {
  it('converts reference frequencies to musical notes accurately', () => {
    expect(frequencyToNote(220)).toEqual({
      name: 'A',
      octave: 3,
      label: 'A3',
      cents: 0,
    });
    expect(frequencyToNote(440)).toEqual({
      name: 'A',
      octave: 4,
      label: 'A4',
      cents: 0,
    });
  });

  it('evaluates low, in-tune, and high states with normalized gauge offset', () => {
    const low = evaluateTuning(96.5, 100, 1.0);
    expect(low.status).toBe('low');
    expect(low.deltaHz).toBeCloseTo(-3.5, 5);
    expect(low.normalizedOffset).toBeLessThan(0);

    const exactTolerance = evaluateTuning(101.0, 100, 1.0);
    expect(exactTolerance.status).toBe('in-tune');
    expect(exactTolerance.deltaHz).toBeCloseTo(1.0, 5);

    const high = evaluateTuning(104.2, 100, 1.0);
    expect(high.status).toBe('high');
    expect(high.deltaHz).toBeCloseTo(4.2, 5);
    expect(high.normalizedOffset).toBeGreaterThan(0);
    expect(high.targetNote.label).toBe('G2');
  });
});

describe('biquad & cascaded bandpass filter', () => {
  it('computes default and target-focused ranges with guaranteed minimum bandwidth', () => {
    expect(
      computeBandpassRange({ targetHz: 100, targetFilterEnabled: false }),
    ).toEqual({ lowHz: 30, highHz: 600 });

    expect(
      computeBandpassRange({
        targetHz: 100,
        targetFilterEnabled: true,
        targetFilterSpanPct: 40,
      }),
    ).toEqual({ lowHz: 60, highHz: 140 });

    // Near lower clamp, ensure at least 25 Hz span
    const narrowLow = computeBandpassRange({
      targetHz: 32,
      targetFilterEnabled: true,
      targetFilterSpanPct: 15,
    });
    expect(narrowLow.lowHz).toBeGreaterThanOrEqual(30);
    expect(narrowLow.highHz - narrowLow.lowHz).toBeGreaterThanOrEqual(25);
  });

  it('passes target fundamental while attenuating out-of-band frequencies', () => {
    const filter = new CascadedBandpassFilter(SAMPLE_RATE, 70, 130);
    const inBand = filter.processBlock(generateSine(100, 8192, SAMPLE_RATE, 0.5));
    filter.reset();
    const outBand = filter.processBlock(generateSine(800, 8192, SAMPLE_RATE, 0.5));

    const rms = (buf: Float32Array) => {
      let sum = 0;
      // Measure steady-state second half
      for (let i = 4096; i < buf.length; i++) {
        sum += buf[i] * buf[i];
      }
      return Math.sqrt(sum / 4096);
    };

    expect(rms(inBand)).toBeGreaterThan(0.25);
    expect(rms(outBand)).toBeLessThan(0.01);
  });
});

describe('detectDrumPitch (YIN)', () => {
  it.each([60, 100, 150, 220, 340])(
    'measures pure %d Hz sine within <= 0.5 Hz',
    (freqHz) => {
      const sine = generateSine(freqHz, 4096, SAMPLE_RATE, 0.6);
      const result = detectDrumPitch(sine, SAMPLE_RATE);

      expect(result).not.toBeNull();
      expect(Math.abs(result!.frequencyHz - freqHz)).toBeLessThanOrEqual(0.5);
      expect(result!.confidence).toBeGreaterThan(0.95);
    },
  );
});

describe('DrumHitAnalyzer', () => {
  it('accurately tracks decaying drum hits with inharmonic overtones and attack click', () => {
    for (const targetHz of [60, 110, 200]) {
      const analyzer = new DrumHitAnalyzer({
        sampleRate: SAMPLE_RATE,
        targetHz,
        gateThresholdDb: -36,
        targetFilterEnabled: false,
        targetFilterSpanPct: 40,
      });

      const preRoll = new Float32Array(Math.round(0.1 * SAMPLE_RATE));
      const hitSignal = synthesizeDrumHit({ fundamentalHz: targetHz, amplitude: 0.45 });
      const combined = new Float32Array(preRoll.length + hitSignal.length);
      combined.set(preRoll, 0);
      combined.set(hitSignal, preRoll.length);

      const { hits } = feedSignalInFrames(analyzer, combined);

      expect(hits).toHaveLength(1);
      expect(hits[0].status).toBe('valid');
      expect(hits[0].measuredHz).not.toBeNull();
      expect(Math.abs(hits[0].measuredHz! - targetHz)).toBeLessThanOrEqual(0.5);
    }
  });

  it('produces zero false triggers on continuous broadband ambient noise', () => {
    const analyzer = new DrumHitAnalyzer({
      sampleRate: SAMPLE_RATE,
      targetHz: 100,
      gateThresholdDb: -36,
      targetFilterEnabled: true,
      targetFilterSpanPct: 40,
    });

    // Moderate continuous broadband noise for 2.5 seconds
    const noiseModerate = generateNoise(Math.round(2.5 * SAMPLE_RATE), 0.04, 101);
    const moderateResult = feedSignalInFrames(analyzer, noiseModerate);
    expect(moderateResult.hits).toHaveLength(0);

    // Even louder continuous broadband noise exceeding gate level should be blocked by transient ratio
    const loudAnalyzer = new DrumHitAnalyzer({
      sampleRate: SAMPLE_RATE,
      targetHz: 100,
      gateThresholdDb: -36,
      targetFilterEnabled: false,
      targetFilterSpanPct: 40,
    });
    const noiseLoud = generateNoise(Math.round(2.5 * SAMPLE_RATE), 0.15, 202);
    const loudResult = feedSignalInFrames(loudAnalyzer, noiseLoud);
    expect(loudResult.hits).toHaveLength(0);
  });

  it('calibrates ambient noise, captures drum hits in noise with target filter, and evaluates low/in-tune/high', () => {
    const targetHz = 100;
    const toleranceHz = 1.0;

    const analyzer = new DrumHitAnalyzer({
      sampleRate: SAMPLE_RATE,
      targetHz,
      gateThresholdDb: -48,
      targetFilterEnabled: true,
      targetFilterSpanPct: 40,
    });

    // Step 1: 1.5s noise calibration on ambient room noise
    const calibrationNoise = generateNoise(Math.round(1.6 * SAMPLE_RATE), 0.08, 303);
    analyzer.startCalibration(1500);
    const calRun = feedSignalInFrames(analyzer, calibrationNoise);

    expect(calRun.calibrationResults).toHaveLength(1);
    expect(calRun.hits).toHaveLength(0);
    expect(calRun.calibrationResults[0].recommendedGateThresholdDb).toBeGreaterThan(
      calRun.calibrationResults[0].noiseFloorDb,
    );

    // Step 2: Mix three sequential drum hits (low 96 Hz, in-tune 100.3 Hz, high 104.5 Hz) into continuous broadband noise
    const testCases: Array<{ hz: number; expectedStatus: 'low' | 'in-tune' | 'high' }> = [
      { hz: 96.0, expectedStatus: 'low' },
      { hz: 100.3, expectedStatus: 'in-tune' },
      { hz: 104.5, expectedStatus: 'high' },
    ];

    const totalSec = 2.4;
    const mixed = generateNoise(Math.round(totalSec * SAMPLE_RATE), 0.08, 404);
    const hitOffsetsSec = [0.25, 1.0, 1.75];

    testCases.forEach((tc, idx) => {
      const drum = synthesizeDrumHit({
        fundamentalHz: tc.hz,
        amplitude: 0.45,
        seed: 500 + idx,
      });
      const startSample = Math.round(hitOffsetsSec[idx] * SAMPLE_RATE);
      for (let i = 0; i < drum.length && startSample + i < mixed.length; i++) {
        mixed[startSample + i] += drum[i];
      }
    });

    const run = feedSignalInFrames(analyzer, mixed);
    expect(run.hits).toHaveLength(3);

    testCases.forEach((tc, idx) => {
      const hit = run.hits[idx];
      expect(hit.status).toBe('valid');
      expect(hit.measuredHz).not.toBeNull();
      expect(Math.abs(hit.measuredHz! - tc.hz)).toBeLessThanOrEqual(0.5);

      const evaluation = evaluateTuning(hit.measuredHz!, targetHz, toleranceHz);
      expect(evaluation.status).toBe(tc.expectedStatus);
    });
  });

  it('flags clipped signals and rejects random broadband noise spikes as low-confidence', () => {
    // Clipped signal test
    const clipAnalyzer = new DrumHitAnalyzer({
      sampleRate: SAMPLE_RATE,
      targetHz: 120,
      gateThresholdDb: -36,
      targetFilterEnabled: true,
      targetFilterSpanPct: 40,
    });

    const preRoll = new Float32Array(Math.round(0.1 * SAMPLE_RATE));
    const clippedHit = synthesizeDrumHit({ fundamentalHz: 120, amplitude: 0.95 });
    for (let i = 0; i < clippedHit.length; i++) {
      clippedHit[i] = Math.max(-1, Math.min(1, clippedHit[i] * 1.4));
    }
    const clipBuffer = new Float32Array(preRoll.length + clippedHit.length);
    clipBuffer.set(preRoll, 0);
    clipBuffer.set(clippedHit, preRoll.length);

    const clipRun = feedSignalInFrames(clipAnalyzer, clipBuffer);
    expect(clipRun.hits).toHaveLength(1);
    expect(clipRun.hits[0].status).toBe('clipped');
    expect(clipRun.hits[0].measuredHz).toBeNull();

    // Random noise spike test (broadband unpitched burst, not a drum tone)
    const spikeAnalyzer = new DrumHitAnalyzer({
      sampleRate: SAMPLE_RATE,
      targetHz: 150,
      gateThresholdDb: -36,
      targetFilterEnabled: false,
      targetFilterSpanPct: 40,
    });

    const spikeBuffer = new Float32Array(Math.round(0.5 * SAMPLE_RATE));
    const spikeStart = Math.round(0.1 * SAMPLE_RATE);
    const spikeBurst = generateNoise(Math.round(0.15 * SAMPLE_RATE), 0.35, 999);
    spikeBuffer.set(spikeBurst, spikeStart);

    const spikeRun = feedSignalInFrames(spikeAnalyzer, spikeBuffer);
    expect(spikeRun.hits).toHaveLength(1);
    expect(spikeRun.hits[0].status).toBe('low-confidence');
  });

  it('calibrates with P95 on intermittent speech bursts and blocks conversational false triggers', () => {
    const targetHz = 150;
    const analyzer = new DrumHitAnalyzer({
      sampleRate: SAMPLE_RATE,
      targetHz,
      gateThresholdDb: -48,
      targetFilterEnabled: true,
      targetFilterSpanPct: 40,
    });

    // 2.1s of intermittent speech syllables (85~240 Hz varying pitch + formants) with silent pauses
    const calSpeech = synthesizeIntermittentSpeech(2.1, 0.09, 701);

    // Measure what overall average filtered RMS would have been over the 2.0s calibration window
    const band = computeBandpassRange({
      targetHz,
      targetFilterEnabled: true,
      targetFilterSpanPct: 40,
    });
    const refFilter = new CascadedBandpassFilter(SAMPLE_RATE, band.lowHz, band.highHz);
    const calSamples = Math.round(2.0 * SAMPLE_RATE);
    const filteredCal = refFilter.processBlock(calSpeech.subarray(0, calSamples));
    let sumSq = 0;
    for (let i = 0; i < filteredCal.length; i++) {
      sumSq += filteredCal[i] * filteredCal[i];
    }
    const avgFilteredDb = linearToDb(Math.sqrt(sumSq / filteredCal.length));

    // Default calibration duration (2000ms)
    analyzer.startCalibration();
    const calRun = feedSignalInFrames(analyzer, calSpeech);

    expect(calRun.calibrationResults).toHaveLength(1);
    expect(calRun.hits).toHaveLength(0);

    const cal = calRun.calibrationResults[0];
    // P95 noise floor must sit meaningfully above the pause-diluted average RMS
    expect(cal.noiseFloorDb).toBeGreaterThan(avgFilteredDb + 2.5);
    expect(cal.recommendedGateThresholdDb).toBeGreaterThan(Math.round(avgFilteredDb + 10));

    // Subsequent intermittent speech bursts must produce zero valid drum hits
    const followUpSpeech = synthesizeIntermittentSpeech(2.5, 0.09, 702);
    const speechRun = feedSignalInFrames(analyzer, followUpSpeech, 4000);
    const validSpeechHits = speechRun.hits.filter((h) => h.status === 'valid');
    expect(validSpeechHits).toHaveLength(0);
  });

  it('rejects band (bass + guitar chords) + speech background and accurately measures close-mic drum hits', () => {
    const targetHz = 120;
    const toleranceHz = 1.0;

    const analyzer = new DrumHitAnalyzer({
      sampleRate: SAMPLE_RATE,
      targetHz,
      gateThresholdDb: -48,
      targetFilterEnabled: true,
      targetFilterSpanPct: 40,
    });

    // Step 1: 2s P95 calibration on rehearsal room band (bass + guitar chords) + speech
    const calBackground = synthesizeBandAndSpeechBackground(2.1, 801);
    analyzer.startCalibration(2000);
    const calRun = feedSignalInFrames(analyzer, calBackground);
    expect(calRun.calibrationResults).toHaveLength(1);
    expect(calRun.hits).toHaveLength(0);

    // Step 2: Background only (bass + guitar chords + speech) must trigger zero valid hits
    const backgroundOnly = synthesizeBandAndSpeechBackground(2.5, 802);
    const bgRun = feedSignalInFrames(analyzer, backgroundOnly, 4000);
    expect(bgRun.hits.filter((h) => h.status === 'valid')).toHaveLength(0);

    // Step 3: Close-mic drum hits (low, in-tune, high) layered over the same band + speech background
    const testCases: Array<{ hz: number; expectedStatus: 'low' | 'in-tune' | 'high' }> = [
      { hz: 115.5, expectedStatus: 'low' },
      { hz: 120.2, expectedStatus: 'in-tune' },
      { hz: 124.8, expectedStatus: 'high' },
    ];

    const mixed = synthesizeBandAndSpeechBackground(2.6, 803);
    const hitOffsetsSec = [0.3, 1.1, 1.9];

    testCases.forEach((tc, idx) => {
      const drum = synthesizeDrumHit({
        fundamentalHz: tc.hz,
        amplitude: 0.45,
        seed: 850 + idx,
      });
      const startSample = Math.round(hitOffsetsSec[idx] * SAMPLE_RATE);
      for (let i = 0; i < drum.length && startSample + i < mixed.length; i++) {
        mixed[startSample + i] += drum[i];
      }
    });

    const mixedRun = feedSignalInFrames(analyzer, mixed, 8000);
    expect(mixedRun.hits.map((h) => h.status)).toEqual(['valid', 'valid', 'valid']);
    const validHits = mixedRun.hits;

    testCases.forEach((tc, idx) => {
      const hit = validHits[idx];
      expect(hit.measuredHz).not.toBeNull();
      expect(Math.abs(hit.measuredHz! - tc.hz)).toBeLessThanOrEqual(0.5);

      const evaluation = evaluateTuning(hit.measuredHz!, targetHz, toleranceHz);
      expect(evaluation.status).toBe(tc.expectedStatus);
    });
  });

  it('rejects close-mic speech intonation glides exceeding the gate as low-confidence via pitch stability', () => {
    const glideCases: Array<{ startHz: number; endHz: number; seed: number }> = [
      { startHz: 115, endHz: 185, seed: 901 },
      { startHz: 185, endHz: 115, seed: 902 },
    ];

    for (const glide of glideCases) {
      const analyzer = new DrumHitAnalyzer({
        sampleRate: SAMPLE_RATE,
        targetHz: 150,
        gateThresholdDb: -36,
        targetFilterEnabled: true,
        targetFilterSpanPct: 40,
      });

      const buffer = new Float32Array(Math.round(0.6 * SAMPLE_RATE));
      const syllable = synthesizeSpeechSyllable({
        startHz: glide.startHz,
        endHz: glide.endHz,
        durationSec: 0.14,
        amplitude: 0.35,
        abruptOnset: true,
        seed: glide.seed,
      });
      buffer.set(syllable, Math.round(0.12 * SAMPLE_RATE));

      const run = feedSignalInFrames(analyzer, buffer);
      expect(run.hits).toHaveLength(1);
      expect(run.hits[0].status).toBe('low-confidence');
      expect(run.hits.filter((h) => h.status === 'valid')).toHaveLength(0);
    }
  });

  it('accurately measures 30.0 Hz lower-bound drum hits at 48 kHz with target filter both ON and OFF', () => {
    for (const targetFilterEnabled of [false, true]) {
      const analyzer = new DrumHitAnalyzer({
        sampleRate: SAMPLE_RATE,
        targetHz: 30,
        gateThresholdDb: -36,
        targetFilterEnabled,
        targetFilterSpanPct: 40,
      });

      const preRoll = new Float32Array(Math.round(0.1 * SAMPLE_RATE));
      const hitSignal = synthesizeDrumHit({
        fundamentalHz: 30.0,
        sampleRate: SAMPLE_RATE,
        durationSec: 0.45,
        decaySec: 0.25,
        amplitude: 0.5,
      });
      const combined = new Float32Array(preRoll.length + hitSignal.length);
      combined.set(preRoll, 0);
      combined.set(hitSignal, preRoll.length);

      const { hits } = feedSignalInFrames(analyzer, combined, 1000, SAMPLE_RATE);

      expect(hits).toHaveLength(1);
      expect(hits[0].status).toBe('valid');
      expect(hits[0].measuredHz).not.toBeNull();
      expect(Math.abs(hits[0].measuredHz! - 30.0)).toBeLessThanOrEqual(0.5);
    }
  });

  it('accurately measures 60.0 Hz kick drum hits at high sample rate (96 kHz)', () => {
    const highSampleRate = 96000;
    const analyzer = new DrumHitAnalyzer({
      sampleRate: highSampleRate,
      targetHz: 60,
      gateThresholdDb: -36,
      targetFilterEnabled: true,
      targetFilterSpanPct: 40,
    });

    const preRoll = new Float32Array(Math.round(0.1 * highSampleRate));
    const hitSignal = synthesizeDrumHit({
      fundamentalHz: 60.0,
      sampleRate: highSampleRate,
      durationSec: 0.4,
      decaySec: 0.22,
      amplitude: 0.5,
    });
    const combined = new Float32Array(preRoll.length + hitSignal.length);
    combined.set(preRoll, 0);
    combined.set(hitSignal, preRoll.length);

    const { hits } = feedSignalInFrames(analyzer, combined, 1000, highSampleRate);

    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe('valid');
    expect(hits[0].measuredHz).not.toBeNull();
    expect(Math.abs(hits[0].measuredHz! - 60.0)).toBeLessThanOrEqual(0.5);
  });

  it('preserves calibrated noiseFloorDb and in-progress calibration when clearCapture() is called', () => {
    const analyzer = new DrumHitAnalyzer({
      sampleRate: SAMPLE_RATE,
      targetHz: 120,
      gateThresholdDb: -48,
      targetFilterEnabled: true,
      targetFilterSpanPct: 40,
    });

    // 1. Start calibration and call clearCapture() halfway through — calibration must continue and complete
    analyzer.startCalibration(2000);
    const firstHalfNoise = generateNoise(Math.round(1.0 * SAMPLE_RATE), 0.12, 1101);
    const firstHalf = feedSignalInFrames(analyzer, firstHalfNoise, 1000);
    expect(firstHalf.calibrationResults).toHaveLength(0);

    analyzer.clearCapture();

    const probeMid = analyzer.processFrame(new Float32Array(0), 2000);
    expect(probeMid.isCalibrating).toBe(true);
    expect(probeMid.calibrationProgress).toBeGreaterThan(0.4);
    expect(probeMid.calibrationProgress).toBeLessThan(0.7);

    const secondHalfNoise = generateNoise(Math.round(1.1 * SAMPLE_RATE), 0.12, 1102);
    const secondHalf = feedSignalInFrames(analyzer, secondHalfNoise, 2000);
    expect(secondHalf.calibrationResults).toHaveLength(1);

    const calibratedNoiseDb = secondHalf.calibrationResults[0].noiseFloorDb;
    const calibratedGateDb = secondHalf.calibrationResults[0].recommendedGateThresholdDb;
    expect(calibratedNoiseDb).toBeGreaterThan(-45);

    // 2. Call clearCapture() after calibration completes — noise floor & gate must be preserved
    const beforeClear = analyzer.processFrame(new Float32Array(0), 3150);
    analyzer.clearCapture();
    const afterClear = analyzer.processFrame(new Float32Array(0), 3200);
    expect(afterClear.isCalibrating).toBe(false);
    expect(afterClear.noiseFloorDb).toBeCloseTo(beforeClear.noiseFloorDb, 5);
    expect(afterClear.noiseFloorDb).toBeGreaterThan(-46);
    expect(afterClear.gateThresholdDb).toBe(calibratedGateDb);
  });
});

function synthesizeSpeechSyllable(options: {
  startHz: number;
  endHz: number;
  durationSec: number;
  amplitude: number;
  abruptOnset?: boolean;
  seed?: number;
}): Float32Array {
  const totalSamples = Math.round(options.durationSec * SAMPLE_RATE);
  const out = new Float32Array(totalSamples);
  const rand = createSeededRandom(options.seed ?? 777);
  const attackSec = options.abruptOnset ? 0.008 : 0.024;
  const releaseSec = 0.028;

  let phase1 = 0;
  let phase2 = 0;
  let phase3 = 0;
  let formantPhase = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const progress = totalSamples > 1 ? i / (totalSamples - 1) : 0;
    const f0 = options.startHz + (options.endHz - options.startHz) * progress;

    phase1 += (2 * Math.PI * f0) / SAMPLE_RATE;
    phase2 += (2 * Math.PI * f0 * 2) / SAMPLE_RATE;
    phase3 += (2 * Math.PI * f0 * 3) / SAMPLE_RATE;
    formantPhase += (2 * Math.PI * (520 + 260 * progress)) / SAMPLE_RATE;

    let env = 1;
    if (t < attackSec) {
      env = t / attackSec;
    } else if (t > options.durationSec - releaseSec) {
      env = Math.max(0, (options.durationSec - t) / releaseSec);
    }

    const voiced =
      0.62 * Math.sin(phase1) +
      0.28 * Math.sin(phase2) +
      0.14 * Math.sin(phase3) +
      0.18 * Math.sin(formantPhase);
    const breath = (rand() * 2 - 1) * 0.04;

    out[i] = options.amplitude * env * (voiced + breath);
  }

  return out;
}

function synthesizeIntermittentSpeech(
  durationSec: number,
  amplitude: number,
  seed: number,
): Float32Array {
  const totalSamples = Math.round(durationSec * SAMPLE_RATE);
  const out = new Float32Array(totalSamples);
  const rand = createSeededRandom(seed);

  // Subtle room floor during pauses
  for (let i = 0; i < totalSamples; i++) {
    out[i] = (rand() * 2 - 1) * (amplitude * 0.03);
  }

  const contours: Array<[number, number, number]> = [
    [105, 150, 0.16],
    [195, 130, 0.18],
    [90, 135, 0.15],
    [225, 165, 0.17],
    [125, 185, 0.16],
    [165, 100, 0.18],
  ];

  // Place syllables with generous silence pauses (~30% active speech duty cycle)
  let cursorSec = 0.15;
  let idx = 0;
  while (cursorSec + 0.18 < durationSec) {
    const [startHz, endHz, sylDur] = contours[idx % contours.length];
    const syllable = synthesizeSpeechSyllable({
      startHz,
      endHz,
      durationSec: sylDur,
      amplitude: amplitude * (0.85 + 0.25 * rand()),
      seed: seed + idx * 17,
    });

    const startSample = Math.round(cursorSec * SAMPLE_RATE);
    for (let i = 0; i < syllable.length && startSample + i < totalSamples; i++) {
      out[startSample + i] += syllable[i];
    }

    cursorSec += sylDur + 0.34 + 0.12 * rand();
    idx++;
  }

  return out;
}

function synthesizeBandAndSpeechBackground(durationSec: number, seed: number): Float32Array {
  const totalSamples = Math.round(durationSec * SAMPLE_RATE);
  const out = new Float32Array(totalSamples);
  const rand = createSeededRandom(seed);

  // 1. Bass guitar line (49~82.4 Hz with 2nd & 3rd harmonics overlapping drum range)
  const bassNotes = [55.0, 65.4, 73.4, 82.4, 49.0];
  const bassStepSec = 0.45;
  for (let n = 0; n * bassStepSec < durationSec; n++) {
    const noteHz = bassNotes[n % bassNotes.length];
    const startSample = Math.round(n * bassStepSec * SAMPLE_RATE);
    const noteSamples = Math.round(bassStepSec * SAMPLE_RATE);

    for (let i = 0; i < noteSamples && startSample + i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.min(1, t / 0.015) * Math.exp(-t / 0.32);
      const bass =
        0.65 * Math.sin(2 * Math.PI * noteHz * t) +
        0.3 * Math.sin(2 * Math.PI * noteHz * 2 * t) +
        0.15 * Math.sin(2 * Math.PI * noteHz * 3 * t);
      out[startSample + i] += 0.055 * env * bass;
    }
  }

  // 2. Polyphonic guitar chords (strums across 110~440 Hz)
  const guitarChords = [
    [110.0, 164.8, 220.0, 261.6, 329.6],
    [98.0, 146.8, 196.0, 246.9, 392.0],
    [146.8, 220.0, 293.7, 370.0, 440.0],
  ];
  const chordStepSec = 0.55;
  for (let c = 0; c * chordStepSec < durationSec; c++) {
    const chord = guitarChords[c % guitarChords.length];
    const startSample = Math.round(c * chordStepSec * SAMPLE_RATE);
    const chordSamples = Math.round(chordStepSec * SAMPLE_RATE);

    for (let i = 0; i < chordSamples && startSample + i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.42);
      let sum = 0;
      for (let s = 0; s < chord.length; s++) {
        sum += Math.sin(2 * Math.PI * chord[s] * t) + 0.35 * Math.sin(2 * Math.PI * chord[s] * 2 * t);
      }
      out[startSample + i] += (0.04 / chord.length) * env * sum;
    }
  }

  // 3. Intermittent rehearsal speech syllables
  const speech = synthesizeIntermittentSpeech(durationSec, 0.06, seed + 55);
  for (let i = 0; i < totalSamples; i++) {
    out[i] += speech[i] + (rand() * 2 - 1) * 0.012;
  }

  return out;
}
