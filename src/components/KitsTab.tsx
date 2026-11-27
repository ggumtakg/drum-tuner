import { useMemo, useState, type FormEvent } from 'react';
import {
  MAX_NAME_LENGTH,
  type DrumKit,
  type DrumPreset,
} from '../storage/tunerStore.ts';

export interface KitsTabProps {
  kits: DrumKit[];
  presets: DrumPreset[];
  activeKitId: string | null;
  isKitMode: boolean;
  onAddKit: (name: string, presetIds: string[]) => string | null;
  onUpdateKit: (id: string, name: string, presetIds: string[]) => string | null;
  onDeleteKit: (id: string) => void;
  onStartKitTuning: (kit: DrumKit) => void;
}

function formatPresetHz(hz: number): string {
  return Number.isInteger(hz) ? hz.toFixed(0) : hz.toFixed(1);
}

export function KitsTab({
  kits,
  presets,
  activeKitId,
  isKitMode,
  onAddKit,
  onUpdateKit,
  onDeleteKit,
  onStartKitTuning,
}: KitsTabProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingKitId, setEditingKitId] = useState<string | null>(null);
  const [kitName, setKitName] = useState('');
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const presetMap = useMemo(
    () => new Map(presets.map((preset) => [preset.id, preset])),
    [presets],
  );

  const openCreateForm = () => {
    setEditingKitId(null);
    setKitName('');
    setSelectedPresetIds([]);
    setFormError(null);
    setFormOpen(true);
    setConfirmDeleteId(null);
  };

  const openEditForm = (kit: DrumKit) => {
    setEditingKitId(kit.id);
    setKitName(kit.name);
    setSelectedPresetIds(kit.presetIds.filter((id) => presetMap.has(id)));
    setFormError(null);
    setFormOpen(true);
    setConfirmDeleteId(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingKitId(null);
    setFormError(null);
  };

  const handleAddPresetToSelection = (presetId: string) => {
    setSelectedPresetIds((prev) => [...prev, presetId]);
    setFormError(null);
  };

  const handleRemoveIndex = (index: number) => {
    setSelectedPresetIds((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleMoveIndex = (index: number, direction: -1 | 1) => {
    setSelectedPresetIds((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) {
        return prev;
      }
      const next = prev.slice();
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (selectedPresetIds.length === 0) {
      setFormError('드럼셋에 포함할 프리셋을 최소 1개 이상 선택해 주세요.');
      return;
    }

    const err = editingKitId
      ? onUpdateKit(editingKitId, kitName, selectedPresetIds)
      : onAddKit(kitName, selectedPresetIds);

    if (err) {
      setFormError(err);
      return;
    }

    closeForm();
  };

  return (
    <div className="tab-stack">
      <header className="page-header page-header-row">
        <div>
          <h1>드럼셋</h1>
          <p className="page-subtitle">여러 드럼을 묶어 순서대로 빠르게 조율하세요.</p>
        </div>
        {!formOpen && (
          <button
            type="button"
            className="btn btn-primary btn-compact"
            onClick={openCreateForm}
          >
            + 새 드럼셋
          </button>
        )}
      </header>

      {formOpen && (
        <section className="card kit-editor" aria-label={editingKitId ? '드럼셋 수정' : '새 드럼셋 만들기'}>
          <div className="kit-editor-header">
            <h2 className="section-title">
              {editingKitId ? '드럼셋 수정' : '새 드럼셋 만들기'}
            </h2>
            <button type="button" className="btn btn-ghost btn-compact" onClick={closeForm}>
              닫기
            </button>
          </div>

          <form className="kit-form" onSubmit={handleFormSubmit}>
            <label className="form-field">
              <span>드럼셋 이름</span>
              <input
                type="text"
                maxLength={MAX_NAME_LENGTH}
                placeholder="예: 공연용 5기통 세트"
                value={kitName}
                onChange={(e) => setKitName(e.target.value)}
                autoFocus
              />
            </label>

            <div className="kit-form-block">
              <div className="setting-label">
                조율 순서 ({selectedPresetIds.length}개 선택됨)
              </div>
              {selectedPresetIds.length === 0 ? (
                <p className="kit-empty-selection">
                  아래 저장된 프리셋에서 드럼을 탭해 순서대로 추가하세요.
                </p>
              ) : (
                <ol className="selected-drums-list">
                  {selectedPresetIds.map((presetId, index) => {
                    const preset = presetMap.get(presetId);
                    if (!preset) {
                      return null;
                    }
                    return (
                      <li key={`${presetId}-${index}`} className="selected-drum-row">
                        <span className="selected-drum-order">{index + 1}</span>
                        <span className="selected-drum-label">
                          <strong>{preset.name}</strong>
                          <span className="tabular">{formatPresetHz(preset.targetHz)} Hz</span>
                        </span>
                        <div className="order-controls">
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            aria-label={`${preset.name} 위로 이동`}
                            disabled={index === 0}
                            onClick={() => handleMoveIndex(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            aria-label={`${preset.name} 아래로 이동`}
                            disabled={index === selectedPresetIds.length - 1}
                            onClick={() => handleMoveIndex(index, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger-ghost btn-icon"
                            aria-label={`${preset.name} 제거`}
                            onClick={() => handleRemoveIndex(index)}
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            <div className="kit-form-block">
              <div className="setting-label">프리셋 추가</div>
              {presets.length === 0 ? (
                <p className="kit-empty-selection">
                  저장된 프리셋이 없습니다. 먼저 프리셋 탭에서 드럼을 등록해 주세요.
                </p>
              ) : (
                <div className="preset-picker-grid">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="btn btn-chip preset-pick-btn"
                      onClick={() => handleAddPresetToSelection(preset.id)}
                    >
                      <span>+ {preset.name}</span>
                      <span className="tabular">{formatPresetHz(preset.targetHz)}Hz</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {formError && (
              <p className="field-error" role="alert">
                {formError}
              </p>
            )}

            <div className="inline-actions">
              <button type="submit" className="btn btn-primary">
                {editingKitId ? '드럼셋 수정 저장' : '드럼셋 저장'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={closeForm}>
                취소
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="list-section" aria-label="저장된 드럼셋 목록">
        <h2 className="section-title">저장된 드럼셋 ({kits.length})</h2>

        {kits.length === 0 ? (
          <div className="card empty-state">
            <p>저장된 드럼셋이 없습니다. "+ 새 드럼셋" 버튼으로 세트를 구성해 보세요.</p>
          </div>
        ) : (
          <ul className="item-list">
            {kits.map((kit) => {
              const resolvedPresets = kit.presetIds
                .map((id) => presetMap.get(id))
                .filter((p): p is DrumPreset => Boolean(p));
              const isActive = isKitMode && activeKitId === kit.id;
              const isConfirmingDelete = confirmDeleteId === kit.id;

              return (
                <li
                  key={kit.id}
                  className={`card kit-card ${isActive ? 'is-active-item' : ''}`}
                >
                  <div className="kit-card-top">
                    <div className="kit-card-title-row">
                      <strong className="kit-card-name">{kit.name}</strong>
                      <span className="badge badge-note">{resolvedPresets.length}개 드럼</span>
                      {isActive && <span className="badge badge-active">조율 중</span>}
                    </div>
                  </div>

                  {resolvedPresets.length === 0 ? (
                    <p className="kit-empty-selection">
                      포함된 프리셋이 없습니다. 수정 버튼을 눌러 드럼을 추가하세요.
                    </p>
                  ) : (
                    <div className="kit-summary-chips">
                      {resolvedPresets.map((preset, idx) => (
                        <span key={`${preset.id}-${idx}`} className="summary-chip">
                          {idx + 1}. {preset.name}{' '}
                          <strong className="tabular">{formatPresetHz(preset.targetHz)}Hz</strong>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="kit-card-footer">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={resolvedPresets.length === 0}
                      onClick={() => onStartKitTuning(kit)}
                    >
                      조율 시작
                    </button>
                    <div className="item-card-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact"
                        onClick={() => openEditForm(kit)}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-ghost btn-compact"
                        onClick={() =>
                          setConfirmDeleteId(isConfirmingDelete ? null : kit.id)
                        }
                      >
                        삭제
                      </button>
                    </div>
                  </div>

                  {isConfirmingDelete && (
                    <div className="delete-confirm-box" role="alert">
                      <p>
                        <strong>"{kit.name}"</strong> 드럼셋을 삭제할까요? (포함된 개별 프리셋은 유지됩니다.)
                      </p>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="btn btn-danger btn-compact"
                          onClick={() => {
                            onDeleteKit(kit.id);
                            setConfirmDeleteId(null);
                            if (editingKitId === kit.id) {
                              closeForm();
                            }
                          }}
                        >
                          삭제 확인
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
