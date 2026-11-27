import type { DrumKit, DrumPreset } from '../storage/tunerStore.ts';

export interface KitStepBarProps {
  kit: DrumKit;
  kitPresets: DrumPreset[];
  activeIndex: number;
  tunedPresetIds: ReadonlySet<string>;
  onSelectIndex: (index: number) => void;
  onExitKitMode: () => void;
}

export function KitStepBar({
  kit,
  kitPresets,
  activeIndex,
  tunedPresetIds,
  onSelectIndex,
  onExitKitMode,
}: KitStepBarProps) {
  const total = kitPresets.length;
  const canPrev = activeIndex > 0;
  const canNext = activeIndex < total - 1;
  const tunedCount = kitPresets.reduce(
    (count, preset, index) =>
      tunedPresetIds.has(`${kit.id}:${index}:${preset.id}`) ? count + 1 : count,
    0,
  );

  return (
    <section className="card kit-step-bar" aria-label="드럼셋 순차 조율">
      <div className="kit-step-header">
        <div className="kit-step-title-group">
          <span className="badge badge-kit">드럼셋</span>
          <strong className="kit-step-name">{kit.name}</strong>
          <span className="kit-step-progress">
            {activeIndex + 1}/{total} · 완료 {tunedCount}/{total}
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-compact" onClick={onExitKitMode}>
          단일 모드
        </button>
      </div>

      <div className="kit-chips" role="tablist" aria-label="드럼셋 구성 드럼">
        {kitPresets.map((preset, index) => {
          const isActive = index === activeIndex;
          const isTuned = tunedPresetIds.has(`${kit.id}:${index}:${preset.id}`);
          return (
            <button
              key={`${preset.id}-${index}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`kit-chip ${isActive ? 'is-active' : ''} ${isTuned ? 'is-tuned' : ''}`}
              onClick={() => onSelectIndex(index)}
            >
              <span className="kit-chip-index">
                {isTuned ? '✓' : index + 1}
              </span>
              <span className="kit-chip-name">{preset.name}</span>
              <span className="kit-chip-hz">{preset.targetHz.toFixed(preset.targetHz % 1 === 0 ? 0 : 1)}Hz</span>
            </button>
          );
        })}
      </div>

      <div className="kit-step-nav">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!canPrev}
          onClick={() => onSelectIndex(activeIndex - 1)}
        >
          ← 이전 드럼
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!canNext}
          onClick={() => onSelectIndex(activeIndex + 1)}
        >
          다음 드럼 →
        </button>
      </div>
    </section>
  );
}
