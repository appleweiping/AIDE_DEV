export { ToolRegistry, toolRegistry } from './registry.js';
export type { ToolResult, ToolHandler, RegisteredTool } from './registry.js';
export { fileReadTool } from './file-read.js';
export { fileWriteTool } from './file-write.js';
export { fileEditTool } from './file-edit.js';
export { bashTool } from './bash.js';
export { globTool } from './glob.js';
export { grepTool } from './grep.js';
export { webSearchTool } from './web-search.js';
export { webFetchTool } from './web-fetch.js';
export { notebookEditTool } from './notebook-edit.js';
export { monitorTool } from './monitor.js';
export { powershellTool } from './powershell.js';
export { nodeReplTool } from './node-repl.js';
export { createEnterPlanModeTool } from './enter-plan-mode.js';
export { createExitPlanModeTool } from './exit-plan-mode.js';
export { handleTodoCommand, todoAdd, todoList, todoDone, todoStart, todoRemove, todoClear, formatTodoList, setTodoStorePath } from './todo.js';
export type { TodoItem, TodoStatus, TodoPriority } from './todo.js';

import { ToolRegistry, toolRegistry } from './registry.js';
import { fileReadTool } from './file-read.js';
import { fileWriteTool } from './file-write.js';
import { fileEditTool } from './file-edit.js';
import { bashTool } from './bash.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { webSearchTool } from './web-search.js';
import { webFetchTool } from './web-fetch.js';
import { notebookEditTool } from './notebook-edit.js';
import { monitorTool } from './monitor.js';
import { powershellTool } from './powershell.js';
import { nodeReplTool } from './node-repl.js';
import { createEnterPlanModeTool } from './enter-plan-mode.js';
import { createExitPlanModeTool } from './exit-plan-mode.js';
import { setWorkingDirectory } from './path-guard.js';
import type { RegisteredTool, ToolResult } from './registry.js';
import type { PlanManager } from '../plan/manager.js';

function wrapTool(tool: { definition: any; execute: (...args: any[]) => Promise<string> }): RegisteredTool {
  return {
    definition: tool.definition,
    handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const output = await tool.execute(args);
        return { output, isError: false };
      } catch (err) {
        return { output: `Error: ${(err as Error).message}`, isError: true };
      }
    },
  };
}

function wrapPlanTool(tool: { name: string; description: string; parameters: Record<string, unknown>; execute: (args: Record<string, unknown>) => Promise<ToolResult> }): RegisteredTool {
  return {
    definition: { name: tool.name, description: tool.description, parameters: tool.parameters },
    handler: tool.execute.bind(tool),
  };
}

export function registerBuiltinTools(planManager?: PlanManager): void {
  toolRegistry.registerTool(fileReadTool);
  toolRegistry.registerTool(fileWriteTool);
  toolRegistry.registerTool(fileEditTool);
  toolRegistry.registerTool(bashTool);
  toolRegistry.registerTool(globTool);
  toolRegistry.registerTool(grepTool);
  toolRegistry.registerTool(wrapTool(webSearchTool));
  toolRegistry.registerTool(wrapTool(webFetchTool));
  toolRegistry.registerTool(wrapTool(notebookEditTool));
  toolRegistry.registerTool(wrapTool(monitorTool));
  if (process.platform === 'win32') {
    toolRegistry.registerTool(wrapTool(powershellTool));
  }
  toolRegistry.registerTool(wrapTool(nodeReplTool));
  if (planManager) {
    toolRegistry.registerTool(wrapPlanTool(createEnterPlanModeTool(planManager)));
    toolRegistry.registerTool(wrapPlanTool(createExitPlanModeTool(planManager)));
  }
}

export function createDefaultTools(workingDirectory: string, planManager?: PlanManager): ToolRegistry {
  const registry = new ToolRegistry();
  // Set the working directory for path-guard (affects file write validation)
  setWorkingDirectory(workingDirectory);
  registry.registerTool(fileReadTool);
  registry.registerTool(fileWriteTool);
  registry.registerTool(fileEditTool);
  registry.registerTool(bashTool);
  registry.registerTool(globTool);
  registry.registerTool(grepTool);
  registry.registerTool(wrapTool(webSearchTool));
  registry.registerTool(wrapTool(webFetchTool));
  registry.registerTool(wrapTool(notebookEditTool));
  registry.registerTool(wrapTool(monitorTool));
  if (process.platform === 'win32') {
    registry.registerTool(wrapTool(powershellTool));
  }
  registry.registerTool(wrapTool(nodeReplTool));
  if (planManager) {
    registry.registerTool(wrapPlanTool(createEnterPlanModeTool(planManager)));
    registry.registerTool(wrapPlanTool(createExitPlanModeTool(planManager)));
  }
  return registry;
}
