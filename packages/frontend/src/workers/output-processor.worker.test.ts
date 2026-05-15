/**
 * output-processor.worker 单元测试
 *
 * 通过模拟 Worker 消息接口测试 Worker 内部逻辑。
 * 由于 Worker 内部函数未导出，通过 self.onmessage 触发处理。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { WorkerRequest } from './types';

// ==================== 环境准备 ====================

let workerOnMessage: ((event: MessageEvent<WorkerRequest>) => void) | null = null;
const mockPostMessage = vi.fn();

// 在导入 worker 模块前，设置 self.postMessage mock
// Worker 模块会通过 self.onmessage = ... 注册处理函数
beforeAll(async () => {
  // 注入 postMessage mock 到 globalThis
  Object.defineProperty(globalThis, 'postMessage', {
    value: mockPostMessage,
    writable: true,
    configurable: true,
  });

  // 导入 worker 模块（会执行 self.onmessage = handler）
  await import('./output-processor.worker');

  // 获取注册的 onmessage 处理函数
  // @ts-expect-error -- 访问 self.onmessage
  workerOnMessage = globalThis.onmessage as typeof workerOnMessage;
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** 辅助：发送消息并等待 postMessage 响应 */
function sendMessage(data: WorkerRequest) {
  if (!workerOnMessage) throw new Error('Worker onmessage not initialized');
  const event = { data } as MessageEvent<WorkerRequest>;
  workerOnMessage(event);
  return mockPostMessage.mock.calls[mockPostMessage.mock.calls.length - 1]?.[0];
}

// ==================== 测试 ====================

describe('output-processor.worker', () => {
  describe('process 任务', () => {
    it('应该处理 JSON 输入并返回 json 类型', () => {
      const response = sendMessage({
        id: 'test-1',
        type: 'process',
        payload: { text: '{"key":"value","count":42}' },
      });

      expect(response).toBeDefined();
      expect(response.id).toBe('test-1');
      expect(response.type).toBe('process');
      expect(response.payload.type).toBe('json');
      expect(response.error).toBeUndefined();
    });

    it('应该处理 YAML 输入并返回 yaml 类型', () => {
      const response = sendMessage({
        id: 'test-yaml',
        type: 'process',
        payload: { text: 'name: test\nversion: 1.0\ndescription: hello' },
      });

      expect(response.payload.type).toBe('yaml');
      expect(response.error).toBeUndefined();
    });

    it('应该处理 LOG 输入并返回 log 类型', () => {
      const response = sendMessage({
        id: 'test-log',
        type: 'process',
        payload: { text: '2024-01-15 10:30:00 INFO Server started' },
      });

      expect(response.payload.type).toBe('log');
    });

    it('应该处理 TABLE 输入并返回 table 类型', () => {
      const response = sendMessage({
        id: 'test-table',
        type: 'process',
        payload: {
          text: '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |',
        },
      });

      expect(response.payload.type).toBe('table');
    });

    it('应该处理纯文本并返回 text 类型', () => {
      const response = sendMessage({
        id: 'test-text',
        type: 'process',
        payload: { text: 'Hello world, this is plain text' },
      });

      expect(response.payload.type).toBe('text');
    });

    it('应该返回 metadata 包含 lineCount', () => {
      const response = sendMessage({
        id: 'test-meta',
        type: 'process',
        payload: { text: 'line1\nline2\nline3' },
      });

      expect(response.payload.metadata).toBeDefined();
      expect(response.payload.metadata.lineCount).toBe(3);
    });

    it('应该返回正确的 id', () => {
      const response = sendMessage({
        id: 'unique-id-xyz',
        type: 'process',
        payload: { text: 'test' },
      });

      expect(response.id).toBe('unique-id-xyz');
    });

    it('应该去除 ANSI 码后处理', () => {
      const response = sendMessage({
        id: 'test-ansi',
        type: 'process',
        payload: { text: '\x1b[31mred text\x1b[0m normal' },
      });

      // 结果不应包含原始 ANSI 码被误识别（应是纯文本）
      expect(response.payload.type).toBe('text');
    });

    it('JSON 输出应包含 ANSI 高亮码（默认开启高亮）', () => {
      const response = sendMessage({
        id: 'test-json-highlight',
        type: 'process',
        payload: { text: '{"key":"value"}' },
      });

      expect(response.payload.content).toContain('\x1b[');
    });

    it('应该处理空字符串', () => {
      const response = sendMessage({
        id: 'test-empty',
        type: 'process',
        payload: { text: '' },
      });

      expect(response.payload.type).toBe('text');
      expect(response.error).toBeUndefined();
    });
  });

  describe('process 任务 - options 覆盖', () => {
    it('禁用高亮时 JSON 输出不应包含 ANSI 码', () => {
      const response = sendMessage({
        id: 'test-no-highlight',
        type: 'process',
        payload: {
          text: '{"key":"value"}',
          options: { enableHighlight: false },
        },
      });

      expect(response.payload.type).toBe('json');
      // 禁用高亮后不含 ANSI 颜色（但可能含链接检测的 ANSI）
      // 由于链接检测默认开启且 JSON 内容不含链接，应无 ANSI
      expect(response.payload.content).not.toContain('\x1b[');
    });

    it('自定义 foldThreshold 应影响 metadata', () => {
      const response = sendMessage({
        id: 'test-threshold',
        type: 'process',
        payload: {
          text: Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n'),
          options: { foldThreshold: 5 },
        },
      });

      expect(response.payload.metadata.shouldFold).toBe(true);
      expect(response.payload.metadata.foldThreshold).toBe(5);
    });
  });

  describe('configure 任务', () => {
    it('应该返回 { ok: true }', () => {
      const response = sendMessage({
        id: 'test-config',
        type: 'configure',
        payload: { enableHighlight: true, foldThreshold: 200 },
      });

      expect(response.id).toBe('test-config');
      expect(response.type).toBe('configure');
      expect(response.payload).toEqual({ ok: true });
      expect(response.error).toBeUndefined();
    });
  });

  describe('未知任务类型', () => {
    it('未知类型应返回错误响应', () => {
      const response = sendMessage({
        id: 'test-unknown',
        type: 'unknown_type_xyz',
        payload: {},
      });

      expect(response.id).toBe('test-unknown');
      expect(response.error).toBeDefined();
      expect(response.error).toContain('未知任务类型');
      expect(response.payload).toBeNull();
    });
  });

  describe('错误处理', () => {
    it('处理中抛出异常时应返回错误响应', () => {
      // 传入会导致异常的 payload（非对象）
      const response = sendMessage({
        id: 'test-error',
        type: 'process',
        payload: null as unknown as { text: string },
      });

      // 应该捕获错误并返回错误响应，而不是抛出
      expect(response.id).toBe('test-error');
      expect(response.error).toBeDefined();
    });
  });

  describe('大文件保护', () => {
    it('超过 5000 行时应跳过高亮，返回 text 类型', () => {
      const largeText = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
      const response = sendMessage({
        id: 'test-large',
        type: 'process',
        payload: { text: largeText },
      });

      expect(response.payload.type).toBe('text');
      expect(response.payload.metadata.lineCount).toBe(5001);
    });

    it('恰好 5000 行时不应触发大文件保护', () => {
      const text = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
      const response = sendMessage({
        id: 'test-5000',
        type: 'process',
        payload: { text },
      });

      // 5000 行不超过限制，正常处理
      expect(response.payload.metadata.lineCount).toBe(5000);
      expect(response.error).toBeUndefined();
    });
  });

  describe('换行符规范化', () => {
    it('CRLF 应被规范化为 LF', () => {
      const response = sendMessage({
        id: 'test-crlf',
        type: 'process',
        payload: { text: 'line1\r\nline2\r\nline3' },
      });

      expect(response.payload.metadata.lineCount).toBe(3);
    });

    it('单独 CR 应被规范化为 LF', () => {
      const response = sendMessage({
        id: 'test-cr',
        type: 'process',
        payload: { text: 'line1\rline2' },
      });

      expect(response.payload.metadata.lineCount).toBe(2);
    });
  });

  describe('链接检测', () => {
    it('HTTP 链接应被高亮', () => {
      const response = sendMessage({
        id: 'test-link',
        type: 'process',
        payload: { text: 'Visit https://example.com for details' },
      });

      expect(response.payload.content).toContain('https://example.com');
      expect(response.payload.content).toContain('\x1b[');
    });
  });
});
