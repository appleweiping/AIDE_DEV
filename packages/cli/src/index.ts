#!/usr/bin/env node
import { cac } from 'cac';
import { Agent, ApprovalManager, ProviderRegistry, createDefaultTools } from '@aide/core';
import { APP_NAME, APP_VERSION } from '@aide/shared';
import { startRepl } from './repl.js';
import { attachApprovalPrompt, describeCall } from './approval.js';

const cli = cac(APP_NAME.toLowerCase());

cli
  .command('[message]', 'Run one task, or start the interactive REPL when no message is given')
  .option('-p, --provider <id>', 'Provider: deepseek, qwen, glm, kimi, doubao, minimax, or any id with --base-url')
  .option('-m, --model <model>', 'Model id (defaults to the provider preset)')
  .option('-k, --key <key>', 'API key (or set AIDE_API_KEY)')
  .option('--base-url <url>', 'OpenAI-compatible base URL (or set AIDE_BASE_URL)')
  .option('-d, --dir <dir>', 'Working directory', { default: process.cwd() })
  .option('--permission <mode>', 'safe (ask before writes and risky commands), trusted, or locked', { default: 'safe' })
  .option('--thinking', 'Enable thinking/reasoning mode where the model supports it')
  .action(async (message: string | undefined, options) => {
    const registry = new ProviderRegistry();

    const providerId = options.provider || process.env.AIDE_PROVIDER || 'deepseek';
    const apiKey = options.key || process.env.AIDE_API_KEY;
    const preset = registry.getPreset(providerId);
    const baseUrl = options.baseUrl || process.env.AIDE_BASE_URL || preset?.baseUrl || '';
    const model = options.model || process.env.AIDE_MODEL || preset?.models[0]?.id || '';
    const permission = String(options.permission) as 'safe' | 'trusted' | 'locked';

    if (!apiKey) {
      console.error('No API key. Pass --key or set AIDE_API_KEY.');
      process.exit(1);
    }
    if (!['safe', 'trusted', 'locked'].includes(permission)) {
      console.error(`Unknown --permission ${permission}; use safe, trusted or locked.`);
      process.exit(1);
    }

    const providerConfig = { id: providerId, name: preset?.name ?? providerId, baseUrl, apiKey, model };
    const provider = registry.get(providerConfig);
    const agentConfig = {
      maxIterations: 50,
      thinkingEnabled: options.thinking || false,
      thinkingEffort: 'medium' as const,
      permissionMode: permission,
      workingDirectory: options.dir,
      provider: providerConfig,
    };

    if (!message) {
      await startRepl(provider, agentConfig);
      return;
    }

    const approvals = new ApprovalManager(permission);
    const agent = await Agent.create(provider, createDefaultTools(options.dir), agentConfig, approvals);
    const prompt = attachApprovalPrompt(approvals);

    agent.on('content', (delta: string) => process.stdout.write(delta));
    agent.on('reasoning', (delta: string) => process.stderr.write(`\x1b[2m${delta}\x1b[0m`));
    agent.on('tool_start', (call) => process.stderr.write(`\n\x1b[36m⚙ ${describeCall(call)}\x1b[0m\n`));
    agent.on('tool_end', (call, result, ms) => {
      const first = String(result.content ?? '').split('\n')[0].slice(0, 100);
      process.stderr.write(`  ${result.isError ? '\x1b[31m✗' : '\x1b[32m✓'}\x1b[0m \x1b[2m${first} (${ms} ms)\x1b[0m\n`);
    });

    try {
      await agent.run(message);
      process.stdout.write('\n');
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}`);
      process.exitCode = 1;
    } finally {
      prompt.close();
    }
  });

cli.help();
cli.version(APP_VERSION);
cli.parse();
