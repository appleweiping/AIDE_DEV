// Provider
export type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  ProviderMessage,
  ProviderToolCall,
  TokenUsage,
  ProviderFactory,
} from './provider/types.js';
export { OpenAICompatProvider } from './provider/openai-compat.js';
export { ProviderRegistry, providerRegistry } from './provider/registry.js';

// Tools
export { ToolRegistry, toolRegistry, registerBuiltinTools, createDefaultTools } from './tools/index.js';
export type { ToolResult, ToolHandler, RegisteredTool } from './tools/registry.js';
export { fileReadTool } from './tools/file-read.js';
export { fileWriteTool } from './tools/file-write.js';
export { fileEditTool } from './tools/file-edit.js';
export { bashTool } from './tools/bash.js';
export { globTool } from './tools/glob.js';
export { grepTool } from './tools/grep.js';

// Agent
export { Agent } from './agent.js';
export type { AgentEvents } from './agent.js';

// Hooks
export { HooksManager, globalHooksManager } from './hooks/manager.js';
export type { HookEvent, HookDefinition, HookContext } from './hooks/manager.js';

// Context Loader
export { loadProjectContext, formatContextForPrompt } from './context-loader.js';
export type { LoadedContext, ContextFile } from './context-loader.js';

// Safety
export { ApprovalManager, classifyCommand } from './safety/approval.js';
export type { RiskLevel, RiskAssessment } from './safety/approval.js';
export { FileSandbox } from './safety/sandbox.js';

// Session
export { SessionManager } from './session/manager.js';

// IPC Server
export { IpcServer, startIpcServer } from './ipc-server.js';

// Git
export { GitOperations, WorktreeManager } from './git/operations.js';

// Plan & Task
export { PlanManager } from './plan/manager.js';
export type { Plan, PlanStep, PlanPhase } from './plan/manager.js';
export { TaskManager } from './task/manager.js';
export type { TaskItem } from './task/manager.js';

// Extra Tools
export { webSearchTool } from './tools/web-search.js';
export { webFetchTool } from './tools/web-fetch.js';
export { notebookEditTool } from './tools/notebook-edit.js';
export { monitorTool, stopMonitor, listMonitors } from './tools/monitor.js';
export { powershellTool } from './tools/powershell.js';
export { nodeReplTool } from './tools/node-repl.js';
export { handleTodoCommand, todoAdd, todoList, todoDone, todoStart, todoRemove, todoClear, formatTodoList, setTodoStorePath } from './tools/todo.js';
export type { TodoItem, TodoStatus, TodoPriority } from './tools/todo.js';

// MCP
export { McpClient } from './mcp/client.js';
export type { McpServerConfig, McpTool } from './mcp/client.js';
export { McpManager } from './mcp/manager.js';
export type { McpServerStatus } from './mcp/manager.js';

// Notifications
export { NotificationManager } from './notification/manager.js';
export type { Notification } from './notification/manager.js';

// Context Compaction
export { compactContext, estimateTokenCount, estimateMessageTokens } from './session/compaction.js';

// Sub-Agent
export { SubAgentManager, SharedContext } from './agent/sub-agent.js';
export type {
  SubAgentConfig,
  SubAgentResult,
  SubAgentManagerEvents,
} from './agent/sub-agent.js';


// Slash Commands
export { SlashCommandRegistry, globalSlashRegistry } from './slash-commands/registry.js';
export type {
  SlashCommandDefinition,
  SlashCommandContext,
  SlashCommandResult,
  SlashCommandHandler,
  SlashCommandRegistryEvents,
} from './slash-commands/registry.js';
export { builtinCommands } from './slash-commands/builtins.js';
