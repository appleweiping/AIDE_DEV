import * as readline from 'node:readline';
import type { ApprovalManager } from '@aide/core';

/** One-line summary of a tool call for the terminal. */
export function describeCall(call: { name: string; arguments: Record<string, unknown> }): string {
  const a = call.arguments ?? {};
  const detail = a.command ?? a.path ?? a.pattern ?? a.url ?? '';
  return detail ? `${call.name}(${String(detail).slice(0, 80)})` : call.name;
}

/**
 * Answer the approval manager's requests from the terminal.
 * With no terminal to ask (piped stdin), requests are denied rather than
 * silently allowed; pass --permission trusted to opt out.
 * If `rl` is given (the REPL), its question() is reused.
 */
export function attachApprovalPrompt(approvals: ApprovalManager, rl?: readline.Interface): { close(): void } {
  const own = !rl && process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stderr }) : null;
  const ask = rl ?? own;

  approvals.on('approval_request', (req) => {
    const what = req.command ?? req.filePath ?? '';
    process.stderr.write(`\n\x1b[33m? ${req.toolName}\x1b[0m ${what} \x1b[2m(${req.description})\x1b[0m\n`);
    if (!ask) {
      process.stderr.write('  denied: no terminal to ask (use --permission trusted to allow)\n');
      approvals.respond({ id: req.id, approved: false });
      return;
    }
    ask.question('  allow? [y]es / [a]lways / [N]o ', (answer) => {
      const a = answer.trim().toLowerCase();
      const approved = a === 'y' || a === 'yes' || a === 'a' || a === 'always';
      approvals.respondWithToolName({ id: req.id, approved, remember: a === 'a' || a === 'always' }, req.toolName);
    });
  });

  return { close: () => own?.close() };
}
