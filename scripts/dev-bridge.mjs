/**
 * dev-bridge.mjs — run the desktop UI in a normal browser, without Rust.
 *
 * Starts the bundled engine (packages/core/dist-sidecar/aide-core.mjs) the way
 * the Tauri shell does and relays it over HTTP on 127.0.0.1:1421:
 *   GET  /events  server-sent events, one per line the engine prints
 *   POST /rpc     one JSON-RPC request, written to the engine's stdin
 *
 *   pnpm build && node scripts/dev-bridge.mjs
 *   pnpm --filter @aide/desktop dev      # then open http://localhost:1420
 *
 * Only listens on loopback. Set AIDE_SESSIONS_DIR to keep test sessions apart.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.AIDE_BRIDGE_PORT ?? 1421);

export function startBridge({ port: p = port, env = process.env } = {}) {
  const engine = spawn(process.execPath, [join(root, 'packages', 'core', 'dist-sidecar', 'aide-core.mjs')], {
    env,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const clients = new Set();
  const backlog = []; // events printed before the page connected (e.g. "ready")

  createInterface({ input: engine.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    if (clients.size === 0) backlog.push(line);
    for (const res of clients) res.write(`data: ${line}\n\n`);
  });

  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': connected\n\n');
      for (const line of backlog.splice(0)) res.write(`data: ${line}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && req.url === '/rpc') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        engine.stdin.write(body.replace(/\n/g, ' ') + '\n');
        res.writeHead(202, cors);
        res.end();
      });
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(p, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${p}`,
        close() {
          server.close();
          engine.kill();
        },
      }),
    );
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url } = await startBridge();
  console.log(`engine bridge on ${url} (Ctrl+C to stop)`);
}
