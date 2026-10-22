import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolActivity as ToolActivityType } from '../stores/agent';

interface Props {
  activity: ToolActivityType;
}

// Format a value for compact display
function formatValue(value: unknown, maxLen = 120): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    return value.length > maxLen ? value.slice(0, maxLen) + '…' : value;
  }
  const json = JSON.stringify(value, null, 2);
  return json.length > maxLen ? json.slice(0, maxLen) + '…' : json;
}

// Tool icon by name
function ToolIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes('read') || lower.includes('file')) {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2h7l3 3v9H2V2zm7 0v3h3" stroke="currentColor" strokeWidth="1" fill="none" />
      </svg>
    );
  }
  if (lower.includes('write') || lower.includes('edit')) {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.5 2.5l2 2-9 9H2.5v-2l9-9z" stroke="currentColor" strokeWidth="1" fill="none" />
      </svg>
    );
  }
  if (lower.includes('bash') || lower.includes('exec') || lower.includes('run')) {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 3h12v10H2V3zm2 3l3 2-3 2m4 0h4" stroke="currentColor" strokeWidth="1.2" fill="none" />
      </svg>
    );
  }
  if (lower.includes('search') || lower.includes('grep')) {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  // Default
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export default function ToolActivity({ activity }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    activity.status === 'running'
      ? 'text-[#569cd6]'
      : activity.status === 'error'
      ? 'text-[#f44747]'
      : 'text-[#4ec9b0]';

  const statusLabel =
    activity.status === 'running'
      ? t('tool.running')
      : activity.status === 'error'
      ? t('tool.error')
      : t('tool.done');

  const argsEntries = Object.entries(activity.args);

  return (
    <div className="rounded border border-[#3e3e42] bg-[#252526] text-xs overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[#2a2d2e] transition-colors"
        aria-expanded={expanded}
      >
        {/* Status indicator */}
        <span className={`flex-shrink-0 ${statusColor}`}>
          {activity.status === 'running' ? (
            <span className="inline-block h-2 w-2 rounded-full bg-current animate-pulse" />
          ) : activity.status === 'error' ? (
            <span className="inline-block h-2 w-2 rounded-full bg-current" />
          ) : (
            <span className="inline-block h-2 w-2 rounded-full bg-current" />
          )}
        </span>

        {/* Tool icon + name */}
        <span className="flex items-center gap-1.5 text-[#9d9d9d]">
          <ToolIcon name={activity.name} />
          <span className="font-mono font-medium text-[#cccccc]">{activity.name}</span>
        </span>
        <span className="min-w-0 truncate font-mono text-[#6b6b6b]">
          {String(activity.args.command ?? activity.args.path ?? activity.args.pattern ?? activity.args.url ?? '')}
        </span>

        {/* Status label */}
        <span className={`ml-auto flex-shrink-0 ${statusColor}`}>{statusLabel}</span>

        {/* Duration */}
        {activity.durationMs !== undefined && (
          <span className="text-[#6b6b6b]">
            {t('tool.duration', { ms: activity.durationMs })}
          </span>
        )}

        {/* Expand chevron */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={`flex-shrink-0 text-[#6b6b6b] transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-[#3e3e42] px-3 py-2 space-y-2">
          {/* Arguments */}
          {argsEntries.length > 0 && (
            <div>
              <div className="mb-1 text-[#6b6b6b] uppercase tracking-wider text-[10px]">
                {t('tool.args')}
              </div>
              <div className="space-y-1">
                {argsEntries.map(([key, val]) => (
                  <div key={key} className="flex gap-2">
                    <span className="flex-shrink-0 text-[#9cdcfe] font-mono">{key}:</span>
                    <span className="text-[#ce9178] font-mono break-all">
                      {formatValue(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result */}
          {activity.result !== undefined && (
            <div>
              <div className="mb-1 text-[#6b6b6b] uppercase tracking-wider text-[10px]">
                {t('tool.result')}
              </div>
              <pre
                className={`whitespace-pre-wrap break-all font-mono text-[11px] ${
                  activity.isError ? 'text-[#f44747]' : 'text-[#4ec9b0]'
                }`}
              >
                {formatValue(activity.result, 500)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
