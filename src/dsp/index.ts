export {
  frequencyToNote,
  evaluateTuning,
  type NoteInfo,
  type TuningStatus,
  type TuningEvaluation,
} from './note.ts';

export {
  BiquadFilter,
  CascadedBandpassFilter,
  computeBandpassRange,
  DEFAULT_DRUM_BAND,
  type BiquadFilterType,
  type BandpassRange,
  type TargetBandOptions,
} from './biquad.ts';

export {
  detectDrumPitch,
  type PitchDetectionOptions,
  type PitchDetectionResult,
} from './pitch.ts';

export {
  DrumHitAnalyzer,
  linearToDb,
  dbToLinear,
  type DrumHitAnalyzerConfig,
  type DrumHitAnalyzerUpdate,
  type HitStatus,
  type DrumHitResult,
  type CalibrationResult,
  type FrameAnalysisResult,
} from './hitDetector.ts';
