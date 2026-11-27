import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  addKit,
  addPreset,
  deleteKit,
  deletePreset,
  loadState,
  saveState,
  updateKit,
  updateLastSelection,
  updatePreset,
  updateSettings,
  type StorageLike,
} from '../tunerStore.ts';

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

describe('tunerStore', () => {
  it('seeds default 4-piece drum kit and default settings on first load', () => {
    const storage = createMemoryStorage();
    const state = loadState(storage);

    expect(state.version).toBe(1);
    expect(state.presets.map((p) => [p.name, p.targetHz])).toEqual([
      ['킥', 60],
      ['플로어탐', 90],
      ['랙탐', 135],
      ['스네어', 200],
    ]);
    expect(state.kits).toHaveLength(1);
    expect(state.kits[0].name).toBe('기본 4기통 드럼셋');
    expect(state.kits[0].presetIds).toEqual(state.presets.map((p) => p.id));
    expect(state.settings).toEqual({
      toleranceHz: 1.0,
      gateThresholdDb: -36,
      targetFilterEnabled: true,
      targetFilterSpanPct: 40,
    });
  });

  it('supports preset and kit CRUD, filters invalid presetIds, and atomically cleans kit refs on preset deletion', () => {
    const storage = createMemoryStorage();
    let state = loadState(storage);

    // Add preset with decimal rounding and whitespace trimming
    state = addPreset(state, {
      id: 'preset-tom2',
      name: '  하이탐  ',
      targetHz: 162.34,
      now: 2000,
    });
    const added = state.presets.find((p) => p.id === 'preset-tom2');
    expect(added).toEqual({
      id: 'preset-tom2',
      name: '하이탐',
      targetHz: 162.3,
      updatedAt: 2000,
    });

    // Update preset
    state = updatePreset(state, 'preset-tom2', {
      name: '스몰탐',
      targetHz: 165.76,
      now: 2100,
    });
    expect(state.presets.find((p) => p.id === 'preset-tom2')).toEqual({
      id: 'preset-tom2',
      name: '스몰탐',
      targetHz: 165.8,
      updatedAt: 2100,
    });

    // Add kit with a nonexistent presetId that must be stripped
    state = addKit(state, {
      id: 'kit-live',
      name: '라이브 세트',
      presetIds: ['preset-kick', 'does-not-exist', 'preset-tom2'],
      now: 2200,
    });
    expect(state.kits.find((k) => k.id === 'kit-live')?.presetIds).toEqual([
      'preset-kick',
      'preset-tom2',
    ]);

    // Select the last item in kit-live so we verify activeKitIndex clamping when deleted
    state = updateLastSelection(state, {
      mode: 'kit',
      activeKitId: 'kit-live',
      activeKitIndex: 1,
      activePresetId: 'preset-tom2',
    });
    expect(state.lastSelection.activeKitIndex).toBe(1);

    // Delete preset-tom2 -> removed from kit-live & lastSelection safely adjusted
    state = deletePreset(state, 'preset-tom2', 2300);
    expect(state.presets.some((p) => p.id === 'preset-tom2')).toBe(false);
    expect(state.kits.find((k) => k.id === 'kit-live')?.presetIds).toEqual(['preset-kick']);
    expect(state.lastSelection.activeKitIndex).toBe(0);
    expect(state.lastSelection.activePresetId).not.toBe('preset-tom2');

    // Update kit to empty -> mode safely falls back to 'single'
    state = updateKit(state, 'kit-live', { presetIds: [] });
    expect(state.lastSelection.mode).toBe('single');

    // Delete kit
    state = deleteKit(state, 'kit-live');
    expect(state.kits.some((k) => k.id === 'kit-live')).toBe(false);
  });

  it('rejects out-of-range frequencies, invalid names, and invalid settings', () => {
    const state = loadState(createMemoryStorage());

    expect(() => addPreset(state, { name: '초저음', targetHz: 29.9 })).toThrow();
    expect(() => addPreset(state, { name: '초고음', targetHz: 600.1 })).toThrow();
    expect(() => addPreset(state, { name: 'NaN', targetHz: Number.NaN })).toThrow();
    expect(() => addPreset(state, { name: '   ', targetHz: 100 })).toThrow();
    expect(() => addPreset(state, { name: 'a'.repeat(41), targetHz: 100 })).toThrow();

    expect(() => addKit(state, { name: '   ', presetIds: [] })).toThrow();

    expect(() => updateSettings(state, { toleranceHz: 0.1 })).toThrow();
    expect(() => updateSettings(state, { toleranceHz: 5.1 })).toThrow();
    expect(() => updateSettings(state, { gateThresholdDb: -61 })).toThrow();
    expect(() => updateSettings(state, { gateThresholdDb: -5 })).toThrow();
    expect(() => updateSettings(state, { targetFilterSpanPct: 10 })).toThrow();
  });

  it('safely recovers from corrupted JSON or incompatible schema', () => {
    const brokenJsonStorage = createMemoryStorage();
    brokenJsonStorage.setItem(STORAGE_KEY, '{not valid json');
    const recovered1 = loadState(brokenJsonStorage);
    expect(recovered1.presets).toHaveLength(4);
    expect(recovered1.kits[0].name).toBe('기본 4기통 드럼셋');

    const wrongVersionStorage = createMemoryStorage();
    wrongVersionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 99, presets: [], kits: [] }),
    );
    const recovered2 = loadState(wrongVersionStorage);
    expect(recovered2.version).toBe(1);
    expect(recovered2.presets).toHaveLength(4);

    // Partially corrupted items inside valid version 1 payload should be sanitized
    const partialCorruptStorage = createMemoryStorage();
    partialCorruptStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        presets: [
          { id: 'p1', name: '스네어', targetHz: 210, updatedAt: 100 },
          { id: 'p-bad', name: '', targetHz: 9999, updatedAt: 100 },
        ],
        kits: [
          { id: 'k1', name: '내 세트', presetIds: ['p1', 'p-bad'], updatedAt: 100 },
        ],
        settings: {
          toleranceHz: 99,
          gateThresholdDb: -30,
          targetFilterEnabled: false,
          targetFilterSpanPct: 50,
        },
        lastSelection: {
          mode: 'kit',
          activeKitId: 'k1',
          activeKitIndex: 99,
          activePresetId: 'p-bad',
          manualTargetHz: 210,
        },
      }),
    );
    const recovered3 = loadState(partialCorruptStorage);
    expect(recovered3.presets).toHaveLength(1);
    expect(recovered3.kits[0].presetIds).toEqual(['p1']);
    expect(recovered3.settings).toEqual({
      toleranceHz: 1.0,
      gateThresholdDb: -30,
      targetFilterEnabled: false,
      targetFilterSpanPct: 50,
    });
    expect(recovered3.lastSelection.activeKitIndex).toBe(0);
    expect(recovered3.lastSelection.activePresetId).toBe('p1');
  });

  it('persists and restores state cleanly through storage round-trip', () => {
    const storage = createMemoryStorage();
    let state = loadState(storage);
    state = addPreset(state, { id: 'p-piccolo', name: '피콜로 스네어', targetHz: 265.5, now: 5000 });
    state = updateSettings(state, {
      toleranceHz: 0.5,
      gateThresholdDb: -28,
      targetFilterEnabled: false,
      targetFilterSpanPct: 30,
    });
    state = updateLastSelection(state, {
      mode: 'single',
      activePresetId: 'p-piccolo',
      manualTargetHz: 265.5,
    });

    expect(saveState(state, storage)).toBe(true);
    expect(storage.store.has(STORAGE_KEY)).toBe(true);

    const restored = loadState(storage);
    expect(restored).toEqual(state);
  });

  it('preserves explicit activePresetId: null for manual frequency input mode across storage round-trip', () => {
    const storage = createMemoryStorage();
    let state = loadState(storage);

    state = updateLastSelection(state, {
      mode: 'single',
      activePresetId: null,
      manualTargetHz: 175,
    });

    expect(state.lastSelection.mode).toBe('single');
    expect(state.lastSelection.activePresetId).toBeNull();
    expect(state.lastSelection.manualTargetHz).toBe(175);

    expect(saveState(state, storage)).toBe(true);
    const restored = loadState(storage);
    expect(restored.lastSelection.mode).toBe('single');
    expect(restored.lastSelection.activePresetId).toBeNull();
    expect(restored.lastSelection.manualTargetHz).toBe(175);
  });
});
