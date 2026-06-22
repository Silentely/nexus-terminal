import { describe, it, expect, vi, beforeEach } from 'vitest';

// 使用 vi.hoisted 确保 mock 变量在 vi.mock 之前可用
const { mockSessionsMap } = vi.hoisted(() => ({
  mockSessionsMap: new Map(),
}));

vi.mock('@/utils/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../state', () => ({
  sessions: {
    get value() {
      return mockSessionsMap;
    },
  },
}));

import { updateSessionCommandInput } from './commandInputActions';
import { log } from '@/utils/log';

interface MockSession {
  sessionId: string;
  commandInputContent: { value: string };
  [key: string]: unknown;
}

const createMockSession = (sessionId: string): MockSession => ({
  sessionId,
  commandInputContent: { value: '' },
});

describe('session/actions/commandInputActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionsMap.clear();
  });

  describe('updateSessionCommandInput', () => {
    it('应该更新指定会话的命令输入内容', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      updateSessionCommandInput('s1', 'ls -la');

      expect(session.commandInputContent.value).toBe('ls -la');
    });

    it('应该支持更新为空字符串', () => {
      const session = createMockSession('s1');
      session.commandInputContent.value = '旧内容';
      mockSessionsMap.set('s1', session);

      updateSessionCommandInput('s1', '');

      expect(session.commandInputContent.value).toBe('');
    });

    it('多次调用应覆盖之前的值', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      updateSessionCommandInput('s1', '第一次');
      updateSessionCommandInput('s1', '第二次');
      updateSessionCommandInput('s1', '第三次');

      expect(session.commandInputContent.value).toBe('第三次');
    });

    it('不存在的会话应输出警告日志', () => {
      updateSessionCommandInput('nonexistent', 'test');

      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('尝试更新不存在的会话 nonexistent 的命令输入内容'),
      );
    });

    it('不存在的会话不应抛出异常', () => {
      expect(() => updateSessionCommandInput('nonexistent', 'test')).not.toThrow();
    });

    it('应该支持特殊字符', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      updateSessionCommandInput('s1', 'echo "hello world" && ls | grep .ts');

      expect(session.commandInputContent.value).toBe('echo "hello world" && ls | grep .ts');
    });

    it('应该支持多字节字符', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      updateSessionCommandInput('s1', '你好世界');

      expect(session.commandInputContent.value).toBe('你好世界');
    });

    it('多个会话应独立维护命令输入', () => {
      const session1 = createMockSession('s1');
      const session2 = createMockSession('s2');
      mockSessionsMap.set('s1', session1);
      mockSessionsMap.set('s2', session2);

      updateSessionCommandInput('s1', '命令A');
      updateSessionCommandInput('s2', '命令B');

      expect(session1.commandInputContent.value).toBe('命令A');
      expect(session2.commandInputContent.value).toBe('命令B');
    });
  });
});
