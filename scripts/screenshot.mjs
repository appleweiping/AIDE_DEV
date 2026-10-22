#!/usr/bin/env node
/**
 * Takes docs/desktop.png: the built desktop UI in headless Chromium, talking to
 * the real engine through scripts/dev-bridge.mjs, with the model replies
 * scripted by scripts/fake-llm.mjs. The file edit and the command output in
 * the picture are real.
 *
 *   pnpm build && pnpm --filter @aide/desktop build
 *   pnpm exec playwright-core install chromium   # once, or set CHROMIUM_PATH
 *   node scripts/screenshot.mjs [out.png]
 *
 * CHROMIUM_PATH can point at any Chromium/Chrome binary instead of the one
 * Playwright downloads. SHOT_APPROVAL=path also saves the approval dialog.
 */
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startFakeLLM } from './fake-llm.mjs';
import { startBridge } from './dev-bridge.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'docs', 'desktop.png');
const dist = join(root, 'packages', 'desktop', 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('packages/desktop/dist is missing; run `pnpm --filter @aide/desktop build` first.');
  process.exit(1);
}

const ws = mkdtempSync(join(tmpdir(), 'aide-shot-'));
writeFileSync(join(ws, 'greet.js'), 'console.log("Helo, world!");\n');
const llm = await startFakeLLM();
const bridge = await startBridge({
  env: { ...process.env, AIDE_SESSIONS_DIR: mkdtempSync(join(tmpdir(), 'aide-shot-sessions-')) },
});

// Serve the built UI on the same port Vite would use.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const web = createServer((req, res) => {
  let p = normalize(join(dist, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(dist + sep) || !existsSync(p) || statSync(p).isDirectory()) p = join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(1420, '127.0.0.1');

const settings = {
  state: {
    provider: { id: 'deepseek', apiKey: 'sk-demo', model: 'deepseek-chat', baseUrl: llm.url },
    maxIterations: 20, thinkingEnabled: false, thinkingEffort: 'medium', permissionMode: 'safe',
    workingDirectory: ws, language: 'en', fontSize: 14,
  },
  version: 0,
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  await page.addInitScript((s) => {
    localStorage.setItem('aide-settings', JSON.stringify(s));
    localStorage.setItem('aide-language', 'en');
  }, settings);
  await page.goto('http://127.0.0.1:1420/');
  await page.waitForTimeout(1000);
  await page.fill('textarea', 'fix the typo in greet.js');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('[aria-labelledby="approval-title"]', { timeout: 30000 });
  await page.waitForTimeout(400);
  if (process.env.SHOT_APPROVAL) await page.screenshot({ path: process.env.SHOT_APPROVAL });
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await page.waitForFunction(() => /now prints/.test(document.body.innerText), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  // Expand the last tool card (the bash call) so its real output is visible.
  const cards = page.locator('button[aria-expanded]');
  await cards.nth((await cards.count()) - 1).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
  console.log('greet.js now contains:', readFileSync(join(ws, 'greet.js'), 'utf8').trim());
} finally {
  await browser.close();
  web.close();
  bridge.close();
  llm.close();
}
process.exit(0);
