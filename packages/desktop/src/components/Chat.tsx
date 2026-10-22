import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent';
import MessageInput from './MessageInput';
import ToolActivity from './ToolActivity';
import type { Message } from '@aide/shared';

// ── Simple regex-based markdown renderer ─────────────────────────────────────

function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced code blocks (``` lang\n...\n```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langAttr = lang ? ` data-lang="${lang}"` : '';
    return `<pre${langAttr}><code>${code.trimEnd()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Bold **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic *text* or _text_
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');

  // Strikethrough ~~text~~
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered list items
  html = html.replace(/^[*\-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Ordered list items
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Paragraphs — wrap consecutive non-block lines
  html = html
    .split('\n\n')
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^<(h[1-6]|ul|ol|li|pre|blockquote|hr)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return html;
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded bg-[#2d2d30] px-3 py-1 text-xs text-[#6b6b6b]">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 px-4 py-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          isUser
            ? 'bg-[#0e639c] text-white'
            : 'bg-[#4ec9b0] text-[#1e1e1e]'
        }`}
        aria-hidden="true"
      >
        {isUser ? t('chat.you')[0] : 'A'}
      </div>

      {/* Content */}
      <div className={`flex max-w-[80%] flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <span className="text-xs text-[#6b6b6b]">
          {isUser ? t('chat.you') : t('chat.assistant')}
        </span>

        {/* Reasoning (thinking) block */}
        {message.reasoning && (
          <details className="mb-1 w-full rounded border border-[#3e3e42] bg-[#252526]">
            <summary className="cursor-pointer px-3 py-1.5 text-xs text-[#9d9d9d] hover:text-[#cccccc]">
              {t('chat.thinking')}
            </summary>
            <div className="px-3 py-2 text-xs text-[#9d9d9d] font-mono whitespace-pre-wrap">
              {message.reasoning}
            </div>
          </details>
        )}

        {/* Tools used in this turn */}
        {!isUser &&
          message.toolCalls?.map((tc) => {
            const r = message.toolResults?.find((x) => x.callId === tc.id);
            return (
              <div key={tc.id} className="w-full">
                <ToolActivity
                  activity={{
                    callId: tc.id,
                    name: tc.name,
                    args: tc.arguments,
                    result: r?.content,
                    isError: r?.isError,
                    status: r?.isError ? 'error' : 'done',
                    startedAt: 0,
                  }}
                />
              </div>
            );
          })}

        {/* Main content */}
        {isUser ? (
          <div className="rounded-lg bg-[#0e639c] px-3 py-2 text-sm text-white whitespace-pre-wrap">
            {message.content}
          </div>
        ) : (
          <div
            className="prose text-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        )}

      </div>
    </div>
  );
}

// ── Streaming bubble ──────────────────────────────────────────────────────────

function StreamingBubble() {
  const { t } = useTranslation();
  const streaming = useAgentStore((s) => s.streaming);
  const toolActivities = useAgentStore((s) => s.toolActivities);

  const hasContent = streaming.currentContent.length > 0;
  const hasReasoning = streaming.currentReasoning.length > 0;
  const runningTools = toolActivities.filter((a) => a.status === 'running');

  return (
    <div className="flex gap-3 px-4 py-3">
      {/* Avatar */}
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#4ec9b0] text-xs font-semibold text-[#1e1e1e]">
        A
      </div>

      <div className="flex max-w-[80%] flex-col gap-2">
        <span className="text-xs text-[#6b6b6b]">{t('chat.assistant')}</span>

        {/* Tool activities */}
        {toolActivities.map((activity) => (
          <ToolActivity key={activity.callId} activity={activity} />
        ))}

        {/* Reasoning */}
        {hasReasoning && (
          <details className="w-full rounded border border-[#3e3e42] bg-[#252526]" open>
            <summary className="cursor-pointer px-3 py-1.5 text-xs text-[#9d9d9d]">
              {t('chat.thinking')}
            </summary>
            <div className="px-3 py-2 text-xs text-[#9d9d9d] font-mono whitespace-pre-wrap">
              {streaming.currentReasoning}
            </div>
          </details>
        )}

        {/* Content */}
        {hasContent ? (
          <div
            className="prose text-sm streaming-cursor"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming.currentContent) }}
          />
        ) : runningTools.length === 0 && !hasReasoning ? (
          <div className="flex items-center gap-1.5 text-sm text-[#9d9d9d]">
            <span className="inline-flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-[#9d9d9d]"
                  style={{ animation: `pulse-dot 1.4s ease-in-out ${i * 0.16}s infinite` }}
                />
              ))}
            </span>
            {t('chat.streaming')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Chat panel ────────────────────────────────────────────────────────────────

export default function Chat() {
  const { t } = useTranslation();
  const messages = useAgentStore((s) => s.messages);
  const streaming = useAgentStore((s) => s.streaming);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming.currentContent]);

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !streaming.isStreaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-8">
            <h2 className="text-lg font-semibold text-[#cccccc]">{t('chat.emptyState')}</h2>
            <p className="text-sm text-[#9d9d9d] max-w-sm">{t('chat.emptyStateHint')}</p>
          </div>
        ) : (
          <div className="py-2">
            {messages.map((msg, idx) => (
              <MessageBubble key={idx} message={msg} />
            ))}
            {streaming.isStreaming && <StreamingBubble />}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-[#3e3e42]">
        <MessageInput />
      </div>
    </div>
  );
}
