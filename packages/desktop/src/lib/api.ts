/** Typed wrappers around the engine methods the UI uses (see core/src/ipc-server.ts). */
import type { Message, ProviderConfig, AgentConfig } from '@aide/shared';
import { PROVIDER_PRESETS } from '@aide/shared';
import { rpc } from './core';
import { useSettingsStore } from '../stores/settings';

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
}

interface SessionRecord {
  id: string;
  title: string;
  workingDirectory: string;
  messages: Message[];
}

function currentConfig(): { provider: ProviderConfig; agent: AgentConfig } {
  const s = useSettingsStore.getState();
  const preset = PROVIDER_PRESETS.find((p) => p.id === s.provider.id);
  const provider: ProviderConfig = {
    id: s.provider.id,
    name: preset?.name ?? s.provider.id,
    baseUrl: s.provider.baseUrl,
    apiKey: s.provider.apiKey,
    model: s.provider.model,
  };
  return {
    provider,
    agent: {
      provider,
      maxIterations: s.maxIterations,
      thinkingEnabled: s.thinkingEnabled,
      thinkingEffort: s.thinkingEffort,
      permissionMode: s.permissionMode,
      workingDirectory: s.workingDirectory,
    },
  };
}

/** Start a turn. Creates a session first when there is none; returns its id. */
export async function sendMessage(message: string, sessionId: string | null): Promise<string> {
  const { provider, agent } = currentConfig();
  if (!provider.apiKey) throw new Error('Add an API key in Settings first.');
  if (!agent.workingDirectory) throw new Error('Choose a project folder in Settings first.');

  let id = sessionId;
  if (!id) {
    const session = await rpc<SessionRecord>('session.create', {
      title: message.slice(0, 48),
      workingDirectory: agent.workingDirectory,
      providerId: provider.id,
      model: provider.model,
    });
    id = session.id;
  }
  await rpc('agent.run', { sessionId: id, message, provider, config: agent });
  return id;
}

export const cancelAgent = () => rpc('agent.cancel');

export const respondApproval = (id: string, approved: boolean, remember: boolean, toolName: string) =>
  rpc('approval.respond', { id, approved, remember, toolName });

export const testProvider = (provider: ProviderConfig) =>
  rpc<{ ok: boolean; error?: string }>('provider.test', { provider });

export async function listSessions(): Promise<SessionSummary[]> {
  const rows = await rpc<Array<{ id: string; title: string; updatedAt: number | string }>>('session.list');
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: new Date(r.updatedAt).getTime() }));
}

/** Messages of a stored session, reduced to what the chat view shows. */
export async function loadSession(id: string): Promise<Message[]> {
  const session = await rpc<SessionRecord>('session.get', { id });
  return session.messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
  );
}

export const deleteSession = (id: string) => rpc('session.delete', { id });
