/**
 * ipc-server.ts
 *
 * JSON-RPC 2.0 server over stdio.
 * The Tauri shell spawns this process and communicates via stdin/stdout.
 *
 * Protocol:
 *   - Requests:  newline-delimited JSON-RPC 2.0 objects on stdin
 *   - Responses: newline-delimited JSON-RPC 2.0 objects on stdout
 *   - Events:    newline-delimited JSON objects with { event, data } on stdout
 *
 * All CoreMethod requests are handled here.
 * CoreEvent notifications are pushed to stdout as they occur.
 */

import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type {
  AgentConfig,
  ProviderConfig,
  ApprovalResponse,
  Message,
} from '@aide/shared';
import { PROVIDER_PRESETS } from '@aide/shared';
import { Agent } from './agent.js';
import { providerRegistry } from './provider/registry.js';
import type { ProviderMessage } from './provider/types.js';
import { toolRegistry } from './tools/registry.js';
import { registerBuiltinTools } from './tools/index.js';
import { setWorkingDirectory } from './tools/path-guard.js';
import { ApprovalManager } from './safety/approval.js';
import { SessionManager } from './session/manager.js';
import { McpManager } from './mcp/manager.js';
import type { McpServerConfig } from './mcp/client.js';
import { GitOperations } from './git/operations.js';
import { SubAgentManager, SharedContext } from './agent/sub-agent.js';
import { HooksManager } from './hooks/manager.js';
import type { HookDefinition, HookEvent } from './hooks/manager.js';

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface CoreEvent {
  event: string;
  data: unknown;
}

// ---------------------------------------------------------------------------
// IPC Server
// ---------------------------------------------------------------------------

export class IpcServer {
  private sessionManager: SessionManager;
  private approvalManager: ApprovalManager;
  private mcpManager: McpManager;
  private hooksManager: HooksManager;
  private activeAgent: Agent | null = null;
  private activeSessionId: string | null = null;
  private sharedContext: SharedContext | null = null;

  constructor(sessionsDir: string) {
    this.sessionManager = new SessionManager(sessionsDir);
    this.approvalManager = new ApprovalManager('safe');
    this.mcpManager = new McpManager();
    this.hooksManager = new HooksManager();

    // Initialize shared context for sub-agent communication
    this.sharedContext = new SharedContext();

    // Forward approval requests to the UI
    this.approvalManager.on('approval_request', (request) => {
      this.sendEvent('approval_request', request);
    });

    // Forward MCP server events to the UI
    this.mcpManager.on('serverExit', (data) => this.sendEvent('mcp.serverExit', data));
    this.mcpManager.on('serverStderr', (data) => this.sendEvent('mcp.serverStderr', data));
    this.mcpManager.on('connected', (name) => this.sendEvent('mcp.connected', { name }));
    this.mcpManager.on('disconnected', (name) => this.sendEvent('mcp.disconnected', { name }));

  }

  async start(): Promise<void> {
    await this.sessionManager.init();
    registerBuiltinTools();

    const rl = createInterface({
      input: process.stdin,
      output: undefined,
      terminal: false,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.handleLine(trimmed);
    });

    rl.on('close', () => {
      process.exit(0);
    });

    // Signal readiness
    this.sendEvent('ready', { version: '0.1.0' });
  }

  // -------------------------------------------------------------------------
  // Line handler
  // -------------------------------------------------------------------------

  private handleLine(line: string): void {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      this.sendError(null, -32700, 'Parse error');
      return;
    }

    if (request.jsonrpc !== '2.0' || !request.method) {
      this.sendError(request.id ?? null, -32600, 'Invalid Request');
      return;
    }

    this.dispatch(request).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.sendError(request.id, -32603, `Internal error: ${message}`);
    });
  }

  // -------------------------------------------------------------------------
  // Method dispatcher
  // -------------------------------------------------------------------------

  private async dispatch(request: JsonRpcRequest): Promise<void> {
    const params = (request.params ?? {}) as Record<string, unknown>;

    switch (request.method) {
      // --- Provider methods ---
      case 'provider.list':
        return this.sendResult(request.id, PROVIDER_PRESETS);

      // Send a one-token request to check the endpoint, key and model.
      case 'provider.test': {
        const config = params.provider as ProviderConfig | undefined;
        if (!config?.baseUrl || !config?.apiKey || !config?.model) {
          return this.sendError(request.id, -32602, 'provider with baseUrl, apiKey and model is required');
        }
        try {
          const provider = providerRegistry.get(config);
          await provider.complete({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 });
          return this.sendResult(request.id, { ok: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return this.sendResult(request.id, { ok: false, error: message.slice(0, 300) });
        }
      }

      case 'provider.getPreset': {
        const id = String(params.id ?? '');
        const preset = providerRegistry.getPreset(id);
        if (!preset) return this.sendError(request.id, -32602, `Unknown provider: ${id}`);
        return this.sendResult(request.id, preset);
      }

      // --- Session methods ---
      case 'session.list': {
        const sessions = await this.sessionManager.list();
        return this.sendResult(request.id, sessions);
      }

      case 'session.create': {
        const session = await this.sessionManager.create({
          title: params.title as string | undefined,
          workingDirectory: String(params.workingDirectory ?? process.cwd()),
          providerId: String(params.providerId ?? 'deepseek'),
          model: String(params.model ?? 'deepseek-chat'),
        });
        return this.sendResult(request.id, session);
      }

      case 'session.get': {
        const id = String(params.id ?? '');
        const session = await this.sessionManager.get(id);
        if (!session) return this.sendError(request.id, -32602, `Session not found: ${id}`);
        return this.sendResult(request.id, session);
      }

      case 'session.delete': {
        const id = String(params.id ?? '');
        const ok = await this.sessionManager.delete(id);
        return this.sendResult(request.id, { deleted: ok });
      }

      case 'session.rename': {
        const id = String(params.id ?? '');
        const title = String(params.title ?? '');
        const ok = await this.sessionManager.rename(id, title);
        return this.sendResult(request.id, { renamed: ok });
      }

      case 'session.clearMessages': {
        const id = String(params.id ?? '');
        const ok = await this.sessionManager.clearMessages(id);
        return this.sendResult(request.id, { cleared: ok });
      }

      // --- Agent methods ---
      case 'agent.run': {
        const sessionId = String(params.sessionId ?? '');
        const userMessage = String(params.message ?? '');
        const providerConfig = params.provider as ProviderConfig;
        const agentConfig = params.config as AgentConfig;

        if (!sessionId || !userMessage || !providerConfig) {
          return this.sendError(request.id, -32602, 'sessionId, message, and provider are required');
        }

        // Load session
        const session = await this.sessionManager.get(sessionId);
        if (!session) {
          return this.sendError(request.id, -32602, `Session not found: ${sessionId}`);
        }

        // Cancel any running agent
        if (this.activeAgent) {
          this.activeAgent.cancel();
          this.activeAgent = null;
        }

        // File tools resolve relative paths and restrict writes to this folder;
        // bash, glob and grep run in it.
        setWorkingDirectory(session.workingDirectory);
        this.approvalManager.setMode(agentConfig?.permissionMode ?? 'safe');

        // Create provider and agent
        const provider = providerRegistry.get(providerConfig);
        const agent = new Agent(
          provider,
          toolRegistry,
          agentConfig ?? {
            provider: providerConfig,
            maxIterations: 50,
            thinkingEnabled: false,
            thinkingEffort: 'medium',
            permissionMode: 'safe',
            workingDirectory: session.workingDirectory,
          },
          this.approvalManager,
        );

        // Restore message history
        if (session.messages.length > 0) {
          agent.restoreMessages(
            session.messages.map(messageToProviderMessage),
          );
        }

        this.activeAgent = agent;
        this.activeSessionId = sessionId;

        // Wire up streaming events
        agent.on('content', (delta) => this.sendEvent('agent.content', { sessionId, delta }));
        agent.on('reasoning', (delta) => this.sendEvent('agent.reasoning', { sessionId, delta }));
        agent.on('thinking', (iteration) => this.sendEvent('agent.thinking', { sessionId, iteration }));
        agent.on('tool_start', (call) => this.sendEvent('agent.tool_start', { sessionId, call }));
        agent.on('tool_end', (call, result, elapsedMs) =>
          this.sendEvent('agent.tool_end', { sessionId, call, result, elapsedMs }),
        );
        agent.on('done', (reason, content) => {
          this.sendEvent('agent.done', { sessionId, reason, content });
          this.activeAgent = null;
          this.activeSessionId = null;
        });
        agent.on('error', (err) => {
          this.sendEvent('agent.error', { sessionId, error: err.message });
        });

        // Acknowledge immediately, then run async
        this.sendResult(request.id, { started: true, sessionId });

        // Run agent and persist result
        agent.run(userMessage).then(async (reply) => {
          // Persist updated messages back to session
          const updatedMessages = agent.getMessages();
          const updatedSession = await this.sessionManager.get(sessionId);
          if (updatedSession) {
            updatedSession.messages = updatedMessages.map(providerMessageToMessage);
            await this.sessionManager.update(updatedSession);
          }
        }).catch(() => {
          // Error already emitted via agent.on('error')
        });

        return;
      }

      case 'agent.cancel': {
        if (this.activeAgent) {
          this.activeAgent.cancel();
          this.activeAgent = null;
        }
        return this.sendResult(request.id, { cancelled: true });
      }

      case 'agent.compact': {
        if (!this.activeAgent) {
          return this.sendError(request.id, -32603, 'No active agent');
        }
        const keepRecent = typeof params.keepRecent === 'number' ? params.keepRecent : 12;
        const summary = this.activeAgent.compactContext(keepRecent);
        return this.sendResult(request.id, { summary });
      }

      // --- Shared context methods ---
      case 'agent.getShared': {
        const key = String(params.key ?? '');
        if (!key) return this.sendError(request.id, -32602, 'key is required');
        const value = this.sharedContext?.get(key);
        return this.sendResult(request.id, { key, value: value !== undefined ? value : null });
      }

      case 'agent.setShared': {
        const key = String(params.key ?? '');
        if (!key) return this.sendError(request.id, -32602, 'key is required');
        this.sharedContext?.set(key, params.value);
        return this.sendResult(request.id, { ok: true });
      }

      case 'agent.listShared': {
        const keys = this.sharedContext?.keys() ?? [];
        return this.sendResult(request.id, { keys });
      }

      // --- Approval methods ---
      case 'approval.respond': {
        const response = params as ApprovalResponse;
        const toolName = String(params.toolName ?? '');
        if (toolName) {
          this.approvalManager.respondWithToolName(response, toolName);
        } else {
          this.approvalManager.respond(response);
        }
        return this.sendResult(request.id, { ok: true });
      }

      case 'approval.setMode': {
        const mode = String(params.mode ?? 'safe') as 'safe' | 'trusted' | 'locked';
        this.approvalManager.setMode(mode);
        return this.sendResult(request.id, { mode });
      }

      case 'approval.getMode': {
        return this.sendResult(request.id, { mode: this.approvalManager.getMode() });
      }

      // --- Tool methods ---
      case 'tools.list': {
        return this.sendResult(request.id, toolRegistry.list());
      }


      // --- MCP methods ---
      case 'mcp.connect': {
        const config = params as unknown as McpServerConfig;
        if (!config?.name || !config?.command) {
          return this.sendError(request.id, -32602, 'name and command are required');
        }
        const status = await this.mcpManager.connect(config);
        return this.sendResult(request.id, status);
      }

      case 'mcp.disconnect': {
        const name = String(params.name ?? '');
        if (!name) return this.sendError(request.id, -32602, 'name is required');
        await this.mcpManager.disconnect(name);
        return this.sendResult(request.id, { disconnected: true });
      }

      case 'mcp.list': {
        return this.sendResult(request.id, this.mcpManager.getStatus());
      }

      case 'mcp.callTool': {
        const serverName = String(params.server ?? '');
        const toolName = String(params.tool ?? '');
        const toolArgs = (params.args ?? {}) as Record<string, unknown>;
        if (!serverName || !toolName) {
          return this.sendError(request.id, -32602, 'server and tool are required');
        }
        const output = await this.mcpManager.callTool(serverName, toolName, toolArgs);
        return this.sendResult(request.id, { output });
      }

      // --- Git methods ---
      case 'git.status': {
        const cwd = String(params.cwd ?? process.cwd());
        const git = new GitOperations(cwd);
        const output = await git.status();
        return this.sendResult(request.id, { output });
      }

      case 'git.branch': {
        const cwd = String(params.cwd ?? process.cwd());
        const git = new GitOperations(cwd);
        const output = await git.branch();
        return this.sendResult(request.id, { branch: output });
      }

      case 'git.log': {
        const cwd = String(params.cwd ?? process.cwd());
        const count = typeof params.count === 'number' ? params.count : 10;
        const git = new GitOperations(cwd);
        const output = await git.log(count);
        return this.sendResult(request.id, { output });
      }

      case 'git.diff': {
        const cwd = String(params.cwd ?? process.cwd());
        const staged = Boolean(params.staged ?? false);
        const git = new GitOperations(cwd);
        const output = await git.diff(staged);
        return this.sendResult(request.id, { output });
      }

      case 'git.commit': {
        const cwd = String(params.cwd ?? process.cwd());
        const message = String(params.message ?? '');
        if (!message) return this.sendError(request.id, -32602, 'message is required');
        const git = new GitOperations(cwd);
        // Stage all tracked changes if files not specified
        const files = Array.isArray(params.files) ? (params.files as string[]) : ['.'];
        await git.add(files);
        const output = await git.commit(message);
        return this.sendResult(request.id, { output });
      }

      case 'git.push': {
        const cwd = String(params.cwd ?? process.cwd());
        const remote = String(params.remote ?? 'origin');
        const branch = params.branch ? String(params.branch) : undefined;
        const git = new GitOperations(cwd);
        const output = await git.push(remote, branch);
        return this.sendResult(request.id, { output });
      }

      case 'git.createBranch': {
        const cwd = String(params.cwd ?? process.cwd());
        const name = String(params.name ?? '');
        if (!name) return this.sendError(request.id, -32602, 'name is required');
        const git = new GitOperations(cwd);
        const output = await git.createBranch(name);
        return this.sendResult(request.id, { output });
      }

      // --- Sub-agent methods ---
      case 'agent.spawnSub': {
        const task = String(params.task ?? '');
        if (!task) return this.sendError(request.id, -32602, 'task is required');

        if (!this.activeAgent) {
          return this.sendError(request.id, -32603, 'No active agent session to spawn sub-agent from');
        }

        // Retrieve the active session's provider config
        const sessionId = this.activeSessionId;
        if (!sessionId) {
          return this.sendError(request.id, -32603, 'No active session');
        }
        const session = await this.sessionManager.get(sessionId);
        if (!session) {
          return this.sendError(request.id, -32602, `Session not found: ${sessionId}`);
        }

        const providerConfig = params.provider as ProviderConfig | undefined;
        const agentConfig = params.config as Partial<AgentConfig> | undefined;
        const maxConcurrent = typeof params.maxConcurrent === 'number' ? params.maxConcurrent : 3;

        const parentProviderConfig: ProviderConfig = providerConfig ?? {
          id: session.providerId,
          name: session.providerId,
          baseUrl: '',
          apiKey: '',
          model: session.model,
        };

        const parentAgentConfig: AgentConfig = {
          provider: parentProviderConfig,
          maxIterations: 50,
          thinkingEnabled: false,
          thinkingEffort: 'medium',
          permissionMode: 'safe',
          workingDirectory: session.workingDirectory,
        };

        const manager = new SubAgentManager(parentAgentConfig, parentProviderConfig, maxConcurrent);

        // Forward sub-agent events to the UI
        manager.on('spawned', (id, subTask) =>
          this.sendEvent('agent.subSpawned', { parentSessionId: sessionId, id, task: subTask }),
        );
        manager.on('content', (id, delta) =>
          this.sendEvent('agent.subContent', { id, delta }),
        );
        manager.on('finished', (result) =>
          this.sendEvent('agent.subFinished', { parentSessionId: sessionId, ...result }),
        );
        manager.on('message', (fromId, toId, content) =>
          this.sendEvent('agent.subMessage', { parentSessionId: sessionId, fromId, toId, content }),
        );

        // Acknowledge immediately, run async
        this.sendResult(request.id, { started: true, task });

        manager.spawn(task, agentConfig).then((reply) => {
          this.sendEvent('agent.subReply', { parentSessionId: sessionId, task, reply });
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.sendEvent('agent.subError', { parentSessionId: sessionId, task, error: message });
        });

        return;
      }

      // --- Hooks methods ---
      case 'hooks.register': {
        const hook = params as unknown as HookDefinition;
        if (!hook?.event || !hook?.command) {
          return this.sendError(request.id, -32602, 'event and command are required');
        }
        this.hooksManager.register(hook);
        return this.sendResult(request.id, { registered: true });
      }

      case 'hooks.list': {
        return this.sendResult(request.id, this.hooksManager.getRegistered());
      }

      case 'hooks.unregister': {
        const event = String(params.event ?? '') as HookEvent;
        if (!event) return this.sendError(request.id, -32602, 'event is required');
        this.hooksManager.unregister(event);
        return this.sendResult(request.id, { unregistered: true });
      }

      // --- Session fork ---
      case 'session.fork': {
        const { sessionId, title, truncateAfterMessageIndex } = params as {
          sessionId: string;
          title?: string;
          truncateAfterMessageIndex?: number;
        };
        if (!sessionId) return this.sendError(request.id, -32602, 'sessionId is required');
        const forked = await this.sessionManager.fork(sessionId, { title, truncateAfterMessageIndex });
        if (!forked) return this.sendError(request.id, -32001, 'Session not found');
        this.sendEvent('session.forked', { originalId: sessionId, forkedId: forked.id, title: forked.title });
        return this.sendResult(request.id, forked);
      }

      default:
        return this.sendError(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  // -------------------------------------------------------------------------
  // Output helpers
  // -------------------------------------------------------------------------

  private sendResult(id: string | number | null, result: unknown): void {
    const response: JsonRpcResponse = { jsonrpc: '2.0', id: id ?? null, result };
    this.writeLine(JSON.stringify(response));
  }

  private sendError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    };
    this.writeLine(JSON.stringify(response));
  }

  private sendEvent(event: string, data: unknown): void {
    const notification: CoreEvent = { event, data };
    this.writeLine(JSON.stringify(notification));
  }

  private writeLine(line: string): void {
    process.stdout.write(line + '\n');
  }
}

// ---------------------------------------------------------------------------
// Message conversion helpers
// ---------------------------------------------------------------------------

function messageToProviderMessage(msg: Message): ProviderMessage {
  if (msg.role === 'tool') {
    // Tool results are stored in toolResults array in shared Message type
    // but we need to reconstruct the wire format
    const result = msg.toolResults?.[0];
    return {
      role: 'tool',
      content: result?.content ?? msg.content,
      tool_call_id: result?.callId ?? '',
    };
  }

  if (msg.role === 'assistant') {
    const toolCalls = msg.toolCalls?.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));
    return {
      role: 'assistant',
      content: msg.content || null,
      ...(msg.reasoning ? { reasoning_content: msg.reasoning } : {}),
      ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
  }

  return { role: msg.role as 'system' | 'user', content: msg.content };
}

function providerMessageToMessage(msg: ProviderMessage): Message {
  const now = Date.now();

  if (msg.role === 'tool') {
    return {
      role: 'tool',
      content: msg.content,
      toolResults: [{ callId: msg.tool_call_id, content: msg.content, isError: false }],
      timestamp: now,
    };
  }

  if (msg.role === 'assistant') {
    const toolCalls = msg.tool_calls?.map((tc) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments); } catch {}
      return { id: tc.id, name: tc.function.name, arguments: args };
    });
    return {
      role: 'assistant',
      content: msg.content ?? '',
      ...(msg.reasoning_content ? { reasoning: msg.reasoning_content } : {}),
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      timestamp: now,
    };
  }

  return { role: msg.role, content: msg.content, timestamp: now };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function startIpcServer(sessionsDir?: string): Promise<void> {
  const dir = sessionsDir ?? resolve(process.env.AIDE_SESSIONS_DIR ?? join(homedir(), '.aide', 'sessions'));
  const server = new IpcServer(dir);
  await server.start();
}
