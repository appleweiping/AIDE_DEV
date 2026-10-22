import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from './stores/agent';
import { useSettingsStore } from './stores/settings';
import { useAgent } from './hooks/useAgent';
import Chat from './components/Chat';
import SessionList from './components/SessionList';
import Settings from './components/Settings';
import ApprovalDialog from './components/ApprovalDialog';

export default function App() {
  const { t } = useTranslation();
  const pendingApproval = useAgentStore((s) => s.pendingApproval);
  const provider = useSettingsStore((s) => s.provider);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const permissionMode = useSettingsStore((s) => s.permissionMode);
  // Open the settings on first start so the user picks a folder and a key.
  const [showSettings, setShowSettings] = useState(() => !provider.apiKey || !workingDirectory);

  useAgent();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#1e1e1e] text-[#cccccc]">
      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-56 flex-shrink-0 flex-col border-r border-[#3e3e42] bg-[#252526]">
          <div className="border-b border-[#3e3e42] px-3 py-2 text-sm font-semibold tracking-wide">{t('app.title')}</div>
          <SessionList />
          <button
            onClick={() => setShowSettings(true)}
            className="border-t border-[#3e3e42] px-3 py-2 text-left text-xs text-[#9d9d9d] hover:bg-[#2a2d2e] hover:text-[#cccccc]"
            title="Ctrl+,"
          >
            ⚙ {t('sidebar.settings')}
          </button>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden">
          <Chat />
        </main>
      </div>

      <div className="flex h-6 flex-shrink-0 items-center justify-between gap-4 border-t border-[#3e3e42] bg-[#007acc] px-3 text-[11px] text-white/90">
        <span className="truncate" title={workingDirectory}>
          {workingDirectory || t('status.noFolder')}
        </span>
        <span className="flex-shrink-0">
          {provider.id} · {provider.model} · {permissionMode}
        </span>
      </div>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {pendingApproval && <ApprovalDialog />}
    </div>
  );
}
