import { useState, useRef, useCallback, type DragEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent';
import { sendMessage, cancelAgent } from '../lib/api';

export default function MessageInput() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = useAgentStore((s) => s.streaming.isStreaming);
  const currentSessionId = useAgentStore((s) => s.currentSessionId);
  const setCurrentSession = useAgentStore((s) => s.setCurrentSession);
  const addMessage = useAgentStore((s) => s.addMessage);
  const startStreaming = useAgentStore((s) => s.startStreaming);
  const stopStreaming = useAgentStore((s) => s.stopStreaming);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setError(null);
    setText('');
    addMessage({ role: 'user', content: trimmed, timestamp: Date.now() });
    startStreaming();

    try {
      const sessionId = await sendMessage(trimmed, currentSessionId);
      if (sessionId !== currentSessionId) setCurrentSession(sessionId);
    } catch (err) {
      stopStreaming();
      setError(err instanceof Error ? err.message : t('errors.sendFailed'));
    }
  }, [text, isStreaming, currentSessionId, addMessage, startStreaming, stopStreaming, setCurrentSession, t]);

  const handleCancel = useCallback(async () => {
    try {
      await cancelAgent();
    } catch {
      setError(t('errors.cancelFailed'));
    }
  }, [t]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Auto-resize textarea
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  // File drag-and-drop: append file paths to the message
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const paths = files.map((f) => f.name).join('\n');
    setText((prev) => (prev ? `${prev}\n${paths}` : paths));
    textareaRef.current?.focus();
  }, []);

  return (
    <div
      className={`relative px-4 py-3 transition-colors ${
        isDragging ? 'bg-[#0e639c]/10' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded border-2 border-dashed border-[#0e639c] bg-[#0e639c]/5 text-sm text-[#0e639c]">
          {t('chat.dropFiles')}
        </div>
      )}

      {error && (
        <div className="mb-2 rounded bg-[#f44747]/10 px-3 py-1.5 text-xs text-[#f44747]">
          {error}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder')}
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none rounded border border-[#3e3e42] bg-[#2d2d30] px-3 py-2 text-sm text-[#cccccc] placeholder-[#6b6b6b] outline-none transition-colors focus:border-[#0e639c] disabled:opacity-50"
          style={{ minHeight: '38px', maxHeight: '200px' }}
          aria-label={t('chat.placeholder')}
        />

        {isStreaming ? (
          <button
            onClick={handleCancel}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[#f44747]/20 text-[#f44747] hover:bg-[#f44747]/30 transition-colors"
            title={t('chat.cancel')}
            aria-label={t('chat.cancel')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="2" width="10" height="10" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[#0e639c] text-white hover:bg-[#1177bb] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={`${t('chat.send')} (Ctrl+Enter)`}
            aria-label={t('chat.send')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M1 1l12 6-12 6V8.5l8-1.5-8-1.5V1z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
