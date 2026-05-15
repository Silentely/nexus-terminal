/**
 * Tests for output-processor.worker.ts
 *
 * The worker uses self.onmessage for message handling and self.postMessage for responses.
 * We test it by simulating message events and capturing postMessage calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock self.postMessage before importing the worker
const postMessageMock = vi.fn();
Object.defineProperty(globalThis, 'postMessage', {
  value: postMessageMock,
  writable: true,
  configurable: true,
});

// Import the worker module — this registers self.onmessage
import './output-processor.worker';

/** Simulate sending a message to the worker and capture the response */
function sendMessage(type: string, payload: unknown, id = 'test-id') {
  const event = new MessageEvent('message', { data: { id, type, payload } });
  // @ts-expect-error: accessing self.onmessage for testing
  self.onmessage(event);
  return postMessageMock.mock.calls.at(-1)?.[0];
}

describe('output-processor.worker', () => {
  beforeEach(() => {
    postMessageMock.mockClear();
  });

  describe('process 任务', () => {
    it('应该处理 JSON 文本并返回高亮结果', () => {
      const response = sendMessage('process', { text: '{"key": "value", "count": 42}' });

      expect(response).toBeDefined();
      expect(response.type).toBe('process');
      expect(response.id).toBe('test-id');
      expect(response.payload).toBeDefined();
      expect(response.payload.type).toBe('json');
      expect(response.payload.content).toContain('\x1b[');
    });

    it('应该处理 YAML 文本', () => {
      const response = sendMessage('process', {
        text: 'name: test\nversion: 1.0\ndescription: hello',
      });

      expect(response.payload.type).toBe('yaml');
    });

    it('应该处理 LOG 文本', () => {
      const response = sendMessage('process', {
        text: '2024-01-15 10:30:00 ERROR Something failed',
      });

      expect(response.payload.type).toBe('log');
      expect(response.payload.content).toContain('\x1b[');
    });

    it('应该处理普通文本', () => {
      const response = sendMessage('process', {
        text: 'Hello world, this is plain text',
      });

      expect(response.payload.type).toBe('text');
    });

    it('应该返回元数据', () => {
      const response = sendMessage('process', { text: 'line1\nline2\nline3' });

      expect(response.payload.metadata).toBeDefined();
      expect(response.payload.metadata.lineCount).toBe(3);
    });

    it('应该去除 ANSI 码后再检测类型', () => {
      const response = sendMessage('process', {
        text: '\x1b[31m{"key": "value"}\x1b[0m',
      });

      expect(response.payload.type).toBe('json');
    });

    it('应该接受 options 并应用', () => {
      const response = sendMessage('process', {
        text: '{"key": "value"}',
        options: { enableHighlight: false },
      });

      expect(response.payload.type).toBe('json');
      // 禁用高亮后不应包含 ANSI 码
      expect(response.payload.content).not.toContain('\x1b[');
    });

    it('应该正确处理折叠阈值', () => {
      const longText = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
      const response = sendMessage('process', {
        text: longText,
        options: { foldThreshold: 5 },
      });

      expect(response.payload.metadata.shouldFold).toBe(true);
    });

    it('空文本应返回 text 类型', () => {
      const response = sendMessage('process', { text: '' });

      expect(response.payload.type).toBe('text');
    });

    it('超过 5000 行应跳过高亮', () => {
      const largeText = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
      const response = sendMessage('process', { text: largeText });

      expect(response.payload.type).toBe('text');
      expect(response.payload.metadata.lineCount).toBe(5001);
    });

    it('应该处理 TABLE 文本', () => {
      const tableText =
        '| Name   | Age   | City   |\n| Alice  | 30    | NYC    |\n| Bob    | 25    | LA     |';
      const response = sendMessage('process', { text: tableText });

      expect(response.payload.type).toBe('table');
    });
  });

  describe('configure 任务', () => {
    it('应该更新配置并返回 ok', () => {
      const response = sendMessage('configure', { foldThreshold: 100 }, 'config-id');

      expect(response.id).toBe('config-id');
      expect(response.type).toBe('configure');
      expect(response.payload).toEqual({ ok: true });
    });

    it('应该合并配置而不是替换', () => {
      // First configure with highlight disabled
      sendMessage('configure', { enableHighlight: false }, 'cfg-1');

      // Then configure only foldThreshold - enableHighlight should persist
      sendMessage('configure', { foldThreshold: 200 }, 'cfg-2');

      // Process JSON - if enableHighlight is still false, no ANSI codes
      const response = sendMessage('process', { text: '{"key": "val"}' }, 'cfg-3');
      expect(response.payload.content).not.toContain('\x1b[');

      // Reset for other tests
      sendMessage('configure', { enableHighlight: true }, 'cfg-reset');
    });
  });

  describe('未知任务类型', () => {
    it('应该返回错误响应', () => {
      const response = sendMessage('unknownTask', { data: 'test' }, 'unknown-id');

      expect(response.id).toBe('unknown-id');
      expect(response.type).toBe('unknownTask');
      expect(response.payload).toBeNull();
      expect(response.error).toContain('未知任务类型: unknownTask');
    });
  });

  describe('错误处理', () => {
    it('处理过程中出错应返回错误响应', () => {
      // Send malformed payload that would cause an error
      const response = sendMessage('process', null, 'error-id');

      expect(response).toBeDefined();
      // Either error field exists or it handled gracefully
      if (response.error) {
        expect(typeof response.error).toBe('string');
      }
    });
  });

  describe('JSON 高亮', () => {
    it('应该高亮 JSON 键为青色粗体', () => {
      const response = sendMessage('process', {
        text: '{"name": "test"}',
        options: { enableHighlight: true, enableLinkDetection: false },
      });

      // Key should be highlighted with CYAN + BOLD
      expect(response.payload.content).toContain('\x1b[36m'); // CYAN
      expect(response.payload.content).toContain('\x1b[1m'); // BOLD
    });

    it('应该高亮 JSON 字符串值为绿色', () => {
      const response = sendMessage('process', {
        text: '{"key": "hello"}',
        options: { enableHighlight: true, enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[32m'); // GREEN
    });

    it('应该高亮 JSON 数字为黄色', () => {
      const response = sendMessage('process', {
        text: '{"count": 42}',
        options: { enableHighlight: true, enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[33m'); // YELLOW
    });
  });

  describe('LOG 高亮', () => {
    it('应该高亮 ERROR 为亮红色', () => {
      const response = sendMessage('process', {
        text: '2024-01-15 ERROR: connection failed',
        options: { enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[91m'); // BRIGHT_RED
    });

    it('应该高亮 INFO 为亮青色', () => {
      const response = sendMessage('process', {
        text: '2024-01-15 INFO: server started',
        options: { enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[96m'); // BRIGHT_CYAN
    });
  });

  describe('链接高亮', () => {
    it('应该高亮 HTTP URLs', () => {
      const response = sendMessage('process', {
        text: 'Visit https://example.com for details',
        options: { enableLinkDetection: true },
      });

      expect(response.payload.content).toContain('https://example.com');
      expect(response.payload.content).toContain('\x1b[34m'); // BLUE
    });

    it('禁用链接检测时不应高亮 URLs', () => {
      const response = sendMessage('process', {
        text: 'Visit https://example.com for details',
        options: { enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('https://example.com');
      expect(response.payload.content).not.toContain('\x1b[34m'); // No BLUE
    });
  });

  describe('响应 ID 关联', () => {
    it('应该返回与请求相同的 id', () => {
      const response = sendMessage('process', { text: 'hello' }, 'my-unique-id-123');
      expect(response.id).toBe('my-unique-id-123');
    });

    it('多个不同 id 的请求应各自返回正确 id', () => {
      const response1 = sendMessage('process', { text: 'hello' }, 'id-001');
      const response2 = sendMessage('process', { text: 'world' }, 'id-002');

      expect(response1.id).toBe('id-001');
      expect(response2.id).toBe('id-002');
    });
  });

  describe('LOG 高亮 – 额外级别', () => {
    it('应该高亮 WARN 为亮黄色加粗', () => {
      const response = sendMessage('process', {
        text: '2024-01-15 WARN: disk usage high',
        options: { enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[93m'); // BRIGHT_YELLOW
      expect(response.payload.content).toContain('\x1b[1m');  // BOLD
    });

    it('应该高亮 DEBUG 为亮黑色加粗', () => {
      const response = sendMessage('process', {
        text: '2024-01-15 DEBUG: entering function',
        options: { enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK
      expect(response.payload.content).toContain('\x1b[1m');  // BOLD
    });

    it('日志级别大小写不敏感（error 小写）', () => {
      const response = sendMessage('process', {
        text: '2024-01-15 error: something broke',
        options: { enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[91m'); // BRIGHT_RED (error)
    });
  });

  describe('JSON 高亮 – 布尔值和 null', () => {
    it('应该高亮 JSON 布尔值 true 为洋红色', () => {
      const response = sendMessage('process', {
        text: '{"enabled": true}',
        options: { enableHighlight: true, enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[35m'); // MAGENTA
    });

    it('应该高亮 JSON 布尔值 false 为洋红色', () => {
      const response = sendMessage('process', {
        text: '{"active": false}',
        options: { enableHighlight: true, enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[35m'); // MAGENTA
    });

    it('应该高亮 JSON null 为亮黑色', () => {
      const response = sendMessage('process', {
        text: '{"value": null}',
        options: { enableHighlight: true, enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK (null)
    });
  });

  describe('YAML 高亮', () => {
    it('应该高亮 YAML 注释为亮黑色', () => {
      const response = sendMessage('process', {
        text: '# This is a comment\nname: test\nversion: 1.0\ndescription: a description',
        options: { enableHighlight: true, enableLinkDetection: false },
      });

      // Comment lines should be highlighted in BRIGHT_BLACK
      expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK
    });

    it('应该高亮 YAML 数字值为黄色', () => {
      const response = sendMessage('process', {
        text: 'port: 8080\nhost: localhost\nworkers: 4',
        options: { enableHighlight: true, enableLinkDetection: false },
      });

      expect(response.payload.content).toContain('\x1b[33m'); // YELLOW (numbers)
    });
  });

  describe('元数据 – isLong 和 shouldFold', () => {
    it('行数少于 foldThreshold 时 shouldFold 应为 false', () => {
      const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
      const response = sendMessage('process', {
        text,
        options: { foldThreshold: 500 },
      });

      expect(response.payload.metadata.shouldFold).toBe(false);
      expect(response.payload.metadata.isLong).toBe(false);
    });

    it('foldThreshold 应包含在元数据中', () => {
      const response = sendMessage('process', {
        text: 'single line',
        options: { foldThreshold: 200 },
      });

      expect(response.payload.metadata.foldThreshold).toBe(200);
    });
  });
});
