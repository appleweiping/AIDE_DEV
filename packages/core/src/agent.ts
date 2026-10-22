import { EventEmitter } from 'node:events';
import type { AgentConfig, ToolCall, ToolResult } from '@aide/shared';
import { DEFAULT_MAX_ITERATIONS } from '@aide/shared';
import type { LLMProvider, CompletionRequest, ProviderMessage, ProviderToolCall } from './provider/index.js';
import { ToolRegistry } from './tools/registry.js';
import type { ApprovalManager } from './safety/approval.js';
import { loadProjectContext, formatContextForPrompt } from './context-loader.js';
import { compactContext, estimateMessageTokens } from './session/compaction.js';
import type { HooksManager } from './hooks/manager.js';
import type { PlanManager } from './plan/manager.js';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface AgentEvents {
  /** Fired at the start of each iteration */
  iteration: [iteration: number, maxIterations: number];
  /** Fired when the LLM starts generating a response */
  thinking: [iteration: number];
  /** Fired for each streaming content chunk */
  content: [delta: string];
  /** Fired for each streaming reasoning chunk */
  reasoning: [delta: string];
  /** Fired when a tool call is about to be executed */
  tool_start: [call: ToolCall];
  /** Fired when a tool call completes */
  tool_end: [call: ToolCall, result: ToolResult, elapsedMs: number];
  /** Fired when the agent produces a final text reply */
  reply: [content: string];
  /** Fired when the agent loop ends (reply, max_iterations, or cancelled) */
  done: [reason: 'reply' | 'max_iterations' | 'cancelled' | 'error', content: string];
  /** Fired on unrecoverable errors */
  error: [err: Error];
  /** Fired when prompt caching stats are available */
  cache_stats: [cacheReadTokens: number, cacheCreationTokens: number];
  /** Fired when context is auto-compacted */
  compacted: [messagesBefore: number, messagesAfter: number];
}

// ---------------------------------------------------------------------------
// Agent class
// ---------------------------------------------------------------------------

// Typed EventEmitter interface — augments the base class with typed overloads
export interface Agent {
  on<K extends keyof AgentEvents>(event: K, listener: (...args: AgentEvents[K]) => void): this;
  emit<K extends keyof AgentEvents>(event: K, ...args: AgentEvents[K]): boolean;
  off<K extends keyof AgentEvents>(event: K, listener: (...args: AgentEvents[K]) => void): this;
  once<K extends keyof AgentEvents>(event: K, listener: (...args: AgentEvents[K]) => void): this;
}

// Rough token estimate: 1 token ≈ 4 chars. Used for auto-compaction threshold.
function estimateTokens(messages: ProviderMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    // tool_calls exists only on the 'assistant' variant of the ProviderMessage
    // union — narrow with `in` before reading it.
    if ('tool_calls' in m && m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(chars / 4);
}

// Context window sizes by model keyword (conservative lower bounds)
const MODEL_CONTEXT_WINDOWS: Array<[RegExp, number]> = [
  [/minimax/i, 1_000_000],
  [/moonshot.*128k|kimi.*128k/i, 128_000],
  [/moonshot.*32k|kimi.*32k/i, 32_000],
  [/glm-4/i, 128_000],
  [/qwen.*131k|qwen.*plus/i, 131_000],
  [/qwen.*max/i, 32_000],
  [/qwq/i, 131_000],
  [/doubao.*256k/i, 256_000],
  [/doubao/i, 32_000],
  [/deepseek/i, 64_000],
  [/gpt-4/i, 128_000],
  [/claude/i, 200_000],
];

function getContextWindow(model: string): number {
  for (const [re, size] of MODEL_CONTEXT_WINDOWS) {
    if (re.test(model)) return size;
  }
  return 32_000; // safe default
}

export class Agent extends EventEmitter {
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private approvalManager: ApprovalManager | null;
  private hooksManager: HooksManager | null;
  private planManager: PlanManager | null;
  private config: AgentConfig;
  private messages: ProviderMessage[] = [];
  private abortController: AbortController | null = null;
  private contextWindow: number;

  /**
   * Register MCP tools from a McpManager into this agent's tool registry.
   * Call this after connecting MCP servers so the agent can use them.
   */
  registerMcpTools(mcpManager: { getToolDefinitions: () => Array<{ name: string; description: string; parameters: Record<string, unknown> }>; callTool: (server: string, tool: string, args: Record<string, unknown>) => Promise<string> }): void {
    const defs = mcpManager.getToolDefinitions();
    for (const def of defs) {
      // Extract server name from prefixed tool name: mcp_<server>_<tool>
      const parts = def.name.split('_');
      const serverName = parts[1] ?? '';
      const toolName = parts.slice(2).join('_');
      this.toolRegistry.register(
        def.name,
        def.description,
        def.parameters,
        async (args) => {
          try {
            const output = await mcpManager.callTool(serverName, toolName, args);
            return { output, isError: false };
          } catch (err) {
            return { output: `MCP error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
          }
        },
      );
    }
  }

  constructor(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    config: AgentConfig,
    approvalManager?: ApprovalManager,
    hooksManager?: HooksManager,
    planManager?: PlanManager,
  ) {
    super();
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.config = config;
    this.approvalManager = approvalManager ?? null;
    this.hooksManager = hooksManager ?? null;
    this.planManager = planManager ?? null;
    this.contextWindow = getContextWindow(config.provider.model);

    // Inject system prompt
    this.messages.push({
      role: 'system',
      content: buildSystemPrompt(config),
    });
  }

  // -------------------------------------------------------------------------
  // Static factory
  // -------------------------------------------------------------------------

  /** Create an Agent and inject project context into the system message. */
  static async create(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    config: AgentConfig,
    approvalManager?: ApprovalManager,
    hooksManager?: HooksManager,
    planManager?: PlanManager,
  ): Promise<Agent> {
    const agent = new Agent(provider, toolRegistry, config, approvalManager, hooksManager, planManager);
    if (config.workingDirectory) {
      const context = await loadProjectContext(config.workingDirectory);
      const contextText = formatContextForPrompt(context);
      if (contextText) {
        const systemMsg = agent.messages[0];
        if (systemMsg && typeof systemMsg.content === 'string') {
          systemMsg.content = contextText + '\n\n' + systemMsg.content;
        }
      }
    }
    return agent;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Send a user message and run the agent loop until a final reply or max iterations. */
  async run(userMessage: string, sessionId?: string): Promise<string> {
    this.messages.push({ role: 'user', content: userMessage });
    await this.hooksManager?.fire('session:start', { sessionId });
    return this.loop(sessionId);
  }

  /** Cancel the currently running loop. */
  cancel(): void {
    this.abortController?.abort();
  }

  /** Return a copy of the current message history. */
  getMessages(): ProviderMessage[] {
    return [...this.messages];
  }

  /** Replace the message history (e.g. when restoring a session). */
  restoreMessages(messages: ProviderMessage[]): void {
    this.messages = [...messages];
  }

  /** Compact old messages to save context window space. Uses LLM summarization if provider available. */
  async compactContextAsync(keepRecent = 12): Promise<string> {
    if (this.messages.length <= keepRecent + 1) {
      return 'Context is already compact.';
    }
    const result = await compactContext(
      this.messages,
      this.contextWindow * 0.5, // target 50% usage after compaction
      estimateMessageTokens,
      this.provider,
    );
    if (result.removedCount === 0) return 'Context is already compact.';
    this.messages = result.messages;
    await this.hooksManager?.fire('context:compacted', {});
    return `Compacted ${result.removedCount} messages; saved ~${result.savedTokens} tokens.`;
  }

  /** Synchronous compact (no LLM) — used for auto-compaction in the loop. */
  compactContext(keepRecent = 12): string {
    if (this.messages.length <= keepRecent + 1) {
      return 'Context is already compact.';
    }
    const system = this.messages[0];
    const old = this.messages.slice(1, -keepRecent);
    const recent = this.messages.slice(-keepRecent);
    const summary = old
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const content = typeof m.content === 'string' ? m.content.slice(0, 200) : '';
        const tools = m.role === 'assistant' && m.tool_calls
          ? ` [${m.tool_calls.map((tc) => tc.function.name).join(', ')}]`
          : '';
        return `• ${m.role}${tools}: ${content}`;
      })
      .join('\n');
    this.messages = [
      system,
      { role: 'system', content: `[Compacted context]\n${summary}` },
      ...recent,
    ];
    return `Compacted ${old.length} messages; kept ${recent.length} recent messages.`;
  }

  // -------------------------------------------------------------------------
  // Core loop
  // -------------------------------------------------------------------------

  private async loop(sessionId?: string): Promise<string> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    try {
      for (let i = 0; i < maxIterations; i++) {
        if (signal.aborted) {
          this.emit('done', 'cancelled', '');
          await this.hooksManager?.fire('agent:cancelled', { sessionId });
          return '';
        }

        this.emit('iteration', i + 1, maxIterations);
        await this.hooksManager?.fire('agent:iteration', { sessionId, extra: { iteration: i + 1, maxIterations } });

        // Auto-compact at 90% context window usage
        const estimatedTokens = estimateTokens(this.messages);
        if (estimatedTokens > this.contextWindow * 0.9) {
          const before = this.messages.length;
          this.compactContext(12);
          const after = this.messages.length;
          this.emit('compacted', before, after);
          await this.hooksManager?.fire('context:compacted', { sessionId, extra: { before, after } });
        }

        this.emit('thinking', i + 1);
        await this.hooksManager?.fire('agent:thinking', { sessionId, extra: { iteration: i + 1 } });

        // Build completion request
        const request = this.buildRequest();

        // Stream the response
        let contentAccum = '';
        let reasoningAccum = '';
        const toolCallsAccum = new Map<string, AccumToolCall>();

        try {
          for await (const chunk of this.provider.stream(request, signal)) {
            if (signal.aborted) break;

            switch (chunk.type) {
              case 'content':
                contentAccum += chunk.delta;
                this.emit('content', chunk.delta);
                break;

              case 'reasoning':
                reasoningAccum += chunk.delta;
                this.emit('reasoning', chunk.delta);
                break;

              case 'tool_call_start':
                toolCallsAccum.set(chunk.id, {
                  id: chunk.id,
                  name: chunk.name,
                  arguments: '',
                });
                break;

              case 'tool_call_delta':
                if (toolCallsAccum.has(chunk.id)) {
                  toolCallsAccum.get(chunk.id)!.arguments += chunk.argumentsDelta;
                }
                break;

              case 'tool_call_end':
                // Nothing extra needed — accumulation is complete
                break;

              case 'cache_stats':
                this.emit('cache_stats', chunk.cacheReadTokens, chunk.cacheCreationTokens);
                break;

              case 'done':
                // Loop will handle finish
                break;
            }
          }
        } catch (err) {
          if (signal.aborted) {
            this.emit('done', 'cancelled', '');
            await this.hooksManager?.fire('agent:cancelled', { sessionId });
            return '';
          }
          throw err;
        }

        if (signal.aborted) {
          this.emit('done', 'cancelled', '');
          await this.hooksManager?.fire('agent:cancelled', { sessionId });
          return '';
        }

        // Build the assistant message
        const toolCalls: ProviderToolCall[] = Array.from(toolCallsAccum.values()).map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));

        const assistantMsg: ProviderMessage = {
          role: 'assistant',
          content: contentAccum || null,
          ...(reasoningAccum ? { reasoning_content: reasoningAccum } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        };
        this.messages.push(assistantMsg);

        // No tool calls → final reply
        if (toolCalls.length === 0) {
          const reply = contentAccum;
          this.emit('reply', reply);
          this.emit('done', 'reply', reply);
          await this.hooksManager?.fire('agent:reply', { sessionId });
          await this.hooksManager?.fire('session:end', { sessionId });
          return reply;
        }

        // Execute tool calls
        for (const tc of toolCalls) {
          if (signal.aborted) break;

          // Sync read-only state from plan manager before each tool execution
          if (this.planManager) {
            this.toolRegistry.setReadOnly(this.planManager.isInPlanMode);
          }

          let parsedArgs: Record<string, unknown>;
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}');
          } catch {
            parsedArgs = {};
          }

          const toolCall: ToolCall = {
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArgs,
          };

          this.emit('tool_start', toolCall);
          await this.hooksManager?.fire('tool:before', { sessionId, toolName: tc.function.name });
          const startedAt = Date.now();

          // Check approval if needed
          if (this.approvalManager) {
            const approved = await this.approvalManager.requestApproval(toolCall, signal);
            if (!approved) {
              const deniedResult: ToolResult = {
                callId: tc.id,
                content: `Tool call denied by user: ${tc.function.name}`,
                isError: true,
              };
              this.emit('tool_end', toolCall, deniedResult, Date.now() - startedAt);
              await this.hooksManager?.fire('tool:denied', { sessionId, toolName: tc.function.name });
              this.messages.push({
                role: 'tool',
                content: deniedResult.content,
                tool_call_id: tc.id,
              });
              continue;
            }
          }

          const result = await this.toolRegistry.execute(tc.function.name, parsedArgs);
          const toolResult: ToolResult = {
            callId: tc.id,
            content: result.output,
            isError: result.isError,
          };

          this.emit('tool_end', toolCall, toolResult, Date.now() - startedAt);
          await this.hooksManager?.fire('tool:after', { sessionId, toolName: tc.function.name });

          this.messages.push({
            role: 'tool',
            content: result.output,
            tool_call_id: tc.id,
          });
        }
      }

      // Max iterations reached
      this.emit('done', 'max_iterations', '[max iterations reached]');
      await this.hooksManager?.fire('agent:max_iterations', { sessionId });
      return '[max iterations reached]';
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      this.emit('done', 'error', error.message);
      await this.hooksManager?.fire('session:error', { sessionId, error: error.message });
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private buildRequest(): CompletionRequest {
    return {
      messages: this.messages,
      tools: this.toolRegistry.getDefinitions(),
      thinking: this.config.thinkingEnabled,
      thinkingEffort: this.config.thinkingEffort,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface AccumToolCall {
  id: string;
  name: string;
  arguments: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT = `You are AiDE, an intelligent coding agent running on the user's desktop.
You can read and write files, execute shell commands, and search code to help with software engineering tasks.
Be direct and concise. Use tools to gather information before answering when needed.
Always prefer targeted edits (file_edit) over full rewrites (file_write) when modifying existing files.
When you have completed a task, summarize what you did in 1-3 sentences.`;

function buildSystemPrompt(_config: AgentConfig): string {
  return DEFAULT_SYSTEM_PROMPT;
}
