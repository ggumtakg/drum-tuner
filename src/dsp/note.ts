export interface NoteInfo {
  name: string;
  octave: number;
  label: string;
  cents: number;
}

export type TuningStatus = 'low' | 'in-tune' | 'high';

export interface TuningEvaluation {
  deltaHz: number;
  status: TuningStatus;
  normalizedOffset: number;
  measuredNote: NoteInfo;
  targetNote: NoteInfo;
}

const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

const A4_HZ = 440;
const A4_MIDI = 69;

/**
 * Converts a positive frequency in Hz to its nearest equal-tempered musical note (A4 = 440 Hz).
 */
export function frequencyToNote(hz: number): NoteInfo {
  if (!Number.isFinite(hz) || hz <= 0) {
    throw new RangeError(`Frequency must be a finite positive number, received: ${hz}`);
  }

  const midiFloat = A4_MIDI + 12 * Math.log2(hz / A4_HZ);
  const midiRounded = Math.round(midiFloat);
  const rawCents = Math.round((midiFloat - midiRounded) * 100);
  const cents = rawCents === 0 ? 0 : rawCents;

  const noteIndex = ((midiRounded % 12) + 12) % 12;
  const octave = Math.floor(midiRounded / 12) - 1;
  const name = NOTE_NAMES[noteIndex];

  return {
    name,
    octave,
    label: `${name}${octave}`,
    cents,
  };
}

/**
 * Evaluates a measured drum fundamental frequency against a target frequency and tolerance.
 */
export function evaluateTuning(
  measuredHz: number,
  targetHz: number,
  toleranceHz: number,
): TuningEvaluation {
  if (!Number.isFinite(measuredHz) || measuredHz <= 0) {
    throw new RangeError(`measuredHz must be positive, received: ${measuredHz}`);
  }
  if (!Number.isFinite(targetHz) || targetHz <= 0) {
    throw new RangeError(`targetHz must be positive, received: ${targetHz}`);
  }
  if (!Number.isFinite(toleranceHz) || toleranceHz < 0) {
    throw new RangeError(`toleranceHz must be non-negative, received: ${toleranceHz}`);
  }

  const deltaHz = measuredHz - targetHz;
  let status: TuningStatus;
  if (Math.abs(deltaHz) <= toleranceHz) {
    status = 'in-tune';
  } else if (deltaHz < 0) {
    status = 'low';
  } else {
    status = 'high';
  }

  // Scale gauge span gracefully across low kicks (60 Hz) and high snares (250+ Hz).
  const fullScaleHz = Math.max(toleranceHz * 8, targetHz * 0.12, 8);
  const normalizedOffset = Math.max(-1, Math.min(1, deltaHz / fullScaleHz));

  return {
    deltaHz,
    status,
    normalizedOffset: normalizedOffset === 0 ? 0 : normalizedOffset,
    measuredNote: frequencyToNote(measuredHz),
    targetNote: frequencyToNote(targetHz),
  };
}
