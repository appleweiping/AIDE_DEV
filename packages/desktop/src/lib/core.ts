/**
 * Talks to the agent engine (packages/core) over JSON-RPC.
 *
 * In the desktop app the Rust shell owns the engine process: requests go
 * through the `rpc` command and everything the engine prints arrives on the
 * `core` event. In a plain browser (`pnpm dev:browser`) the same messages go
 * through scripts/dev-bridge.mjs over HTTP + server-sent events, so the UI can
 * be developed and screenshotted without building Rust.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface CoreMessage {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  event?: string;
  data?: unknown;
}

type EventHandler = (event: string, data: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const BRIDGE = (import.meta.env.VITE_AIDE_BRIDGE as string | undefined) ?? 'http://127.0.0.1:1421';

let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const handlers = new Set<EventHandler>();
let connected: Promise<void> | null = null;

function dispatch(msg: CoreMessage) {
  if (typeof msg.id === 'number' && pending.has(msg.id)) {
    const p = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
    return;
  }
  if (msg.event) for (const h of handlers) h(msg.event, msg.data);
}

function connect(): Promise<void> {
  if (connected) return connected;
  connected = inTauri
    ? listen<CoreMessage>('core', (e) => dispatch(e.payload)).then(() => undefined)
    : new Promise<void>((resolve) => {
        const source = new EventSource(`${BRIDGE}/events`);
        source.onmessage = (e) => dispatch(JSON.parse(e.data) as CoreMessage);
        source.onopen = () => resolve();
        source.onerror = () => resolve(); // requests will fail and say so
      });
  return connected;
}

/** Subscribe to engine events (agent.content, approval_request, ...). */
export function onCoreEvent(handler: EventHandler): () => void {
  handlers.add(handler);
  void connect();
  return () => handlers.delete(handler);
}

/** Call an engine method and wait for its result. */
export async function rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
  await connect();
  const id = nextId++;
  const result = new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
  });
  try {
    if (inTauri) {
      await invoke('rpc', { id, method, params: params ?? null });
    } else {
      const res = await fetch(`${BRIDGE}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? null }),
      });
      if (!res.ok) throw new Error(`bridge returned HTTP ${res.status}`);
    }
  } catch (err) {
    pending.delete(id);
    throw err instanceof Error ? err : new Error(String(err));
  }
  return result;
}

/** Why the engine is not running, if it is not (desktop only). */
export async function engineError(): Promise<string | null> {
  if (!inTauri) return null;
  return invoke<string | null>('engine_error');
}
