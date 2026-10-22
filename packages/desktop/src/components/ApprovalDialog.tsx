import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent';
import { respondApproval } from '../lib/api';

export default function ApprovalDialog() {
  const { t } = useTranslation();
  const pendingApproval = useAgentStore((s) => s.pendingApproval);
  const clearPendingApproval = useAgentStore((s) => s.clearPendingApproval);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!pendingApproval) return null;

  async function handleRespond(approved: boolean) {
    if (!pendingApproval) return;
    setLoading(true);
    try {
      await respondApproval(pendingApproval.id, approved, remember, pendingApproval.toolName);
    } catch (err) {
      console.error('respondApproval error:', err);
    } finally {
      setLoading(false);
      clearPendingApproval();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
    >
      <div className="w-full max-w-md rounded-lg border border-[#3e3e42] bg-[#252526] shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[#3e3e42] px-4 py-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="text-[#cca700] flex-shrink-0"
          >
            <path d="M8 1L1 14h14L8 1zm0 3l4.5 8h-9L8 4zm-.5 3v3h1V7h-1zm0 4v1h1v-1h-1z" />
          </svg>
          <h2 id="approval-title" className="text-sm font-semibold text-[#cccccc]">
            {t('approval.title')}
          </h2>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-[#9d9d9d]">{t('approval.description')}</p>

          {/* Tool name */}
          <div className="rounded bg-[#2d2d30] px-3 py-2">
            <span className="text-xs text-[#6b6b6b] uppercase tracking-wider">Tool</span>
            <div className="mt-0.5 font-mono text-sm text-[#4ec9b0]">
              {pendingApproval.toolName}
            </div>
          </div>

          {/* Description */}
          <div className="rounded bg-[#2d2d30] px-3 py-2">
            <span className="text-xs text-[#6b6b6b] uppercase tracking-wider">Description</span>
            <div className="mt-0.5 text-sm text-[#cccccc]">{pendingApproval.description}</div>
          </div>

          {/* Command (if present) */}
          {pendingApproval.command && (
            <div className="rounded bg-[#2d2d30] px-3 py-2">
              <span className="text-xs text-[#6b6b6b] uppercase tracking-wider">
                {t('approval.command')}
              </span>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-[#ce9178]">
                {pendingApproval.command}
              </pre>
            </div>
          )}

          {/* File path (if present) */}
          {pendingApproval.filePath && (
            <div className="rounded bg-[#2d2d30] px-3 py-2">
              <span className="text-xs text-[#6b6b6b] uppercase tracking-wider">
                {t('approval.file')}
              </span>
              <div className="mt-0.5 font-mono text-xs text-[#9cdcfe] break-all">
                {pendingApproval.filePath}
              </div>
            </div>
          )}

          {/* Remember checkbox */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#9d9d9d]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[#3e3e42] bg-[#2d2d30] accent-[#0e639c]"
            />
            {t('approval.remember')}
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-[#3e3e42] px-4 py-3">
          <button
            onClick={() => handleRespond(false)}
            disabled={loading}
            className="rounded border border-[#3e3e42] bg-transparent px-4 py-1.5 text-sm text-[#cccccc] hover:bg-[#2a2d2e] disabled:opacity-50 transition-colors"
          >
            {t('approval.deny')}
          </button>
          <button
            onClick={() => handleRespond(true)}
            disabled={loading}
            className="rounded bg-[#0e639c] px-4 py-1.5 text-sm text-white hover:bg-[#1177bb] disabled:opacity-50 transition-colors"
          >
            {t('approval.approve')}
          </button>
        </div>
      </div>
    </div>
  );
}
