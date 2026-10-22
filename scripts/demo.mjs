/**
 * demo.mjs — try the agent without an API key (`pnpm demo` after building).
 *
 * Starts the scripted server from fake-llm.mjs, makes a scratch folder with a
 * one-line bug in greet.js, and drives the real CLI REPL through one turn.
 * The model's replies are canned; the tool calls, the approval prompt, the
 * file edit and the command output are real.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeLLM } from './fake-llm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ws = mkdtempSync(join(tmpdir(), 'aide-demo-'));
writeFileSync(join(ws, 'greet.js'), 'console.log("Helo, world!");\n');
const llm = await startFakeLLM();

// Wait for a pattern in the output, then type a line.
const steps = [
  { waitFor: /❯\s*$/, type: 'fix the typo in greet.js' },
  { waitFor: /allow\? .*$/, type: 'y' },
  { waitFor: /❯\s*$/, type: '/exit' },
];

const child = spawn(
  process.execPath,
  [join(root, 'packages', 'cli', 'dist', 'index.js'), '--provider', 'custom', '--base-url', llm.url, '--model', 'fake-model', '--dir', ws],
  { env: { ...process.env, AIDE_API_KEY: 'sk-demo', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] },
);

let buf = '';
let step = 0;
const timer = setTimeout(() => {
  process.stderr.write('\n[demo] timed out\n');
  child.kill();
}, 60000);

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const onData = (d) => {
  const s = strip(d.toString());
  process.stdout.write(s);
  buf += s;
  const next = steps[step];
  if (next && next.waitFor.test(buf)) {
    step++;
    buf = '';
    process.stdout.write(next.type + '\n'); // stdin is a pipe, so echo what we type
    child.stdin.write(next.type + '\n');
    if (step === steps.length) child.stdin.end();
  }
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);

child.on('close', () => {
  clearTimeout(timer);
  llm.close();
  const result = readFileSync(join(ws, 'greet.js'), 'utf8');
  process.stdout.write(`\n[demo] greet.js now contains: ${result}`);
  rmSync(ws, { recursive: true, force: true });
  if (!result.includes('Hello, world!')) process.exitCode = 1;
});
