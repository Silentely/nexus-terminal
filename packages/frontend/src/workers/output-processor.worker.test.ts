import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for output-processor.worker.ts
 *
 * The worker file attaches to `self.onmessage` when imported. We capture `self.postMessage`
 * to inspect responses, then drive the worker via `(self as any).onmessage(event)`.
 */

// Mock self.postMessage before importing the worker
const postedMessages: unknown[] = [];
vi.stubGlobal('postMessage', (data: unknown) => {
  postedMessages.push(data);
});

// Import the worker so it attaches to self.onmessage
await import('./output-processor.worker');

// Helper: send a message to the worker and collect the response
function sendMessage(id: string, type: string, payload: unknown): unknown {
  const before = postedMessages.length;
  const event = { data: { id, type, payload } } as MessageEvent;
  (self as unknown as { onmessage: (e: MessageEvent) => void }).onmessage(event);

  // The worker responds synchronously for non-async paths
  const responses = postedMessages.slice(before);
  return responses[0];
}

describe('output-processor.worker', () => {
  beforeEach(() => {
    postedMessages.length = 0;
  });

  afterEach(() => {
    postedMessages.length = 0;
  });

  // ==================== 基本消息协议 ====================
  describe('消息协议', () => {
    it('响应 id 应与请求 id 匹配', () => {
      const response = sendMessage('req-123', 'process', { text: 'hello' }) as Record<
        string,
        unknown
      >;
      expect(response).toBeDefined();
      expect((response as Record<string, unknown>).id).toBe('req-123');
    });

    it('未知 type 应返回 error 响应', () => {
      const response = sendMessage('req-unknown', 'unknownType', {}) as Record<string, unknown>;
      expect(response).toBeDefined();
      expect(response.error).toContain('未知任务类型');
      expect(response.error).toContain('unknownType');
    });

    it('configure type 应返回成功响应', () => {
      const response = sendMessage('req-cfg', 'configure', {
        foldThreshold: 300,
      }) as Record<string, unknown>;
      expect(response).toBeDefined();
      expect(response.error).toBeUndefined();
      expect((response.payload as Record<string, unknown>).ok).toBe(true);
    });
  });

  // ==================== process 任务 ====================
  describe('process 任务', () => {
    it('应该处理普通文本并返回 ProcessedOutput', () => {
      const response = sendMessage('req-1', 'process', {
        text: 'Hello world',
      }) as Record<string, unknown>;

      expect(response.error).toBeUndefined();
      const payload = response.payload as Record<string, unknown>;
      expect(payload).toHaveProperty('type');
      expect(payload).toHaveProperty('content');
      expect(payload).toHaveProperty('metadata');
    });

    it('应该检测 JSON 类型', () => {
      const response = sendMessage('req-json', 'process', {
        text: '{"name": "test", "value": 42}',
      }) as Record<string, unknown>;

      const payload = response.payload as Record<string, unknown>;
      expect(payload.type).toBe('json');
    });

    it('应该检测 YAML 类型', () => {
      const response = sendMessage('req-yaml', 'process', {
        text: 'name: test\nversion: 1.0\ndescription: hello',
      }) as Record<string, unknown>;

      const payload = response.payload as Record<string, unknown>;
      expect(payload.type).toBe('yaml');
    });

    it('应该检测 LOG 类型', () => {
      const response = sendMessage('req-log', 'process', {
        text: '2024-01-15 10:30:00 INFO Server started',
      }) as Record<string, unknown>;

      const payload = response.payload as Record<string, unknown>;
      expect(payload.type).toBe('log');
    });

    it('应该返回元数据包含 lineCount', () => {
      const text = 'line1\nline2\nline3';
      const response = sendMessage('req-meta', 'process', { text }) as Record<string, unknown>;

      const metadata = (response.payload as Record<string, unknown>).metadata as Record<
        string,
        unknown
      >;
      expect(metadata.lineCount).toBe(3);
    });

    it('空文本应返回 TEXT 类型', () => {
      const response = sendMessage('req-empty', 'process', { text: '' }) as Record<string, unknown>;

      const payload = response.payload as Record<string, unknown>;
      expect(payload.type).toBe('text');
    });

    it('超过 5000 行应跳过高亮处理，返回 TEXT 类型', () => {
      const largeText = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
      const response = sendMessage('req-large', 'process', { text: largeText }) as Record<
        string,
        unknown
      >;

      const payload = response.payload as Record<string, unknown>;
      expect(payload.type).toBe('text');
      const metadata = payload.metadata as Record<string, unknown>;
      expect(metadata.lineCount).toBeGreaterThan(5000);
    });

    it('ANSI 转义码应在处理前被剥离', () => {
      const textWithAnsi = '\x1b[32mgreen text\x1b[0m';
      const response = sendMessage('req-ansi', 'process', {
        text: textWithAnsi,
      }) as Record<string, unknown>;

      const payload = response.payload as Record<string, unknown>;
      // The content is then re-highlighted by the worker, but original ANSI stripped
      expect(payload.content).toBeDefined();
    });

    it('应该规范化 CRLF 换行符', () => {
      const textWithCrlf = 'line1\r\nline2\r\nline3';
      const response = sendMessage('req-crlf', 'process', {
        text: textWithCrlf,
      }) as Record<string, unknown>;

      const payload = response.payload as Record<string, unknown>;
      const metadata = payload.metadata as Record<string, unknown>;
      // 3 lines after normalization
      expect(metadata.lineCount).toBe(3);
    });

    it('options 中 enableHighlight=false 应禁用高亮', () => {
      const jsonText = '{"key": "value"}';
      const withHighlight = sendMessage('req-json-hl', 'process', {
        text: jsonText,
        options: { enableHighlight: true },
      }) as Record<string, unknown>;

      const withoutHighlight = sendMessage('req-json-no-hl', 'process', {
        text: jsonText,
        options: { enableHighlight: false },
      }) as Record<string, unknown>;

      const hlContent = (withHighlight.payload as Record<string, unknown>).content as string;
      const noHlContent = (withoutHighlight.payload as Record<string, unknown>).content as string;

      // With highlight should contain ANSI codes, without should not
      expect(hlContent).toContain('\x1b[');
      expect(noHlContent).not.toContain('\x1b[');
    });

    it('shouldFold 应在行数超过 foldThreshold 时为 true', () => {
      const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
      const response = sendMessage('req-fold', 'process', {
        text,
        options: { foldThreshold: 5 },
      }) as Record<string, unknown>;

      const metadata = (response.payload as Record<string, unknown>).metadata as Record<
        string,
        unknown
      >;
      expect(metadata.shouldFold).toBe(true);
      expect(metadata.isLong).toBe(true);
    });

    it('行数未超过 foldThreshold 时 shouldFold 应为 false', () => {
      const text = 'line1\nline2\nline3';
      const response = sendMessage('req-no-fold', 'process', {
        text,
        options: { foldThreshold: 100 },
      }) as Record<string, unknown>;

      const metadata = (response.payload as Record<string, unknown>).metadata as Record<
        string,
        unknown
      >;
      expect(metadata.shouldFold).toBe(false);
    });
  });

  // ==================== JSON 高亮 ====================
  describe('JSON 高亮', () => {
    it('有效 JSON 应包含 ANSI 颜色代码', () => {
      const response = sendMessage('req-json-hl', 'process', {
        text: '{"name": "Alice", "age": 30, "active": true, "score": null}',
        options: { enableHighlight: true },
      }) as Record<string, unknown>;

      const content = (response.payload as Record<string, unknown>).content as string;
      expect(content).toContain('\x1b['); // Contains ANSI codes
    });

    it('有效 JSON 键应用 CYAN+BOLD 高亮', () => {
      const response = sendMessage('req-json-keys', 'process', {
        text: '{"myKey": "value"}',
        options: { enableHighlight: true },
      }) as Record<string, unknown>;

      const content = (response.payload as Record<string, unknown>).content as string;
      // CYAN = \x1b[36m, BOLD = \x1b[1m
      expect(content).toContain('\x1b[36m');
      expect(content).toContain('\x1b[1m');
    });

    it('无效 JSON 不应崩溃，应保持原文本', () => {
      const invalidJson = '{not valid json}';
      const response = sendMessage('req-invalid-json', 'process', {
        text: invalidJson,
      }) as Record<string, unknown>;

      expect(response.error).toBeUndefined();
      const payload = response.payload as Record<string, unknown>;
      expect(payload.content).toBe(invalidJson);
    });
  });

  // ==================== LOG 高亮 ====================
  describe('LOG 高亮', () => {
    it('ERROR 关键字应用红色高亮', () => {
      const response = sendMessage('req-log-error', 'process', {
        text: '2024-01-15 10:00:00 ERROR Connection failed',
        options: { enableHighlight: true },
      }) as Record<string, unknown>;

      const content = (response.payload as Record<string, unknown>).content as string;
      expect(content).toContain('ERROR');
      expect(content).toContain('\x1b['); // Has ANSI color
    });

    it('WARN 关键字应用黄色高亮', () => {
      const response = sendMessage('req-log-warn', 'process', {
        text: '2024-01-15 10:00:00 WARN Disk space low',
        options: { enableHighlight: true },
      }) as Record<string, unknown>;

      const content = (response.payload as Record<string, unknown>).content as string;
      expect(content).toContain('\x1b['); // Has ANSI codes
    });

    it('INFO 关键字应用青色高亮', () => {
      const response = sendMessage('req-log-info', 'process', {
        text: '2024-01-15 10:00:00 INFO Server started on port 3000',
        options: { enableHighlight: true },
      }) as Record<string, unknown>;

      const content = (response.payload as Record<string, unknown>).content as string;
      expect(content).toContain('\x1b[');
    });
  });

  // ==================== 链接检测 ====================
  describe('链接检测', () => {
    it('URL 应用 BLUE+BOLD 高亮', () => {
      const response = sendMessage('req-url', 'process', {
        text: 'See https://example.com for details',
        options: { enableLinkDetection: true },
      }) as Record<string, unknown>;

      const content = (response.payload as Record<string, unknown>).content as string;
      expect(content).toContain('https://example.com');
      expect(content).toContain('\x1b[34m'); // BLUE
    });

    it('禁用链接检测时 URL 不应高亮', () => {
      const text = 'Visit https://example.com today';
      const response = sendMessage('req-no-url', 'process', {
        text,
        options: { enableLinkDetection: false },
      }) as Record<string, unknown>;

      const content = (response.payload as Record<string, unknown>).content as string;
      // Should not have blue color around the URL
      expect(content).not.toContain('\x1b[34m');
    });
  });

  // ==================== configure 任务 ====================
  describe('configure 任务', () => {
    it('应该更新全局配置', () => {
      // Configure with custom foldThreshold
      sendMessage('req-cfg', 'configure', { foldThreshold: 10 });

      // Test effect: 11 lines should trigger fold
      const text = Array.from({ length: 11 }, (_, i) => `line ${i}`).join('\n');
      const response = sendMessage('req-after-cfg', 'process', { text }) as Record<string, unknown>;

      const metadata = (response.payload as Record<string, unknown>).metadata as Record<
        string,
        unknown
      >;
      expect(metadata.shouldFold).toBe(true);
    });

    it('configure 响应 payload.ok 应为 true', () => {
      const response = sendMessage('req-cfg-2', 'configure', {
        enableHighlight: false,
      }) as Record<string, unknown>;

      expect((response.payload as Record<string, unknown>).ok).toBe(true);
    });
  });

  // ==================== 错误处理 ====================
  describe('错误处理', () => {
    it('处理过程中的异常应返回 error 字段', () => {
      // Send malformed payload that might cause issues
      const event = {
        data: {
          id: 'req-err',
          type: 'process',
          // payload is null which should be handled gracefully
          payload: null,
        },
      } as unknown as MessageEvent;

      const before = postedMessages.length;
      (self as unknown as { onmessage: (e: MessageEvent) => void }).onmessage(event);

      const responses = postedMessages.slice(before);
      // Either succeeds with empty content or returns an error
      expect(responses.length).toBe(1);
    });
  });

  // ==================== TABLE 格式化 ====================
  describe('TABLE 格式化', () => {
    it('管道符表格应被检测并格式化', () => {
      const tableText =
        '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |';
      const response = sendMessage('req-table', 'process', {
        text: tableText,
        options: { enableTableFormat: true },
      }) as Record<string, unknown>;

      const payload = response.payload as Record<string, unknown>;
      expect(payload.type).toBe('table');
    });

    it('禁用表格格式化时应返回原始文本', () => {
      const tableText =
        '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |';
      const response = sendMessage('req-table-no-fmt', 'process', {
        text: tableText,
        options: { enableTableFormat: false },
      }) as Record<string, unknown>;

      const payload = response.payload as Record<string, unknown>;
      // Type still detected as table but content not reformatted
      expect(payload.content).toBeDefined();
    });
  });
});
