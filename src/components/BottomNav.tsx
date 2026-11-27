export type AppTab = 'tuner' | 'presets' | 'kits';

export interface BottomNavProps {
  activeTab: AppTab;
  isMicRunning: boolean;
  presetCount: number;
  kitCount: number;
  onSelectTab: (tab: AppTab) => void;
}

export function BottomNav({
  activeTab,
  isMicRunning,
  presetCount,
  kitCount,
  onSelectTab,
}: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="주요 메뉴">
      <button
        type="button"
        className={`nav-tab ${activeTab === 'tuner' ? 'is-active' : ''}`}
        aria-current={activeTab === 'tuner' ? 'page' : undefined}
        onClick={() => onSelectTab('tuner')}
      >
        <span className="nav-icon-wrap" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 12l4-4" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          </svg>
          {isMicRunning && <span className="nav-live-dot" />}
        </span>
        <span className="nav-label">튜너</span>
      </button>

      <button
        type="button"
        className={`nav-tab ${activeTab === 'presets' ? 'is-active' : ''}`}
        aria-current={activeTab === 'presets' ? 'page' : undefined}
        onClick={() => onSelectTab('presets')}
      >
        <span className="nav-icon-wrap" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </span>
        <span className="nav-label">프리셋 ({presetCount})</span>
      </button>

      <button
        type="button"
        className={`nav-tab ${activeTab === 'kits' ? 'is-active' : ''}`}
        aria-current={activeTab === 'kits' ? 'page' : undefined}
        onClick={() => onSelectTab('kits')}
      >
        <span className="nav-icon-wrap" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="7" height="7" rx="1.5" />
            <rect x="14" y="4" width="7" height="7" rx="1.5" />
            <rect x="3" y="13" width="7" height="7" rx="1.5" />
            <rect x="14" y="13" width="7" height="7" rx="1.5" />
          </svg>
        </span>
        <span className="nav-label">드럼셋 ({kitCount})</span>
      </button>
    </nav>
  );
}
