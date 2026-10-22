import { useEffect } from 'react';
import { useAgentStore } from '../stores/agent';
import { onCoreEvent, engineError } from '../lib/core';
import { listSessions } from '../lib/api';

/**
 * Feeds engine events into the agent store. Mount once at the app root.
 * Event names and payloads come from core/src/ipc-server.ts.
 */
export function useAgent() {
  useEffect(() => {
    const store = useAgentStore.getState;
    const refreshSessions = () =>
      listSessions()
        .then((s) => store().setSessions(s))
        .catch(() => undefined);
    const system = (content: string) => store().addMessage({ role: 'system', content, timestamp: Date.now() });

    const off = onCoreEvent((event, data) => {
      const s = store();
      switch (event) {
        case 'ready':
          void refreshSessions();
          break;
        case 'agent.content':
          if (!s.streaming.isStreaming) s.startStreaming();
          s.appendContent(data.delta);
          break;
        case 'agent.reasoning':
          if (!s.streaming.isStreaming) s.startStreaming();
          s.appendReasoning(data.delta);
          break;
        case 'agent.tool_start':
          s.startToolActivity(data.call.id, data.call.name, data.call.arguments ?? {});
          break;
        case 'agent.tool_end':
          s.endToolActivity(data.call.id, String(data.result?.content ?? ''), !!data.result?.isError, data.elapsedMs ?? 0);
          break;
        case 'agent.error':
          s.stopStreaming();
          system(`Error: ${data.error}`);
          break;
        case 'agent.done':
          if (s.streaming.isStreaming) s.stopStreaming(data.reason === 'reply' ? data.content : undefined);
          if (data.reason === 'cancelled') system('Stopped.');
          if (data.reason === 'max_iterations') system('Stopped after the maximum number of steps.');
          void refreshSessions();
          break;
        case 'approval_request':
          s.setPendingApproval({
            id: data.id,
            toolName: data.toolName,
            description: data.description,
            command: data.command,
            filePath: data.filePath,
          });
          break;
        case 'sidecar.error':
          system(data.message);
          break;
        case 'sidecar.stopped':
          s.stopStreaming();
          system('The agent engine stopped. Restart the app to continue.');
          break;
      }
    });

    void refreshSessions();
    void engineError().then((msg) => msg && system(msg));
    return off;
  }, []);
}
