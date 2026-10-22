import type { SlashCommandDefinition } from './registry.js';

// ---------------------------------------------------------------------------
// Built-in slash commands
// ---------------------------------------------------------------------------

export const helpCommand: SlashCommandDefinition = {
  name: 'help',
  aliases: ['h', '?'],
  description: 'List all available slash commands',
  usage: '/help [command]',
  async handler({ args, rawInput }) {
    return {
      output: '__HELP__', // IPC server resolves this to the full command list
      isError: false,
      injectAsMessage: false,
    };
  },
};

export const clearCommand: SlashCommandDefinition = {
  name: 'clear',
  aliases: ['cls'],
  description: 'Clear the current session messages',
  usage: '/clear',
  async handler(_ctx) {
    return { output: '__CLEAR__', isError: false };
  },
};

export const modelCommand: SlashCommandDefinition = {
  name: 'model',
  description: 'Show or switch the current model',
  usage: '/model [model-id]',
  async handler({ args }) {
    if (!args) return { output: '__MODEL_SHOW__', isError: false };
    return { output: `__MODEL_SET__:${args}`, isError: false };
  },
};

export const permissionsCommand: SlashCommandDefinition = {
  name: 'permissions',
  aliases: ['perm'],
  description: 'Show or change the permission mode (safe/trusted/locked)',
  usage: '/permissions [safe|trusted|locked]',
  async handler({ args }) {
    if (!args) return { output: '__PERMISSIONS_SHOW__', isError: false };
    const valid = ['safe', 'trusted', 'locked'];
    if (!valid.includes(args)) {
      return { output: `Invalid mode "${args}". Use: safe, trusted, or locked.`, isError: true };
    }
    return { output: `__PERMISSIONS_SET__:${args}`, isError: false };
  },
};

export const reviewCommand: SlashCommandDefinition = {
  name: 'review',
  description: 'Review git changes (branch diff, uncommitted, or a specific commit)',
  usage: '/review [branch|commit|--staged]',
  async handler({ args }) {
    const target = args || '--staged';
    return {
      output: `Please review the following git changes: ${target}. Summarize what changed, identify potential issues, and suggest improvements.`,
      isError: false,
      injectAsMessage: true,
    };
  },
};

export const forkCommand: SlashCommandDefinition = {
  name: 'fork',
  description: 'Fork the current session to create a branch point',
  usage: '/fork [title]',
  async handler({ args }) {
    return { output: `__FORK__:${args || ''}`, isError: false };
  },
};

export const compactCommand: SlashCommandDefinition = {
  name: 'compact',
  description: 'Manually compact the conversation context',
  usage: '/compact',
  async handler(_ctx) {
    return { output: '__COMPACT__', isError: false };
  },
};

export const planCommand: SlashCommandDefinition = {
  name: 'plan',
  description: 'Enter plan mode (read-only exploration before making changes)',
  usage: '/plan [title]',
  async handler({ args }) {
    const title = args || 'New Plan';
    return {
      output: `Enter plan mode with title: "${title}". Explore the codebase and design a solution. Use exit_plan_mode when ready to implement.`,
      isError: false,
      injectAsMessage: true,
    };
  },
};

export const statusCommand: SlashCommandDefinition = {
  name: 'status',
  description: 'Show git status and current session info',
  usage: '/status',
  async handler(_ctx) {
    return {
      output: 'Show the current git status, active branch, and a summary of recent changes.',
      isError: false,
      injectAsMessage: true,
    };
  },
};

export const searchCommand: SlashCommandDefinition = {
  name: 'search',
  aliases: ['find'],
  description: 'Search the codebase for a pattern',
  usage: '/search <pattern>',
  async handler({ args }) {
    if (!args) return { output: 'Usage: /search <pattern>', isError: true };
    return {
      output: `Search the codebase for: ${args}. Show all matching files and relevant lines.`,
      isError: false,
      injectAsMessage: true,
    };
  },
};

export const builtinCommands: SlashCommandDefinition[] = [
  helpCommand,
  clearCommand,
  modelCommand,
  permissionsCommand,
  reviewCommand,
  forkCommand,
  compactCommand,
  planCommand,
  statusCommand,
  searchCommand,
];
