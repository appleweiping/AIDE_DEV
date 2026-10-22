import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ApprovalRequest, ApprovalResponse, PermissionMode, ToolCall } from '@aide/shared';

// ---------------------------------------------------------------------------
// Risk classification
// ---------------------------------------------------------------------------

export type RiskLevel = 'safe' | 'needs_approval' | 'blocked';

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
}

// Patterns that are always blocked regardless of permission mode
const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+-rf\s+\//i, 'recursive delete from filesystem root'],
  [/\bRemove-Item\b.*-Recurse\b.*(C:\\|D:\\|\/|\*)/i, 'recursive PowerShell delete over broad target'],
  [/\bformat\b\s+[a-z]:/i, 'disk format command'],
  [/\bdiskpart\b/i, 'disk partition command'],
  [/\bshutdown\b|\bRestart-Computer\b|\bStop-Computer\b/i, 'system shutdown or restart'],
  [/\bSet-ExecutionPolicy\b/i, 'PowerShell execution policy change'],
  [/\breg\s+delete\b/i, 'registry deletion'],
  [/\bnet\s+user\b/i, 'user account modification'],
  [/\bchmod\s+-R\s+777\s+\//i, 'recursive world-writable permission change'],
  [/\bdd\s+if=/i, 'raw disk write/read command'],
];

// Patterns that require approval in 'safe' mode
const APPROVAL_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\b|\bdel\b|\brmdir\b|\bRemove-Item\b/i, 'delete command'],
  [/\bgit\s+(reset|clean|checkout|rebase)\b/i, 'history or working-tree rewrite'],
  [/\b(mv|move|cp|copy|xcopy|robocopy|Set-Content|Add-Content|Out-File)\b|(^|[^>])>{1,2}/i, 'file mutation or shell redirection'],
  [/\b(npm|pnpm|yarn|bun)\s+(install|add|remove|publish)\b|\b(uv\s+)?pip\s+install\b|\buv\s+(add|sync|install)\b/i, 'dependency or package registry operation'],
  [/\bgit\s+push\b.*(--force|-f|\+[^\s]+)/i, 'force push'],
  [/\bnpm\s+publish\b|\bpnpm\s+publish\b/i, 'package publish'],
  [/\b(curl|wget|iwr|Invoke-WebRequest)\b.*\|\s*(sh|bash|powershell|iex|Invoke-Expression)\b/i, 'downloaded script execution'],
  [/\b(powershell|pwsh)\b.*\s-(enc|encodedcommand)\b/i, 'encoded PowerShell command'],
  [/\bscp\b|\brsync\b.*:/i, 'remote file transfer'],
  [/\bssh\b/i, 'remote shell command'],
];

export function classifyCommand(command: string): RiskAssessment {
  for (const [pattern, reason] of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return { level: 'blocked', reason };
  }
  for (const [pattern, reason] of APPROVAL_PATTERNS) {
    if (pattern.test(command)) return { level: 'needs_approval', reason };
  }
  return { level: 'safe', reason: 'no risky pattern detected' };
}

// ---------------------------------------------------------------------------
// ApprovalManager events
// ---------------------------------------------------------------------------

export interface ApprovalManagerEvents {
  /** Emitted when a tool call needs user approval. The UI must respond via respond(). */
  approval_request: [request: ApprovalRequest];
}

// ---------------------------------------------------------------------------
// ApprovalManager
// ---------------------------------------------------------------------------

// Typed EventEmitter interface
export interface ApprovalManager {
  on<K extends keyof ApprovalManagerEvents>(event: K, listener: (...args: ApprovalManagerEvents[K]) => void): this;
  emit<K extends keyof ApprovalManagerEvents>(event: K, ...args: ApprovalManagerEvents[K]): boolean;
  off<K extends keyof ApprovalManagerEvents>(event: K, listener: (...args: ApprovalManagerEvents[K]) => void): this;
  once<K extends keyof ApprovalManagerEvents>(event: K, listener: (...args: ApprovalManagerEvents[K]) => void): this;
}

export class ApprovalManager extends EventEmitter {
  private mode: PermissionMode;
  /** Tool names the user has permanently approved in this session */
  private permanentlyApproved = new Set<string>();
  /** Pending approval promises keyed by request id */
  private pending = new Map<string, (approved: boolean) => void>();
  /**
   * Ask mode: when true, every tool call (including safe ones) emits an
   * approval_request event. This is the REPL /mode ask behaviour — it is
   * orthogonal to the permission mode (safe/trusted/locked).
   */
  private _askMode = false;

  constructor(mode: PermissionMode = 'safe') {
    super();
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /** Enable or disable ask mode (confirm every tool call). */
  setAskMode(enabled: boolean): void {
    this._askMode = enabled;
  }

  isAskMode(): boolean {
    return this._askMode;
  }

  /**
   * Request approval for a tool call.
   * - 'locked' mode: always blocks (returns false)
   * - 'trusted' mode: always approves (returns true), unless ask mode is on
   * - 'safe' mode: classifies the call and emits approval_request if needed
   * - ask mode (any permission mode): every tool call emits approval_request
   *
   * Returns true if the call should proceed, false if denied.
   */
  async requestApproval(toolCall: ToolCall, signal?: AbortSignal): Promise<boolean> {
    if (this.mode === 'locked') return false;

    // Classify first, so the blocked list also applies to tools approved with "always"
    const assessment = this.assessToolCall(toolCall);

    if (assessment.level === 'blocked') return false;

    // Check permanent approvals (skip in ask mode — ask mode always prompts)
    if (!this._askMode && this.permanentlyApproved.has(toolCall.name)) return true;

    // In ask mode: every non-blocked call needs approval
    // In trusted mode without ask: always approve safe/needs_approval
    if (!this._askMode) {
      if (this.mode === 'trusted') return true;
      if (assessment.level === 'safe') return true;
    }

    // needs_approval (or ask mode) — emit request and wait for response
    const requestId = randomUUID().slice(0, 8);
    const request: ApprovalRequest = {
      id: requestId,
      toolName: toolCall.name,
      description: this._askMode ? `ask mode: confirm ${toolCall.name}` : assessment.reason,
      command: typeof toolCall.arguments.command === 'string' ? toolCall.arguments.command : undefined,
      filePath: typeof toolCall.arguments.path === 'string' ? toolCall.arguments.path : undefined,
      timestamp: Date.now(),
    };

    return new Promise<boolean>((resolve) => {
      // Handle abort
      const onAbort = () => {
        this.pending.delete(requestId);
        resolve(false);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(requestId, (approved) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(approved);
      });

      this.emit('approval_request', request);
    });
  }

  /**
   * Respond to a pending approval request.
   * Called by the UI layer (e.g. ipc-server) when the user clicks approve/deny.
   */
  respond(response: ApprovalResponse): void {
    const resolver = this.pending.get(response.id);
    if (!resolver) return;
    this.pending.delete(response.id);
    resolver(response.approved);
  }

  /**
   * Respond with tool name for "remember" functionality.
   */
  respondWithToolName(response: ApprovalResponse, toolName: string): void {
    if (response.remember && response.approved) {
      this.permanentlyApproved.add(toolName);
    }
    this.respond(response);
  }

  /** List all pending approval requests (for UI polling). */
  listPending(): string[] {
    return Array.from(this.pending.keys());
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private assessToolCall(toolCall: ToolCall): RiskAssessment {
    // bash and powershell — classify the command string
    if (toolCall.name === 'bash' || toolCall.name === 'powershell') {
      const command = String(toolCall.arguments.command ?? '');
      return classifyCommand(command);
    }

    // monitor starts a background shell command: the blocked list applies,
    // and anything else still needs approval in safe mode
    if (toolCall.name === 'monitor') {
      const assessment = classifyCommand(String(toolCall.arguments.command ?? ''));
      if (assessment.level === 'blocked') return assessment;
      return { level: 'needs_approval', reason: 'background command' };
    }

    // file_write, file_edit and notebook_edit always need approval in safe mode
    if (toolCall.name === 'file_write' || toolCall.name === 'file_edit' || toolCall.name === 'notebook_edit') {
      return { level: 'needs_approval', reason: 'file write operation' };
    }

    if (toolCall.name === 'node_repl') {
      return { level: 'needs_approval', reason: 'runs JavaScript code' };
    }

    // Read-only tools are always safe
    const safeTools = new Set(['file_read', 'glob', 'grep', 'web_search', 'web_fetch']);
    if (safeTools.has(toolCall.name)) {
      return { level: 'safe', reason: 'read-only operation' };
    }

    // Unknown tools default to needs_approval
    return { level: 'needs_approval', reason: `unknown tool: ${toolCall.name}` };
  }
}
