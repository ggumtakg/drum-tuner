export const STORAGE_KEY = 'drum_tuner_v1';
export const STORAGE_VERSION = 1 as const;

export const MIN_TARGET_HZ = 30;
export const MAX_TARGET_HZ = 600;
export const MIN_NAME_LENGTH = 1;
export const MAX_NAME_LENGTH = 40;
export const MIN_TOLERANCE_HZ = 0.2;
export const MAX_TOLERANCE_HZ = 5.0;
export const DEFAULT_TOLERANCE_HZ = 1.0;
export const MIN_GATE_THRESHOLD_DB = -60;
export const MAX_GATE_THRESHOLD_DB = -6;
export const DEFAULT_GATE_THRESHOLD_DB = -36;
export const DEFAULT_TARGET_FILTER_ENABLED = true;
export const MIN_TARGET_FILTER_SPAN_PCT = 15;
export const MAX_TARGET_FILTER_SPAN_PCT = 80;
export const DEFAULT_TARGET_FILTER_SPAN_PCT = 40;

export interface DrumPreset {
  id: string;
  name: string;
  targetHz: number;
  updatedAt: number;
}

export interface DrumKit {
  id: string;
  name: string;
  presetIds: string[];
  updatedAt: number;
}

export interface TunerSettings {
  toleranceHz: number;
  gateThresholdDb: number;
  targetFilterEnabled: boolean;
  targetFilterSpanPct: number;
}

export interface LastSelection {
  mode: 'single' | 'kit';
  activePresetId: string | null;
  activeKitId: string | null;
  activeKitIndex: number;
  manualTargetHz: number;
}

export interface PersistedState {
  version: typeof STORAGE_VERSION;
  presets: DrumPreset[];
  kits: DrumKit[];
  settings: TunerSettings;
  lastSelection: LastSelection;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export interface PresetInput {
  id?: string;
  name: string;
  targetHz: number;
  now?: number;
}

export interface PresetPatch {
  name?: string;
  targetHz?: number;
  now?: number;
}

export interface KitInput {
  id?: string;
  name: string;
  presetIds: string[];
  now?: number;
}

export interface KitPatch {
  name?: string;
  presetIds?: string[];
  now?: number;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function generateId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function validateName(rawName: string): string {
  if (typeof rawName !== 'string') {
    throw new RangeError('이름은 문자열이어야 합니다.');
  }
  const trimmed = rawName.trim();
  if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) {
    throw new RangeError(
      `이름은 공백 제거 후 ${MIN_NAME_LENGTH}~${MAX_NAME_LENGTH}자여야 합니다.`,
    );
  }
  return trimmed;
}

export function validateTargetHz(hz: number): number {
  if (typeof hz !== 'number' || !Number.isFinite(hz)) {
    throw new RangeError('목표 주파수는 유한한 숫자여야 합니다.');
  }
  if (hz < MIN_TARGET_HZ || hz > MAX_TARGET_HZ) {
    throw new RangeError(
      `목표 주파수는 ${MIN_TARGET_HZ}~${MAX_TARGET_HZ} Hz 범위여야 합니다.`,
    );
  }
  return roundToOneDecimal(hz);
}

export function validateToleranceHz(toleranceHz: number): number {
  if (typeof toleranceHz !== 'number' || !Number.isFinite(toleranceHz)) {
    throw new RangeError('허용 오차는 유한한 숫자여야 합니다.');
  }
  if (toleranceHz < MIN_TOLERANCE_HZ || toleranceHz > MAX_TOLERANCE_HZ) {
    throw new RangeError(
      `허용 오차는 ${MIN_TOLERANCE_HZ}~${MAX_TOLERANCE_HZ} Hz 범위여야 합니다.`,
    );
  }
  return roundToOneDecimal(toleranceHz);
}

export function validateGateThresholdDb(gateThresholdDb: number): number {
  if (typeof gateThresholdDb !== 'number' || !Number.isFinite(gateThresholdDb)) {
    throw new RangeError('노이즈 게이트 임계치는 유한한 숫자여야 합니다.');
  }
  if (gateThresholdDb < MIN_GATE_THRESHOLD_DB || gateThresholdDb > MAX_GATE_THRESHOLD_DB) {
    throw new RangeError(
      `노이즈 게이트 임계치는 ${MIN_GATE_THRESHOLD_DB}~${MAX_GATE_THRESHOLD_DB} dB 범위여야 합니다.`,
    );
  }
  return Math.round(gateThresholdDb);
}

export function validateTargetFilterSpanPct(spanPct: number): number {
  if (typeof spanPct !== 'number' || !Number.isFinite(spanPct)) {
    throw new RangeError('목표 대역 폭은 유한한 숫자여야 합니다.');
  }
  if (spanPct < MIN_TARGET_FILTER_SPAN_PCT || spanPct > MAX_TARGET_FILTER_SPAN_PCT) {
    throw new RangeError(
      `목표 대역 폭은 ${MIN_TARGET_FILTER_SPAN_PCT}~${MAX_TARGET_FILTER_SPAN_PCT}% 범위여야 합니다.`,
    );
  }
  return Math.round(spanPct);
}

export function createDefaultSettings(): TunerSettings {
  return {
    toleranceHz: DEFAULT_TOLERANCE_HZ,
    gateThresholdDb: DEFAULT_GATE_THRESHOLD_DB,
    targetFilterEnabled: DEFAULT_TARGET_FILTER_ENABLED,
    targetFilterSpanPct: DEFAULT_TARGET_FILTER_SPAN_PCT,
  };
}

export function createDefaultState(now: number = Date.now()): PersistedState {
  const presets: DrumPreset[] = [
    { id: 'preset-kick', name: '킥', targetHz: 60, updatedAt: now },
    { id: 'preset-floor-tom', name: '플로어탐', targetHz: 90, updatedAt: now },
    { id: 'preset-rack-tom', name: '랙탐', targetHz: 135, updatedAt: now },
    { id: 'preset-snare', name: '스네어', targetHz: 200, updatedAt: now },
  ];

  const kits: DrumKit[] = [
    {
      id: 'kit-default-4pc',
      name: '기본 4기통 드럼셋',
      presetIds: presets.map((p) => p.id),
      updatedAt: now,
    },
  ];

  return {
    version: STORAGE_VERSION,
    presets,
    kits,
    settings: createDefaultSettings(),
    lastSelection: {
      mode: 'kit',
      activePresetId: presets[0].id,
      activeKitId: kits[0].id,
      activeKitIndex: 0,
      manualTargetHz: presets[0].targetHz,
    },
  };
}

function sanitizeLastSelection(
  selection: Partial<LastSelection> | null | undefined,
  presets: DrumPreset[],
  kits: DrumKit[],
): LastSelection {
  const presetMap = new Map(presets.map((p) => [p.id, p]));
  const kitMap = new Map(kits.map((k) => [k.id, k]));

  const activePresetId =
    selection?.activePresetId === null
      ? null
      : typeof selection?.activePresetId === 'string' && presetMap.has(selection.activePresetId)
        ? selection.activePresetId
        : presets[0]?.id ?? null;

  const activeKitId =
    typeof selection?.activeKitId === 'string' && kitMap.has(selection.activeKitId)
      ? selection.activeKitId
      : kits[0]?.id ?? null;

  const activeKit = activeKitId ? kitMap.get(activeKitId) ?? null : null;
  const maxIndex = activeKit && activeKit.presetIds.length > 0 ? activeKit.presetIds.length - 1 : 0;

  const rawIndex =
    typeof selection?.activeKitIndex === 'number' && Number.isFinite(selection.activeKitIndex)
      ? Math.floor(selection.activeKitIndex)
      : 0;
  const activeKitIndex = Math.max(0, Math.min(maxIndex, rawIndex));

  const requestedMode = selection?.mode === 'kit' ? 'kit' : 'single';
  const mode: 'single' | 'kit' =
    requestedMode === 'kit' && activeKit !== null && activeKit.presetIds.length > 0
      ? 'kit'
      : 'single';

  let manualTargetHz = presets[0]?.targetHz ?? 100;
  if (
    typeof selection?.manualTargetHz === 'number' &&
    Number.isFinite(selection.manualTargetHz)
  ) {
    manualTargetHz = roundToOneDecimal(
      Math.max(MIN_TARGET_HZ, Math.min(MAX_TARGET_HZ, selection.manualTargetHz)),
    );
  }

  return {
    mode,
    activePresetId,
    activeKitId,
    activeKitIndex,
    manualTargetHz,
  };
}

function filterValidPresetIds(presetIds: string[], presets: DrumPreset[]): string[] {
  const validSet = new Set(presets.map((p) => p.id));
  return presetIds.filter((id) => typeof id === 'string' && validSet.has(id));
}

export function addPreset(state: PersistedState, input: PresetInput): PersistedState {
  const name = validateName(input.name);
  const targetHz = validateTargetHz(input.targetHz);
  const now = input.now ?? Date.now();
  const id = input.id?.trim() || generateId('preset');

  if (state.presets.some((p) => p.id === id)) {
    throw new Error(`이미 존재하는 프리셋 ID입니다: ${id}`);
  }

  const nextPreset: DrumPreset = {
    id,
    name,
    targetHz,
    updatedAt: now,
  };

  return {
    ...state,
    presets: [...state.presets, nextPreset],
  };
}

export function updatePreset(
  state: PersistedState,
  id: string,
  patch: PresetPatch,
): PersistedState {
  const index = state.presets.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new Error(`프리셋을 찾을 수 없습니다: ${id}`);
  }

  const current = state.presets[index];
  const nextName = patch.name !== undefined ? validateName(patch.name) : current.name;
  const nextTargetHz =
    patch.targetHz !== undefined ? validateTargetHz(patch.targetHz) : current.targetHz;
  const now = patch.now ?? Date.now();

  const nextPresets = state.presets.slice();
  nextPresets[index] = {
    ...current,
    name: nextName,
    targetHz: nextTargetHz,
    updatedAt: now,
  };

  return {
    ...state,
    presets: nextPresets,
  };
}

export function deletePreset(
  state: PersistedState,
  id: string,
  now: number = Date.now(),
): PersistedState {
  const nextPresets = state.presets.filter((p) => p.id !== id);
  if (nextPresets.length === state.presets.length) {
    return state;
  }

  const nextKits = state.kits.map((kit) => {
    if (!kit.presetIds.includes(id)) {
      return kit;
    }
    return {
      ...kit,
      presetIds: kit.presetIds.filter((presetId) => presetId !== id),
      updatedAt: now,
    };
  });

  const nextSelection = sanitizeLastSelection(state.lastSelection, nextPresets, nextKits);

  return {
    ...state,
    presets: nextPresets,
    kits: nextKits,
    lastSelection: nextSelection,
  };
}

export function addKit(state: PersistedState, input: KitInput): PersistedState {
  const name = validateName(input.name);
  const presetIds = filterValidPresetIds(input.presetIds, state.presets);
  const now = input.now ?? Date.now();
  const id = input.id?.trim() || generateId('kit');

  if (state.kits.some((k) => k.id === id)) {
    throw new Error(`이미 존재하는 드럼셋 ID입니다: ${id}`);
  }

  const nextKit: DrumKit = {
    id,
    name,
    presetIds,
    updatedAt: now,
  };

  return {
    ...state,
    kits: [...state.kits, nextKit],
  };
}

export function updateKit(state: PersistedState, id: string, patch: KitPatch): PersistedState {
  const index = state.kits.findIndex((k) => k.id === id);
  if (index === -1) {
    throw new Error(`드럼셋을 찾을 수 없습니다: ${id}`);
  }

  const current = state.kits[index];
  const nextName = patch.name !== undefined ? validateName(patch.name) : current.name;
  const nextPresetIds =
    patch.presetIds !== undefined
      ? filterValidPresetIds(patch.presetIds, state.presets)
      : current.presetIds;
  const now = patch.now ?? Date.now();

  const nextKits = state.kits.slice();
  nextKits[index] = {
    ...current,
    name: nextName,
    presetIds: nextPresetIds,
    updatedAt: now,
  };

  const nextSelection = sanitizeLastSelection(state.lastSelection, state.presets, nextKits);

  return {
    ...state,
    kits: nextKits,
    lastSelection: nextSelection,
  };
}

export function deleteKit(state: PersistedState, id: string): PersistedState {
  const nextKits = state.kits.filter((k) => k.id !== id);
  if (nextKits.length === state.kits.length) {
    return state;
  }

  const nextSelection = sanitizeLastSelection(state.lastSelection, state.presets, nextKits);

  return {
    ...state,
    kits: nextKits,
    lastSelection: nextSelection,
  };
}

export function updateSettings(
  state: PersistedState,
  patch: Partial<TunerSettings>,
): PersistedState {
  const nextSettings: TunerSettings = {
    toleranceHz:
      patch.toleranceHz !== undefined
        ? validateToleranceHz(patch.toleranceHz)
        : state.settings.toleranceHz,
    gateThresholdDb:
      patch.gateThresholdDb !== undefined
        ? validateGateThresholdDb(patch.gateThresholdDb)
        : state.settings.gateThresholdDb,
    targetFilterEnabled:
      patch.targetFilterEnabled !== undefined
        ? Boolean(patch.targetFilterEnabled)
        : state.settings.targetFilterEnabled,
    targetFilterSpanPct:
      patch.targetFilterSpanPct !== undefined
        ? validateTargetFilterSpanPct(patch.targetFilterSpanPct)
        : state.settings.targetFilterSpanPct,
  };

  return {
    ...state,
    settings: nextSettings,
  };
}

export function updateLastSelection(
  state: PersistedState,
  patch: Partial<LastSelection>,
): PersistedState {
  return {
    ...state,
    lastSelection: sanitizeLastSelection(
      { ...state.lastSelection, ...patch },
      state.presets,
      state.kits,
    ),
  };
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePersistedState(raw: unknown): PersistedState | null {
  if (!isRecord(raw) || raw.version !== STORAGE_VERSION) {
    return null;
  }

  if (!Array.isArray(raw.presets) || !Array.isArray(raw.kits)) {
    return null;
  }

  const presets: DrumPreset[] = [];
  const seenPresetIds = new Set<string>();
  for (const item of raw.presets) {
    if (!isRecord(item)) {
      continue;
    }
    if (typeof item.id !== 'string' || item.id.trim().length === 0) {
      continue;
    }
    if (seenPresetIds.has(item.id)) {
      continue;
    }
    try {
      const name = validateName(item.name as string);
      const targetHz = validateTargetHz(item.targetHz as number);
      const updatedAt =
        typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)
          ? item.updatedAt
          : Date.now();
      presets.push({ id: item.id, name, targetHz, updatedAt });
      seenPresetIds.add(item.id);
    } catch {
      continue;
    }
  }

  const kits: DrumKit[] = [];
  const seenKitIds = new Set<string>();
  for (const item of raw.kits) {
    if (!isRecord(item)) {
      continue;
    }
    if (typeof item.id !== 'string' || item.id.trim().length === 0) {
      continue;
    }
    if (seenKitIds.has(item.id)) {
      continue;
    }
    if (!Array.isArray(item.presetIds)) {
      continue;
    }
    try {
      const name = validateName(item.name as string);
      const presetIds = filterValidPresetIds(item.presetIds as string[], presets);
      const updatedAt =
        typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)
          ? item.updatedAt
          : Date.now();
      kits.push({ id: item.id, name, presetIds, updatedAt });
      seenKitIds.add(item.id);
    } catch {
      continue;
    }
  }

  const defaults = createDefaultSettings();
  const rawSettings = isRecord(raw.settings) ? raw.settings : {};

  let toleranceHz = defaults.toleranceHz;
  try {
    if (rawSettings.toleranceHz !== undefined) {
      toleranceHz = validateToleranceHz(rawSettings.toleranceHz as number);
    }
  } catch {
    toleranceHz = defaults.toleranceHz;
  }

  let gateThresholdDb = defaults.gateThresholdDb;
  try {
    if (rawSettings.gateThresholdDb !== undefined) {
      gateThresholdDb = validateGateThresholdDb(rawSettings.gateThresholdDb as number);
    }
  } catch {
    gateThresholdDb = defaults.gateThresholdDb;
  }

  const targetFilterEnabled =
    typeof rawSettings.targetFilterEnabled === 'boolean'
      ? rawSettings.targetFilterEnabled
      : defaults.targetFilterEnabled;

  let targetFilterSpanPct = defaults.targetFilterSpanPct;
  try {
    if (rawSettings.targetFilterSpanPct !== undefined) {
      targetFilterSpanPct = validateTargetFilterSpanPct(rawSettings.targetFilterSpanPct as number);
    }
  } catch {
    targetFilterSpanPct = defaults.targetFilterSpanPct;
  }

  const rawSelection = isRecord(raw.lastSelection)
    ? (raw.lastSelection as Partial<LastSelection>)
    : undefined;

  return {
    version: STORAGE_VERSION,
    presets,
    kits,
    settings: {
      toleranceHz,
      gateThresholdDb,
      targetFilterEnabled,
      targetFilterSpanPct,
    },
    lastSelection: sanitizeLastSelection(rawSelection, presets, kits),
  };
}

export function loadState(storage?: StorageLike | null): PersistedState {
  const resolved = resolveStorage(storage);
  if (!resolved) {
    return createDefaultState();
  }

  try {
    const rawJson = resolved.getItem(STORAGE_KEY);
    if (rawJson === null) {
      return createDefaultState();
    }
    const parsed: unknown = JSON.parse(rawJson);
    return parsePersistedState(parsed) ?? createDefaultState();
  } catch {
    return createDefaultState();
  }
}

export function saveState(state: PersistedState, storage?: StorageLike | null): boolean {
  const resolved = resolveStorage(storage);
  if (!resolved) {
    return false;
  }

  try {
    resolved.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
