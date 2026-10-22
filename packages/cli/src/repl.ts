import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Agent, ApprovalManager, createDefaultTools, globalSlashRegistry, builtinCommands, listMonitors, stopMonitor, handleTodoCommand } from '@aide/core';
import type { LLMProvider } from '@aide/core';
import type { AgentConfig } from '@aide/shared';
import { attachApprovalPrompt, describeCall } from './approval.js';

type ReplMode = 'auto' | 'plan' | 'ask';

// Register built-in slash commands
for (const cmd of builtinCommands) {
  globalSlashRegistry.register(cmd);
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

const SUPPORTED_IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function buildImageBlock(filePath: string): ImageBlock {
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = SUPPORTED_IMAGE_TYPES[ext];
  if (!mediaType) {
    throw new Error(`Unsupported image type: ${ext}. Supported: jpg, png, gif, webp`);
  }
  const data = fs.readFileSync(filePath).toString('base64');
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

// ---------------------------------------------------------------------------
// Plan/ask mode helpers
// ---------------------------------------------------------------------------

function askConfirmation(rl: readline.Interface, question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

// ---------------------------------------------------------------------------
// Monitor slash command handler
// ---------------------------------------------------------------------------

function handleMonitorCommand(args: string): string {
  const parts = args.trim().split(/\s+/);
  const sub = (parts[0] ?? 'list').toLowerCase();
  const rest = parts.slice(1).join(' ');

  switch (sub) {
    case 'stop': {
      if (!rest) return 'Usage: /monitor stop <id>';
      return stopMonitor(rest);
    }
    case 'list': {
      const monitors = listMonitors();
      if (monitors.length === 0) return '\x1b[2mNo active monitors.\x1b[0m';
      const lines = [`\n\x1b[1mMonitors\x1b[0m  \x1b[2m(${monitors.length} active)\x1b[0m`];
      for (const m of monitors as Array<{ id: string; description: string; startedAt: number }>) {
        const elapsed = Math.floor((Date.now() - m.startedAt) / 1000);
        lines.push(`  \x1b[96m${m.id}\x1b[0m  \x1b[92mrunning\x1b[0m  \x1b[2m${elapsed}s\x1b[0m  ${m.description}`);
      }
      return lines.join('\n') + '\n';
    }
    case 'clear': {
      const monitors = listMonitors();
      for (const m of monitors) stopMonitor(m.id);
      return `\x1b[2mCleared ${monitors.length} monitor(s).\x1b[0m`;
    }
    case 'logs': {
      const [id, nStr] = rest.split(/\s+/);
      if (!id) return 'Usage: /monitor logs <id> [n]';
      const n = nStr && /^\d+$/.test(nStr) ? parseInt(nStr, 10) : 20;
      const monitors = listMonitors() as Array<{ id: string; description: string; startedAt: number }>;
      const m = monitors.find((mon) => mon.id.startsWith(id));
      if (!m) return `\x1b[91mNo monitor matching: ${id}\x1b[0m`;
      // Events are streamed live; this shows the description and status
      return `\n\x1b[1mMonitor ${m.id}\x1b[0m  \x1b[2m${m.description}\x1b[0m\n  \x1b[2mEvents stream live to terminal. Last ${n} events not buffered in CLI mode.\x1b[0m\n`;
    }
    default:
      return 'Usage: /monitor <list|stop|clear|logs> [args]\n  Note: use the monitor tool via the agent to start monitors.';
  }
}

// ---------------------------------------------------------------------------
// REPL
// ---------------------------------------------------------------------------

export async function startRepl(provider: LLMProvider, config: AgentConfig): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const options = { dir: config.workingDirectory, permissionMode: config.permissionMode };

  const registry = createDefaultTools(options.dir);
  const approvals = new ApprovalManager(config.permissionMode);
  attachApprovalPrompt(approvals, rl);
  const agent = await Agent.create(provider, registry, config, approvals);

  let afterTool = false; // blank line between tool output and the answer
  agent.on('content', (delta: string) => {
    if (afterTool) process.stdout.write('\n');
    afterTool = false;
    process.stdout.write(delta);
  });
  agent.on('reasoning', (delta: string) => process.stderr.write(`\x1b[2m${delta}\x1b[0m`));
  agent.on('tool_start', (call) => process.stderr.write(`\n\x1b[36m⚙ ${describeCall(call)}\x1b[0m\n`));
  agent.on('tool_end', (_call: unknown, result: { content?: string; isError: boolean }, ms: number) => {
    const first = String(result.content ?? '').split('\n')[0].slice(0, 100);
    process.stderr.write(`  ${result.isError ? '\x1b[31m✗' : '\x1b[32m✓'}\x1b[0m \x1b[2m${first} (${ms} ms)\x1b[0m\n`);
    afterTool = true;
  });
  agent.on('compacted', (before: number, after: number) => {
    process.stderr.write(`\x1b[2m[context compacted: ${before} → ${after} messages]\x1b[0m\n`);
  });
  agent.on('error', (err: Error) => console.error(`\n\x1b[31mError: ${err.message}\x1b[0m`));

  console.log('\x1b[1mAIDE_DEV\x1b[0m  (type \x1b[36m/help\x1b[0m for commands, \x1b[36m/exit\x1b[0m to leave)');
  console.log(`\x1b[2m${config.provider.name} · ${config.provider.model} · ${config.permissionMode} · ${config.workingDirectory}\x1b[0m\n`);

  // Session state
  let replMode: ReplMode = 'auto';
  const pendingImages: string[] = [];

  const prompt = () => {
    const modeTag = replMode !== 'auto' ? ` \x1b[2m[${replMode}]\x1b[0m` : '';
    rl.question(`\x1b[36m❯\x1b[0m${modeTag} `, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { prompt(); return; }

      // ── Slash command handling ──────────────────────────────────────────
      if (trimmed.startsWith('/')) {
        const spaceIdx = trimmed.indexOf(' ');
        const cmdName = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
        const cmdArgs = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

        if (cmdName === 'exit' || cmdName === 'quit') {
          rl.close();
          process.exit(0);
        }

        // ── /todo ──────────────────────────────────────────────────────────
        if (cmdName === 'todo') {
          const out = handleTodoCommand(cmdArgs, options.dir);
          console.log(out);
          prompt();
          return;
        }

        // ── /monitor ───────────────────────────────────────────────────────
        if (cmdName === 'monitor') {
          const out = handleMonitorCommand(cmdArgs);
          console.log(out);
          prompt();
          return;
        }

        // ── /mode ──────────────────────────────────────────────────────────
        if (cmdName === 'mode') {
          const newMode = cmdArgs.trim().toLowerCase() as ReplMode;
          if (!['auto', 'plan', 'ask'].includes(newMode)) {
            console.log('\x1b[91mUsage: /mode auto|plan|ask\x1b[0m');
            console.log(`\x1b[2mCurrent mode: ${replMode}\x1b[0m`);
          } else {
            replMode = newMode;
            approvals.setAskMode(newMode === 'ask');
            const desc: Record<ReplMode, string> = {
              auto: 'ask only before writes and risky commands',
              plan: 'confirm each message before the agent starts',
              ask:  'confirm every tool call',
            };
            console.log(`\x1b[2mMode: \x1b[96m${replMode}\x1b[0m\x1b[2m  ${desc[replMode]}\x1b[0m`);
          }
          prompt();
          return;
        }

        // ── /image ─────────────────────────────────────────────────────────
        if (cmdName === 'image') {
          const imgPath = cmdArgs.trim();
          if (!imgPath) {
            console.log('\x1b[91mUsage: /image <path>\x1b[0m');
          } else if (!fs.existsSync(imgPath)) {
            console.log(`\x1b[91m✗ File not found: ${imgPath}\x1b[0m`);
          } else {
            const ext = path.extname(imgPath).toLowerCase();
            if (!SUPPORTED_IMAGE_TYPES[ext]) {
              console.log(`\x1b[91m✗ Unsupported image type: ${ext}\x1b[0m`);
            } else {
              pendingImages.push(path.resolve(imgPath));
              console.log(`\x1b[92m✓ Image attached:\x1b[0m ${path.basename(imgPath)}  \x1b[2m(${pendingImages.length} pending)\x1b[0m`);
            }
          }
          prompt();
          return;
        }

        // ── /images ────────────────────────────────────────────────────────
        if (cmdName === 'images') {
          if (pendingImages.length === 0) {
            console.log('\x1b[2mNo images attached.\x1b[0m');
          } else {
            console.log(`\n\x1b[1mAttached images\x1b[0m  \x1b[2m(${pendingImages.length})\x1b[0m`);
            pendingImages.forEach((p, i) => console.log(`  \x1b[2m${i + 1}.\x1b[0m ${p}`));
            console.log();
          }
          prompt();
          return;
        }

        // ── Built-in slash registry ────────────────────────────────────────
        const result = await globalSlashRegistry.execute(trimmed, {
          sessionId: undefined,
          workingDirectory: options.dir,
        });

        if (result) {
          if (result.output === '__COMPACT__') {
            const msg = await agent.compactContextAsync();
            console.log(`\x1b[2m${msg}\x1b[0m`);
          } else if (result.output === '__CLEAR__') {
            agent.restoreMessages([]);
            console.log('\x1b[2mContext cleared.\x1b[0m');
          } else if (result.output === '__HELP__') {
            const cmds = globalSlashRegistry.list();
            console.log('\nAvailable commands:');
            for (const cmd of cmds) {
              const aliases = cmd.aliases?.length ? ` (${cmd.aliases.join(', ')})` : '';
              console.log(`  \x1b[36m/${cmd.name}\x1b[0m${aliases}  — ${cmd.description}`);
            }
            // Also list our custom commands
            console.log('  \x1b[36m/todo\x1b[0m  — manage todo list (/todo add|done|start|remove|clear|list)');
            console.log('  \x1b[36m/monitor\x1b[0m  — manage background monitors (/monitor list|stop|clear|logs)');
            console.log('  \x1b[36m/mode\x1b[0m  — switch mode (/mode auto|plan|ask)');
            console.log('  \x1b[36m/image\x1b[0m <path>  — attach image to next message');
            console.log('  \x1b[36m/images\x1b[0m  — list attached images');
            console.log('  \x1b[36m/exit\x1b[0m  — leave (also /quit or Ctrl+D)');
            console.log();
          } else if (result.output.startsWith('__PERMISSIONS_SET__:')) {
            const mode = result.output.split(':')[1] as 'safe' | 'trusted' | 'locked';
            options.permissionMode = mode;
            approvals.setMode(mode);
            console.log(`\x1b[2mPermission mode: ${mode}\x1b[0m`);
          } else if (result.output === '__PERMISSIONS_SHOW__') {
            console.log(`\x1b[2mPermission mode: ${options.permissionMode ?? 'safe'}\x1b[0m`);
          } else if (result.injectAsMessage) {
            process.stdout.write('\n');
            await runWithMode(result.output, replMode, rl, agent, pendingImages);
            process.stdout.write('\n\n');
          } else if (result.isError) {
            console.error(`\x1b[31m${result.output}\x1b[0m`);
          } else {
            console.log(result.output);
          }
        }

        prompt();
        return;
      }

      // ── Regular message ─────────────────────────────────────────────────
      process.stdout.write('\n');
      await runWithMode(trimmed, replMode, rl, agent, pendingImages);
      process.stdout.write('\n\n');
      prompt();
    });
  };

  prompt();
}

// ---------------------------------------------------------------------------
// Mode-aware agent.run()
// ---------------------------------------------------------------------------

async function runWithMode(
  message: string,
  mode: ReplMode,
  rl: readline.Interface,
  agent: InstanceType<typeof Agent>,
  pendingImages: string[],
): Promise<void> {
  // Build message content (with images if any)
  let content: string | Array<{ type: string; [key: string]: unknown }>;
  if (pendingImages.length > 0) {
    const blocks: Array<{ type: string; [key: string]: unknown }> = [];
    for (const imgPath of pendingImages) {
      try {
        blocks.push(buildImageBlock(imgPath) as unknown as { type: string; [key: string]: unknown });
      } catch (err) {
        console.error(`\x1b[31m✗ Image error: ${(err as Error).message}\x1b[0m`);
      }
    }
    blocks.push({ type: 'text', text: message });
    pendingImages.length = 0; // clear
    content = blocks;
  } else {
    content = message;
  }

  if (mode === 'auto') {
    await agent.run(typeof content === 'string' ? content : JSON.stringify(content));
    return;
  }

  if (mode === 'plan') {
    // Confirm the message before the agent starts working on it
    const ok = await askConfirmation(
      rl,
      `  \x1b[2mSend to the agent:\x1b[0m "${message.slice(0, 60)}${message.length > 60 ? '…' : ''}"  \x1b[2m[y/N]\x1b[0m `,
    );
    if (!ok) {
      console.log('\x1b[2mCancelled.\x1b[0m');
      return;
    }
    await agent.run(typeof content === 'string' ? content : JSON.stringify(content));
    return;
  }

  // 'ask' mode: the approval manager is in ask mode and prompts for every tool call.
  await agent.run(typeof content === 'string' ? content : JSON.stringify(content));
}
