import { watch, type Ref } from 'vue';
import type { Terminal } from 'xterm';
import { useWorkspaceEventEmitter } from '../../composables/workspaceEvents';

export function useTerminalSocket(
  terminal: Ref<Terminal | null>,
  sessionId: string,
  stream: Ref<ReadableStream<string> | undefined>
) {
  const emitWorkspaceEvent = useWorkspaceEventEmitter();

  // Handle Input (Terminal -> EventBus -> Socket)
  const setupInputHandler = () => {
    if (terminal.value) {
      terminal.value.onData((data) => {
        emitWorkspaceEvent('terminal:input', { sessionId, data });
      });
    }
  };

  // Handle Output (Stream -> Terminal)
  watch(stream, async (newStream) => {
    if (newStream) {
      const reader = newStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (terminal.value && value) {
            terminal.value.write(value);
          }
        }
      } catch (error) {
        console.error('Error reading terminal stream:', error);
      } finally {
        reader.releaseLock();
      }
    }
  }, { immediate: true });

  return {
    setupInputHandler
  };
}
