/**
 * output-processor.worker.ts 单元测试
 *
 * 通过 Worker 消息协议测试内部处理逻辑：
 * - process 消息处理（JSON/YAML/LOG/TABLE/TEXT 检测与高亮）
 * - configure 消息处理
 * - 未知消息类型返回错误
 * - 大文件保护（> 5000 行跳过高亮）
 * - 错误处理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 模拟 self.postMessage，Worker 文件通过它发送响应
const postedMessages: unknown[] = [];
const originalPostMessage = self.postMessage.bind(self);

beforeEach(() => {
  postedMessages.length = 0;
  vi.spyOn(self, 'postMessage').mockImplementation((msg) => {
    postedMessages.push(msg);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  // 重置 worker 配置（通过发送 configure 消息将 config 恢复默认）
  dispatchWorkerMessage('configure', 'reset-id', {
    foldThreshold: 500,
    enableHighlight: true,
    enableTableFormat: true,
    enableLinkDetection: true,
  });
});

/**
 * 向 Worker 发送消息（通过调用 self.onmessage）
 */
function dispatchWorkerMessage(type: string, id: string, payload: unknown): void {
  const event = new MessageEvent('message', { data: { id, type, payload } });
  // self.onmessage is set when the module is imported
  if (typeof self.onmessage === 'function') {
    (self.onmessage as (e: MessageEvent) => void)(event);
  }
}

/**
 * 获取最后一条 postMessage 响应
 */
function getLastResponse() {
  return postedMessages[postedMessages.length - 1] as {
    id: string;
    type: string;
    payload: unknown;
    error?: string;
  };
}

// 导入 Worker 文件以注册 self.onmessage
// 注意：vitest 环境中 self === window（happy-dom），文件中的 self.onmessage 会被设置
import './output-processor.worker';

describe('output-processor.worker', () => {
  describe('process 消息 — 类型检测', () => {
    it('应识别 JSON 并返回高亮内容', () => {
      dispatchWorkerMessage('process', 'id-1', {
        text: '{"key": "value", "count": 42}',
      });

      const response = getLastResponse();
      expect(response.id).toBe('id-1');
      expect(response.error).toBeUndefined();

      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('json');
      expect(result.content).toContain('\x1b['); // 包含 ANSI 高亮
    });

    it('应识别 YAML 并返回高亮内容', () => {
      dispatchWorkerMessage('process', 'id-2', {
        text: 'name: test\nversion: 1.0\ndescription: hello',
      });

      const response = getLastResponse();
      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('yaml');
      expect(result.content).toContain('\x1b[');
    });

    it('应识别 LOG 并返回高亮内容', () => {
      dispatchWorkerMessage('process', 'id-3', {
        text: '2024-01-15 10:30:00 INFO Server started\n2024-01-15 10:30:01 ERROR Connection failed',
      });

      const response = getLastResponse();
      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('log');
      expect(result.content).toContain('\x1b[');
    });

    it('应识别 TABLE 并返回格式化内容', () => {
      dispatchWorkerMessage('process', 'id-4', {
        text: 'Name    Age    City\nAlice   30     NYC\nBob     25     LA',
      });

      const response = getLastResponse();
      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('table');
      expect(result.content).toContain('\x1b[');
    });

    it('纯文本应返回 TEXT 类型', () => {
      dispatchWorkerMessage('process', 'id-5', {
        text: 'Hello world, this is plain text',
      });

      const response = getLastResponse();
      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('text');
    });

    it('空字符串应返回 TEXT 类型且 lineCount=0', () => {
      dispatchWorkerMessage('process', 'id-6', { text: '' });

      const response = getLastResponse();
      const result = response.payload as {
        type: string;
        content: string;
        metadata: { lineCount: number };
      };
      expect(result.type).toBe('text');
      expect(result.metadata?.lineCount).toBe(0);
    });
  });

  describe('process 消息 — 元数据', () => {
    it('应计算正确的行数', () => {
      dispatchWorkerMessage('process', 'id-meta-1', {
        text: 'line1\nline2\nline3',
      });

      const response = getLastResponse();
      const result = response.payload as { metadata: { lineCount: number } };
      expect(result.metadata?.lineCount).toBe(3);
    });

    it('shouldFold 在行数超过 foldThreshold 时应为 true', () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
      dispatchWorkerMessage('process', 'id-meta-2', {
        text: lines,
        options: { foldThreshold: 5 },
      });

      const response = getLastResponse();
      const result = response.payload as {
        metadata: { shouldFold: boolean; foldThreshold: number };
      };
      expect(result.metadata?.shouldFold).toBe(true);
      expect(result.metadata?.foldThreshold).toBe(5);
    });

    it('shouldFold 在行数未超过 foldThreshold 时应为 false', () => {
      dispatchWorkerMessage('process', 'id-meta-3', {
        text: 'line1\nline2',
        options: { foldThreshold: 10 },
      });

      const response = getLastResponse();
      const result = response.payload as { metadata: { shouldFold: boolean } };
      expect(result.metadata?.shouldFold).toBe(false);
    });

    it('响应 id 应与请求 id 匹配', () => {
      const testId = 'unique-test-id-xyz';
      dispatchWorkerMessage('process', testId, { text: 'hello' });

      const response = getLastResponse();
      expect(response.id).toBe(testId);
    });
  });

  describe('process 消息 — 大文件保护', () => {
    it('超过 5000 行应跳过高亮，返回 TEXT 类型', () => {
      const largeText = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
      dispatchWorkerMessage('process', 'id-large-1', { text: largeText });

      const response = getLastResponse();
      const result = response.payload as { type: string; metadata: { lineCount: number } };
      expect(result.type).toBe('text');
      expect(result.metadata?.lineCount).toBe(5001);
    });

    it('恰好 5000 行不应触发大文件保护', () => {
      const text = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
      dispatchWorkerMessage('process', 'id-large-2', { text });

      const response = getLastResponse();
      const result = response.payload as { metadata: { lineCount: number } };
      expect(result.metadata?.lineCount).toBe(5000);
    });
  });

  describe('process 消息 — options 配置', () => {
    it('enableHighlight=false 时不应返回 ANSI 码', () => {
      dispatchWorkerMessage('process', 'id-opt-1', {
        text: '{"key": "value"}',
        options: { enableHighlight: false },
      });

      const response = getLastResponse();
      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('json');
      expect(result.content).not.toContain('\x1b[');
    });

    it('enableTableFormat=false 时表格不应格式化', () => {
      dispatchWorkerMessage('process', 'id-opt-2', {
        text: 'Name    Age    City\nAlice   30     NYC\nBob     25     LA',
        options: { enableTableFormat: false },
      });

      const response = getLastResponse();
      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('table');
      expect(result.content).not.toContain('\x1b[');
    });

    it('enableLinkDetection=false 时链接不应高亮', () => {
      dispatchWorkerMessage('process', 'id-opt-3', {
        text: 'Visit https://example.com for details',
        options: { enableLinkDetection: false },
      });

      const response = getLastResponse();
      const result = response.payload as { content: string };
      expect(result.content).not.toContain('\x1b[');
    });
  });

  describe('process 消息 — ANSI 码去除', () => {
    it('输入中的 ANSI 码应被去除后再处理', () => {
      dispatchWorkerMessage('process', 'id-ansi-1', {
        text: '\x1b[31mred text\x1b[0m normal',
      });

      const response = getLastResponse();
      const result = response.payload as { content: string };
      // 原始 ANSI 已被去除，若有新高亮码则来自 Worker 自身
      expect(result.content).toContain('red text');
      expect(result.content).toContain('normal');
    });

    it('换行符应被规范化（CRLF → LF）', () => {
      dispatchWorkerMessage('process', 'id-ansi-2', {
        text: 'line1\r\nline2\r\nline3',
      });

      const response = getLastResponse();
      const result = response.payload as { metadata: { lineCount: number } };
      expect(result.metadata?.lineCount).toBe(3);
    });
  });

  describe('configure 消息', () => {
    it('应返回 { ok: true }', () => {
      dispatchWorkerMessage('configure', 'cfg-1', { foldThreshold: 100 });

      const response = getLastResponse();
      expect(response.id).toBe('cfg-1');
      expect(response.type).toBe('configure');
      expect(response.payload).toEqual({ ok: true });
      expect(response.error).toBeUndefined();
    });

    it('configure 后 process 应使用新的 foldThreshold', () => {
      dispatchWorkerMessage('configure', 'cfg-2', { foldThreshold: 2 });
      dispatchWorkerMessage('process', 'proc-1', { text: 'line1\nline2\nline3' });

      const response = getLastResponse();
      const result = response.payload as { metadata: { shouldFold: boolean } };
      expect(result.metadata?.shouldFold).toBe(true);
    });
  });

  describe('未知消息类型', () => {
    it('未知类型应返回 error 字段', () => {
      dispatchWorkerMessage('unknown-action', 'unk-1', {});

      const response = getLastResponse();
      expect(response.id).toBe('unk-1');
      expect(response.error).toBeDefined();
      expect(response.error).toContain('unknown-action');
    });

    it('未知类型的 payload 应为 null', () => {
      dispatchWorkerMessage('do-something-weird', 'unk-2', {});

      const response = getLastResponse();
      expect(response.payload).toBeNull();
    });
  });

  describe('JSON 高亮细节', () => {
    it('应高亮 JSON 键为 cyan+bold', () => {
      dispatchWorkerMessage('process', 'json-1', {
        text: '{"username": "alice"}',
      });

      const response = getLastResponse();
      const result = response.payload as { content: string };
      expect(result.content).toContain('\x1b[36m'); // CYAN
      expect(result.content).toContain('\x1b[1m'); // BOLD
      expect(result.content).toContain('username');
    });

    it('无效 JSON 应回退并返回原始文本（TEXT 类型）', () => {
      dispatchWorkerMessage('process', 'json-2', {
        text: '{invalid json}',
      });

      const response = getLastResponse();
      const result = response.payload as { type: string };
      expect(result.type).toBe('text');
    });

    it('数组 JSON 应被识别', () => {
      dispatchWorkerMessage('process', 'json-3', {
        text: '[{"id":1},{"id":2}]',
      });

      const response = getLastResponse();
      const result = response.payload as { type: string };
      expect(result.type).toBe('json');
    });
  });

  describe('LOG 高亮细节', () => {
    it('ERROR 关键词应高亮为 bright-red', () => {
      dispatchWorkerMessage('process', 'log-1', {
        text: 'ERROR Something went wrong',
      });

      const response = getLastResponse();
      const result = response.payload as { content: string };
      expect(result.content).toContain('\x1b[91m'); // BRIGHT_RED
    });

    it('INFO 关键词应高亮为 bright-cyan', () => {
      dispatchWorkerMessage('process', 'log-2', {
        text: '2024-01-15 INFO server started',
      });

      const response = getLastResponse();
      const result = response.payload as { content: string };
      expect(result.content).toContain('\x1b[96m'); // BRIGHT_CYAN
    });
  });

  describe('链接检测', () => {
    it('HTTP URL 应被高亮', () => {
      dispatchWorkerMessage('process', 'link-1', {
        text: 'Visit https://example.com for details',
      });

      const response = getLastResponse();
      const result = response.payload as { content: string };
      expect(result.content).toContain('https://example.com');
      expect(result.content).toContain('\x1b[34m'); // BLUE
    });
  });

  describe('process 消息 — 回归测试', () => {
    it('Unicode 内容应能正常处理', () => {
      dispatchWorkerMessage('process', 'unicode-1', {
        text: '你好 世界 🌍',
      });

      const response = getLastResponse();
      expect(response.error).toBeUndefined();
      const result = response.payload as { content: string };
      expect(result.content).toContain('你好');
    });

    it('超长单行文本应能处理而不崩溃', () => {
      const longLine = 'x'.repeat(50000);
      dispatchWorkerMessage('process', 'long-1', { text: longLine });

      const response = getLastResponse();
      expect(response.error).toBeUndefined();
    });
  });
});
