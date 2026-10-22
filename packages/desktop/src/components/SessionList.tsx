import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent';
import { loadSession, deleteSession } from '../lib/api';

interface SessionItem {
  id: string;
  title: string;
  updatedAt: number;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function SessionList() {
  const { t } = useTranslation();
  const sessions = useAgentStore((s) => s.sessions);
  const currentSessionId = useAgentStore((s) => s.currentSessionId);
  const setCurrentSession = useAgentStore((s) => s.setCurrentSession);
  const setSessions = useAgentStore((s) => s.setSessions);
  const clearMessages = useAgentStore((s) => s.clearMessages);

  const setMessages = useAgentStore((s) => s.setMessages);
  const isStreaming = useAgentStore((s) => s.streaming.isStreaming);

  function handleNewSession() {
    if (isStreaming) return;
    setCurrentSession(null);
    clearMessages();
  }

  async function handleSelectSession(session: SessionItem) {
    if (isStreaming) return;
    setCurrentSession(session.id);
    clearMessages();
    try {
      setMessages(await loadSession(session.id));
    } catch {
      setMessages([{ role: 'system', content: 'Could not load this session.', timestamp: Date.now() }]);
    }
  }

  async function handleDeleteSession(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation();
    await deleteSession(sessionId).catch(() => undefined);
    setSessions(sessions.filter((s) => s.id !== sessionId));
    if (currentSessionId === sessionId) {
      setCurrentSession(null);
      clearMessages();
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* New session button */}
      <div className="px-2 py-2">
        <button
          onClick={handleNewSession}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-[#9d9d9d] hover:bg-[#2a2d2e] hover:text-[#cccccc] transition-colors"
          aria-label={t('sidebar.newSession')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          <span>{t('sidebar.newSession')}</span>
        </button>
      </div>

      {/* Section label */}
      <div className="px-3 py-1">
        <span className="text-[10px] uppercase tracking-wider text-[#6b6b6b]">
          {t('sidebar.sessions')}
        </span>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-1">
        {sessions.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[#6b6b6b]">{t('sidebar.noSessions')}</div>
        ) : (
          <ul role="list">
            {sessions
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((session) => (
                <li key={session.id}>
                  <button
                    onClick={() => handleSelectSession(session)}
                    className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                      currentSessionId === session.id
                        ? 'bg-[#37373d] text-[#cccccc]'
                        : 'text-[#9d9d9d] hover:bg-[#2a2d2e] hover:text-[#cccccc]'
                    }`}
                    aria-current={currentSessionId === session.id ? 'true' : undefined}
                  >
                    {/* Session icon */}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="currentColor"
                      className="flex-shrink-0 text-[#6b6b6b]"
                    >
                      <path
                        d="M1 1h10v7H7l-2 2V8H1V1z"
                        stroke="currentColor"
                        strokeWidth="1"
                        fill="none"
                      />
                    </svg>

                    {/* Title + date */}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs font-medium">{session.title}</span>
                      <span className="text-[10px] text-[#6b6b6b]">
                        {formatDate(session.updatedAt)}
                      </span>
                    </div>

                    {/* Delete button (visible on hover) */}
                    <button
                      onClick={(e) => handleDeleteSession(e, session.id)}
                      className="hidden flex-shrink-0 rounded p-0.5 text-[#6b6b6b] hover:bg-[#3e3e42] hover:text-[#f44747] group-hover:flex transition-colors"
                      title={t('sidebar.deleteSession')}
                      aria-label={t('sidebar.deleteSession')}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                        <path
                          d="M2 2l6 6M8 2L2 8"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          fill="none"
                        />
                      </svg>
                    </button>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
