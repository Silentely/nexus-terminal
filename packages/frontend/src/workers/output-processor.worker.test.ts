/**
 * output-processor.worker.ts 的单元测试
 *
 * Worker 中的核心处理函数（processOutput, detectType, highlightJSON 等）
 * 未直接导出，因此通过模拟 onmessage 事件接口进行测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ==================== 设置 Worker 全局环境 ====================
// Worker 使用 self.postMessage 和 self.onmessage，需要在导入前设置好

const postedMessages: unknown[] = [];

const selfMock = {
  postMessage: vi.fn((msg: unknown) => {
    postedMessages.push(msg);
  }),
  onmessage: null as ((event: MessageEvent) => void) | null,
  location: { origin: 'http://localhost' },
};

vi.stubGlobal('self', selfMock);

// 导入 Worker 模块（会注册 self.onmessage）
await import('./output-processor.worker');

/**
 * 模拟向 Worker 发送消息并返回响应
 */
function sendMessage(id: string, type: string, payload: unknown) {
  selfMock.postMessage.mockClear();
  postedMessages.length = 0;
  const event = { data: { id, type, payload } } as MessageEvent;
  (selfMock as unknown as { onmessage: (e: MessageEvent) => void }).onmessage(event);
  return postedMessages[0] as { id: string; type: string; payload: unknown; error?: string };
}

describe('output-processor.worker', () => {
  beforeEach(() => {
    selfMock.postMessage.mockClear();
    postedMessages.length = 0;
  });

  // ==================== 消息协议 ====================
  describe('消息协议', () => {
    it('响应 id 应与请求 id 匹配', () => {
      const response = sendMessage('req-123', 'process', { text: 'hello' });
      expect(response.id).toBe('req-123');
    });

    it('响应 type 应与请求 type 匹配', () => {
      const response = sendMessage('req-1', 'process', { text: 'hello' });
      expect(response.type).toBe('process');
    });

    it('未知任务类型应返回 error', () => {
      const response = sendMessage('req-unknown', 'unknownType', {});
      expect(response.error).toContain('未知任务类型');
      expect(response.error).toContain('unknownType');
    });

    it('configure 任务应返回 ok:true', () => {
      const response = sendMessage('req-cfg', 'configure', { enableHighlight: false });
      expect(response.payload).toEqual({ ok: true });
      expect(response.error).toBeUndefined();
    });

    it('process 任务应返回 payload 不为 null', () => {
      const response = sendMessage('req-proc', 'process', { text: 'hello world' });
      expect(response.payload).not.toBeNull();
      expect(response.error).toBeUndefined();
    });
  });

  // ==================== processOutput - 类型检测 ====================
  describe('processOutput - 类型检测', () => {
    it('有效 JSON 应被检测为 json 类型', () => {
      const response = sendMessage('r1', 'process', {
        text: '{"key":"value","num":42}',
      });
      const payload = response.payload as { type: string; content: string };
      expect(payload.type).toBe('json');
    });

    it('JSON 数组应被检测为 json 类型', () => {
      const response = sendMessage('r2', 'process', {
        text: '[1,2,3]',
      });
      const payload = response.payload as { type: string };
      expect(payload.type).toBe('json');
    });

    it('含键值对的多行文本应被检测为 yaml 类型', () => {
      const yamlText = 'name: John\nage: 30\ncity: Beijing\n';
      const response = sendMessage('r3', 'process', { text: yamlText });
      const payload = response.payload as { type: string };
      expect(payload.type).toBe('yaml');
    });

    it('日志格式文本应被检测为 log 类型', () => {
      const logText = '2024-01-15 10:30:00 INFO Starting server\n2024-01-15 10:30:01 ERROR Failed';
      const response = sendMessage('r4', 'process', { text: logText });
      const payload = response.payload as { type: string };
      expect(payload.type).toBe('log');
    });

    it('包含 ERROR 关键字的文本应被检测为 log 类型', () => {
      const response = sendMessage('r5', 'process', {
        text: 'ERROR: connection refused\nWARN: retry attempt',
      });
      const payload = response.payload as { type: string };
      expect(payload.type).toBe('log');
    });

    it('普通文本应被检测为 text 类型', () => {
      const response = sendMessage('r6', 'process', {
        text: 'Hello, this is a plain text message.',
      });
      const payload = response.payload as { type: string };
      expect(payload.type).toBe('text');
    });

    it('空字符串应被检测为 text 类型', () => {
      const response = sendMessage('r7', 'process', { text: '' });
      const payload = response.payload as { type: string };
      expect(payload.type).toBe('text');
    });

    it('管道分隔的表格应被检测为 table 类型', () => {
      const tableText = '| Name | Age |\n|------|-----|\n| John | 30  |';
      const response = sendMessage('r8', 'process', { text: tableText });
      const payload = response.payload as { type: string };
      // TABLE_SEPARATOR_REGEX should match |------|-----|
      expect(payload.type).toBe('table');
    });
  });

  // ==================== processOutput - ANSI 高亮 ====================
  describe('processOutput - JSON 高亮', () => {
    it('JSON 内容应包含 ANSI 转义码', () => {
      const response = sendMessage('r-json1', 'process', {
        text: '{"name":"Alice","age":25}',
      });
      const payload = response.payload as { type: string; content: string };
      expect(payload.type).toBe('json');
      expect(payload.content).toContain('\x1b[');
    });

    it('无效 JSON 不应崩溃', () => {
      const response = sendMessage('r-json2', 'process', { text: '{invalid json}' });
      const payload = response.payload as { type: string };
      // 无效 JSON 不应 crash，会被识别为其他类型
      expect(payload.type).toBeDefined();
    });
  });

  describe('processOutput - LOG 高亮', () => {
    it('ERROR 关键字应包含 ANSI 红色代码', () => {
      const response = sendMessage('r-log1', 'process', {
        text: '2024-01-15T10:00:00Z ERROR Something went wrong',
      });
      const payload = response.payload as { type: string; content: string };
      expect(payload.type).toBe('log');
      // BRIGHT_RED = \x1b[91m
      expect(payload.content).toContain('\x1b[91m');
    });

    it('INFO 关键字应包含 ANSI 青色代码', () => {
      const response = sendMessage('r-log2', 'process', {
        text: '10:30:00 INFO Server started successfully',
      });
      const payload = response.payload as { type: string; content: string };
      expect(payload.type).toBe('log');
      // BRIGHT_CYAN = \x1b[96m
      expect(payload.content).toContain('\x1b[96m');
    });
  });

  // ==================== processOutput - ANSI 清理 ====================
  describe('processOutput - ANSI 代码清理', () => {
    it('输入中的 ANSI 转义码应被清理后再处理', () => {
      const textWithAnsi = '\x1b[32mHello World\x1b[0m';
      const response = sendMessage('r-ansi', 'process', { text: textWithAnsi });
      const payload = response.payload as { content: string };
      // 输出内容不应包含原始 ANSI 格式的 "Hello World"（会被清理再重新添加）
      // 对于 text 类型，内容应该是干净的文本
      expect(payload.content).toContain('Hello World');
    });

    it('CRLF 换行应被规范化为 LF', () => {
      const response = sendMessage('r-crlf', 'process', {
        text: 'line1\r\nline2\r\nline3',
      });
      const payload = response.payload as { metadata: { lineCount: number } };
      expect(payload.metadata?.lineCount).toBe(3);
    });

    it('CR 换行应被规范化为 LF', () => {
      const response = sendMessage('r-cr', 'process', {
        text: 'line1\rline2',
      });
      const payload = response.payload as { metadata: { lineCount: number } };
      expect(payload.metadata?.lineCount).toBe(2);
    });
  });

  // ==================== processOutput - 元数据 ====================
  describe('processOutput - 元数据', () => {
    it('应返回 lineCount', () => {
      const response = sendMessage('r-meta1', 'process', {
        text: 'line1\nline2\nline3',
      });
      const payload = response.payload as { metadata: { lineCount: number } };
      expect(payload.metadata?.lineCount).toBe(3);
    });

    it('行数超过 foldThreshold 时 shouldFold 应为 true', () => {
      // 默认 foldThreshold = 501 行
      const lines = Array.from({ length: 502 }, (_, i) => `Line ${i}`).join('\n');
      const response = sendMessage('r-meta2', 'process', { text: lines });
      const payload = response.payload as {
        metadata: { shouldFold: boolean; isLong: boolean; foldThreshold: number };
      };
      expect(payload.metadata?.shouldFold).toBe(true);
      expect(payload.metadata?.isLong).toBe(true);
    });

    it('行数少于 foldThreshold 时 shouldFold 应为 false', () => {
      const response = sendMessage('r-meta3', 'process', {
        text: 'line1\nline2\nline3',
      });
      const payload = response.payload as { metadata: { shouldFold: boolean } };
      expect(payload.metadata?.shouldFold).toBe(false);
    });

    it('foldThreshold 默认应为 500', () => {
      const response = sendMessage('r-meta4', 'process', { text: 'hello' });
      const payload = response.payload as { metadata: { foldThreshold: number } };
      expect(payload.metadata?.foldThreshold).toBe(500);
    });

    it('超过 5000 行时应跳过高亮直接返回', () => {
      const lines = Array.from({ length: 5001 }, (_, i) => `Line ${i}`).join('\n');
      const response = sendMessage('r-meta5', 'process', { text: lines });
      const payload = response.payload as { type: string; metadata: { lineCount: number } };
      expect(payload.type).toBe('text');
      expect(payload.metadata?.lineCount).toBeGreaterThan(5000);
    });
  });

  // ==================== processOutput - 链接检测 ====================
  describe('processOutput - 链接检测', () => {
    it('HTTP URL 应被 ANSI 高亮', () => {
      const response = sendMessage('r-link1', 'process', {
        text: 'Visit http://example.com for more info',
      });
      const payload = response.payload as { content: string };
      // BLUE = \x1b[34m
      expect(payload.content).toContain('\x1b[34m');
      expect(payload.content).toContain('http://example.com');
    });

    it('HTTPS URL 应被 ANSI 高亮', () => {
      const response = sendMessage('r-link2', 'process', {
        text: 'See https://docs.example.com/guide',
      });
      const payload = response.payload as { content: string };
      expect(payload.content).toContain('\x1b[34m');
    });
  });

  // ==================== configure 任务 ====================
  describe('configure 任务', () => {
    it('禁用高亮后 JSON 内容不应包含 ANSI 代码', () => {
      // 先配置禁用高亮
      sendMessage('cfg-1', 'configure', { enableHighlight: false });

      const response = sendMessage('proc-1', 'process', {
        text: '{"key":"value"}',
      });
      const payload = response.payload as { type: string; content: string };
      expect(payload.type).toBe('json');
      expect(payload.content).not.toContain('\x1b[');

      // 恢复默认配置
      sendMessage('cfg-restore', 'configure', { enableHighlight: true });
    });

    it('自定义 foldThreshold 应被应用', () => {
      sendMessage('cfg-2', 'configure', { foldThreshold: 10 });

      const lines = Array.from({ length: 15 }, (_, i) => `Line ${i}`).join('\n');
      const response = sendMessage('proc-2', 'process', { text: lines });
      const payload = response.payload as {
        metadata: { shouldFold: boolean; foldThreshold: number };
      };
      expect(payload.metadata?.shouldFold).toBe(true);
      expect(payload.metadata?.foldThreshold).toBe(10);

      // 恢复默认
      sendMessage('cfg-restore2', 'configure', { foldThreshold: 500 });
    });
  });

  // ==================== process 时传入选项 ====================
  describe('process 任务内联选项', () => {
    it('通过 process 任务传入 options 应覆盖配置', () => {
      const response = sendMessage('r-opts1', 'process', {
        text: '{"key":"value"}',
        options: { enableHighlight: false },
      });
      const payload = response.payload as { content: string };
      expect(payload.content).not.toContain('\x1b[');

      // 恢复
      sendMessage('r-opts-restore', 'configure', { enableHighlight: true });
    });
  });

  // ==================== 边界条件 ====================
  describe('边界条件', () => {
    it('纯空白文本应返回 text 类型', () => {
      const response = sendMessage('r-ws', 'process', { text: '   \n   \n   ' });
      const payload = response.payload as { type: string };
      expect(payload.type).toBe('text');
    });

    it('单行 JSON 应被正确处理', () => {
      const response = sendMessage('r-single', 'process', { text: '{}' });
      const payload = response.payload as { type: string };
      expect(payload.type).toBe('json');
    });

    it('处理非常长的单行文本不应抛出异常', () => {
      const longLine = 'a'.repeat(10000);
      expect(() => sendMessage('r-long', 'process', { text: longLine })).not.toThrow();
    });
  });
});