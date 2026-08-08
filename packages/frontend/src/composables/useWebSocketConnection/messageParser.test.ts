import { describe, expect, it } from 'vitest';
import { parseWebSocketMessage } from './messageParser';

describe('parseWebSocketMessage', () => {
  it('应保留批量任务的 completed 与 failed 终态事件', () => {
    for (const type of ['batch:completed', 'batch:failed'] as const) {
      const message = parseWebSocketMessage(
        JSON.stringify({
          type,
          payload: {
            taskId: 'task-1',
            status: type === 'batch:completed' ? 'completed' : 'failed',
          },
        }),
      );

      expect(message?.type).toBe(type);
    }
  });
});
