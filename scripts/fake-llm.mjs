/**
 * fake-llm.mjs — a scripted OpenAI-compatible /chat/completions server for
 * tests and the demo. No network, no API key. Replies depend on the first
 * user message:
 *
 *   "PING"                    → streams "pong"
 *   "...typo in greet.js..."  → file_read → file_edit → bash → short answer
 *   anything else             → echoes the message back
 *
 * Usage: const llm = await startFakeLLM(); ... llm.url ...; llm.close();
 * Standalone: node scripts/fake-llm.mjs [port]
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function startFakeLLM(port = 0) {
  const requests = [];
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model' }] }));
      return;
    }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push({ headers: req.headers, body: parsed });
      const messages = parsed.messages ?? [];
      const firstUser = String(messages.find((m) => m.role === 'user')?.content ?? '');
      const toolMsgs = messages.filter((m) => m.role === 'tool');

      if (parsed.stream === false) {
        // non-streaming request, e.g. the settings page's connection test
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 1 },
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta, finish = null) =>
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      const end = () => {
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 40 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      };
      const text = (s) => {
        for (const piece of s.match(/[\s\S]{1,12}/g) ?? [s]) send({ content: piece });
        send({}, 'stop');
        end();
      };
      const call = (id, name, args) => {
        const json = JSON.stringify(args);
        const cut = Math.floor(json.length / 2);
        // split the arguments across two chunks, like real providers do
        send({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: json.slice(0, cut) } }] });
        send({ tool_calls: [{ index: 0, function: { arguments: json.slice(cut) } }] });
        send({}, 'tool_calls');
        end();
      };

      if (/typo in greet\.js/i.test(firstUser)) {
        const step = toolMsgs.length;
        if (step === 0) {
          send({ role: 'assistant', reasoning_content: 'Read the file before editing it.' });
          return call('call_1', 'file_read', { path: 'greet.js' });
        }
        if (step === 1) return call('call_2', 'file_edit', { path: 'greet.js', old_string: 'Helo', new_string: 'Hello' });
        if (step === 2) return call('call_3', 'bash', { command: 'node greet.js' });
        const ran = /Hello, world!/.test(String(toolMsgs[2]?.content ?? ''));
        return text(
          ran
            ? 'Fixed the typo in greet.js ("Helo" → "Hello"); `node greet.js` now prints "Hello, world!".'
            : 'I edited greet.js, but running it did not print the expected line.',
        );
      }
      if (/PING/.test(firstUser)) return text('pong');
      return text(`echo: ${firstUser.slice(0, 60)}`);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({ url: `http://127.0.0.1:${p}/v1`, requests, close: () => server.close() });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  startFakeLLM(Number(process.argv[2] ?? 0)).then(({ url }) => console.log(`fake LLM at ${url}`));
}
