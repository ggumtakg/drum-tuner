import { useState, type FormEvent } from 'react';
import { frequencyToNote } from '../dsp/index.ts';
import {
  MAX_NAME_LENGTH,
  MAX_TARGET_HZ,
  MIN_TARGET_HZ,
  type DrumKit,
  type DrumPreset,
} from '../storage/tunerStore.ts';

export interface PresetsTabProps {
  presets: DrumPreset[];
  kits: DrumKit[];
  activePresetId: string | null;
  onAddPreset: (name: string, targetHz: number) => string | null;
  onUpdatePreset: (id: string, name: string, targetHz: number) => string | null;
  onDeletePreset: (id: string) => void;
  onSelectPreset: (preset: DrumPreset) => void;
}

function getPreviewNoteLabel(hzText: string): string | null {
  const parsed = Number(hzText);
  if (!Number.isFinite(parsed) || parsed < MIN_TARGET_HZ || parsed > MAX_TARGET_HZ) {
    return null;
  }
  return frequencyToNote(parsed).label;
}

export function PresetsTab({
  presets,
  kits,
  activePresetId,
  onAddPreset,
  onUpdatePreset,
  onDeletePreset,
  onSelectPreset,
}: PresetsTabProps) {
  const [newName, setNewName] = useState('');
  const [newHzText, setNewHzText] = useState('120');
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editHzText, setEditHzText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const createNotePreview = getPreviewNoteLabel(newHzText);

  const handleCreateSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsedHz = Number(newHzText);
    if (newHzText.trim() === '' || !Number.isFinite(parsedHz)) {
      setCreateError(`목표 주파수는 ${MIN_TARGET_HZ}~${MAX_TARGET_HZ} Hz 범위의 숫자여야 합니다.`);
      return;
    }
    const err = onAddPreset(newName, parsedHz);
    if (err) {
      setCreateError(err);
      return;
    }
    setCreateError(null);
    setNewName('');
  };

  const handleStartEdit = (preset: DrumPreset) => {
    setConfirmDeleteId(null);
    setEditingId(preset.id);
    setEditName(preset.name);
    setEditHzText(String(preset.targetHz));
    setEditError(null);
  };

  const handleEditSubmit = (event: FormEvent, id: string) => {
    event.preventDefault();
    const parsedHz = Number(editHzText);
    if (editHzText.trim() === '' || !Number.isFinite(parsedHz)) {
      setEditError(`목표 주파수는 ${MIN_TARGET_HZ}~${MAX_TARGET_HZ} Hz 범위의 숫자여야 합니다.`);
      return;
    }
    const err = onUpdatePreset(id, editName, parsedHz);
    if (err) {
      setEditError(err);
      return;
    }
    setEditError(null);
    setEditingId(null);
  };

  const getReferencingKitNames = (presetId: string): string[] =>
    kits.filter((kit) => kit.presetIds.includes(presetId)).map((kit) => kit.name);

  return (
    <div className="tab-stack">
      <header className="page-header">
        <h1>프리셋</h1>
        <p className="page-subtitle">드럼별 목표 주파수를 저장하고 탭 한 번으로 불러오세요.</p>
      </header>

      <section className="card" aria-label="새 프리셋 추가">
        <h2 className="section-title">새 프리셋 저장</h2>
        <form className="preset-form" onSubmit={handleCreateSubmit}>
          <div className="form-row">
            <label className="form-field">
              <span>드럼 이름</span>
              <input
                type="text"
                maxLength={MAX_NAME_LENGTH}
                placeholder="예: 스네어, 하이탐"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label className="form-field form-field-hz">
              <span>
                목표 주파수 (Hz)
                {createNotePreview ? ` · ${createNotePreview}` : ''}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={MIN_TARGET_HZ}
                max={MAX_TARGET_HZ}
                step="0.1"
                value={newHzText}
                onChange={(e) => setNewHzText(e.target.value)}
              />
            </label>
          </div>
          {createError && (
            <p className="field-error" role="alert">
              {createError}
            </p>
          )}
          <button type="submit" className="btn btn-primary">
            프리셋 저장
          </button>
        </form>
      </section>

      <section className="list-section" aria-label="저장된 프리셋 목록">
        <div className="list-section-header">
          <h2 className="section-title">저장된 프리셋 ({presets.length})</h2>
          <span className="list-hint">항목을 탭하면 튜너로 이동합니다</span>
        </div>

        {presets.length === 0 ? (
          <div className="card empty-state">
            <p>저장된 프리셋이 없습니다. 위에서 첫 드럼 프리셋을 추가해 보세요.</p>
          </div>
        ) : (
          <ul className="item-list">
            {presets.map((preset) => {
              const note = frequencyToNote(preset.targetHz);
              const isEditing = editingId === preset.id;
              const isConfirmingDelete = confirmDeleteId === preset.id;
              const isActive = activePresetId === preset.id;
              const referencingKits = isConfirmingDelete ? getReferencingKitNames(preset.id) : [];

              return (
                <li
                  key={preset.id}
                  className={`card item-card ${isActive ? 'is-active-item' : ''}`}
                >
                  {isEditing ? (
                    <form
                      className="inline-edit-form"
                      onSubmit={(e) => handleEditSubmit(e, preset.id)}
                    >
                      <div className="form-row">
                        <label className="form-field">
                          <span>드럼 이름</span>
                          <input
                            type="text"
                            maxLength={MAX_NAME_LENGTH}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                          />
                        </label>
                        <label className="form-field form-field-hz">
                          <span>주파수 (Hz)</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={MIN_TARGET_HZ}
                            max={MAX_TARGET_HZ}
                            step="0.1"
                            value={editHzText}
                            onChange={(e) => setEditHzText(e.target.value)}
                          />
                        </label>
                      </div>
                      {editError && (
                        <p className="field-error" role="alert">
                          {editError}
                        </p>
                      )}
                      <div className="inline-actions">
                        <button type="submit" className="btn btn-primary btn-compact">
                          저장
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          onClick={() => {
                            setEditingId(null);
                            setEditError(null);
                          }}
                        >
                          취소
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="preset-row">
                        <button
                          type="button"
                          className="preset-load-btn"
                          onClick={() => onSelectPreset(preset)}
                        >
                          <div className="preset-main-info">
                            <span className="preset-name">{preset.name}</span>
                            {isActive && <span className="badge badge-active">사용 중</span>}
                          </div>
                          <div className="preset-freq-info tabular">
                            <strong>{preset.targetHz.toFixed(1)} Hz</strong>
                            <span className="badge badge-note">{note.label}</span>
                          </div>
                        </button>

                        <div className="item-card-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-compact"
                            onClick={() => handleStartEdit(preset)}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger-ghost btn-compact"
                            onClick={() => {
                              setEditingId(null);
                              setConfirmDeleteId(
                                isConfirmingDelete ? null : preset.id,
                              );
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      </div>

                      {isConfirmingDelete && (
                        <div className="delete-confirm-box" role="alert">
                          <p>
                            <strong>"{preset.name}"</strong> 프리셋을 삭제할까요?
                          </p>
                          {referencingKits.length > 0 && (
                            <p className="delete-ref-warning">
                              사용 중인 드럼셋: <strong>{referencingKits.join(', ')}</strong>
                              <br />
                              삭제하면 해당 드럼셋 목록에서도 자동으로 제외됩니다.
                            </p>
                          )}
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="btn btn-danger btn-compact"
                              onClick={() => {
                                onDeletePreset(preset.id);
                                setConfirmDeleteId(null);
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
                    </>
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
