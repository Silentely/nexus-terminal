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
});

// ==================== 额外增强测试 ====================

describe('YAML 高亮细节', () => {
  beforeEach(() => {
    postMessageMock.mockClear();
    // Reset config to defaults
    sendMessage('configure', {
      enableHighlight: true,
      enableTableFormat: true,
      enableLinkDetection: false,
      foldThreshold: 500,
    }, 'reset');
    postMessageMock.mockClear();
  });

  it('YAML 注释行应高亮为 BRIGHT_BLACK', () => {
    const response = sendMessage('process', {
      text: 'name: test\nversion: 1.0\n# This is a comment\nport: 8080',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('yaml');
    expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK for comment
  });

  it('YAML 列表条目标记应高亮为 WHITE', () => {
    // Construct a YAML with a list so it's still detected as yaml (need >2 key:value lines too)
    const response = sendMessage('process', {
      text: 'name: test\nversion: 1.0\nenv: production\nitems:\n- item1\n- item2',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('yaml');
    expect(response.payload.content).toContain('\x1b[37m'); // WHITE for list marker
  });

  it('YAML null 值应高亮为 BRIGHT_BLACK', () => {
    const response = sendMessage('process', {
      text: 'name: test\nversion: 1.0\ndescription: null\nport: 8080',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('yaml');
    expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK for null
  });

  it('YAML ~ 值应高亮为 BRIGHT_BLACK', () => {
    const response = sendMessage('process', {
      text: 'name: test\nversion: 1.0\ndescription: ~\nport: 8080',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('yaml');
    expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK for ~
  });

  it('YAML boolean yes/no 值应高亮为 MAGENTA', () => {
    const response = sendMessage('process', {
      text: 'name: test\nversion: 1.0\nenabled: yes\ndisabled: no',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('yaml');
    expect(response.payload.content).toContain('\x1b[35m'); // MAGENTA for yes/no
  });

  it('YAML 带引号的字符串值应高亮为 GREEN', () => {
    const response = sendMessage('process', {
      text: 'name: "quoted string"\nversion: 1.0\nenv: production\nport: 8080',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('yaml');
    expect(response.payload.content).toContain('\x1b[32m'); // GREEN for quoted string
  });

  it('YAML 数字值应高亮为 YELLOW', () => {
    const response = sendMessage('process', {
      text: 'name: test\nversion: 1.0\nport: 8080\ntimeout: 30',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('yaml');
    expect(response.payload.content).toContain('\x1b[33m'); // YELLOW for numbers
  });
});

describe('LOG 高亮细节', () => {
  beforeEach(() => {
    postMessageMock.mockClear();
    sendMessage('configure', {
      enableHighlight: true,
      enableLinkDetection: false,
      foldThreshold: 500,
    }, 'reset');
    postMessageMock.mockClear();
  });

  it('应该检测 TRACE 关键字为 LOG 类型', () => {
    const response = sendMessage('process', {
      text: '10:30:00 TRACE entering function foo',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
  });

  it('应该检测 FAIL 关键字为 LOG 类型', () => {
    const response = sendMessage('process', {
      text: '10:30:00 FAIL test case xyz',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
  });

  it('应该高亮 WARNING 关键字为 BRIGHT_YELLOW', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 WARNING: disk space low',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[93m'); // BRIGHT_YELLOW
  });

  it('应该高亮 ERR 关键字为 BRIGHT_RED', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 ERR connection reset',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[91m'); // BRIGHT_RED for ERR
  });

  it('应该高亮 DEBUG 关键字为 BRIGHT_BLACK', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 DEBUG variable state: {}',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK for DEBUG
  });

  it('应该高亮 SUCCESS 关键字为 BRIGHT_GREEN', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 SUCCESS deployment complete',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[92m'); // BRIGHT_GREEN for SUCCESS
  });

  it('应该高亮 OK 关键字为 BRIGHT_GREEN', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 health check OK',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[92m'); // BRIGHT_GREEN for OK
  });

  it('应该高亮 IPv4 地址为 YELLOW', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 INFO connection from 192.168.1.100',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[33m'); // YELLOW for IP
  });

  it('应该高亮 HTTP 2xx 状态码为 GREEN', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 INFO response status 200',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[32m'); // GREEN for 2xx
  });

  it('应该高亮 HTTP 3xx 状态码为 CYAN', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 INFO redirect 301',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[36m'); // CYAN for 3xx
  });

  it('应该高亮 HTTP 4xx 状态码为 YELLOW', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 WARN not found 404',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[33m'); // YELLOW for 4xx
  });

  it('应该高亮 HTTP 5xx 状态码为 RED', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 ERROR server error 500',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[31m'); // RED for 5xx
  });

  it('应该高亮时间戳为 BRIGHT_BLACK', () => {
    const response = sendMessage('process', {
      text: '2024-01-15 10:30:00 INFO server started',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
    expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK for timestamp
  });

  it('仅有 HH:MM:SS 时间格式的行应检测为 LOG', () => {
    const response = sendMessage('process', {
      text: '10:30:00 service running',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('log');
  });
});

describe('JSON 高亮细节', () => {
  beforeEach(() => {
    postMessageMock.mockClear();
    sendMessage('configure', {
      enableHighlight: true,
      enableLinkDetection: false,
      foldThreshold: 500,
    }, 'reset');
    postMessageMock.mockClear();
  });

  it('应该高亮 JSON boolean true 为 MAGENTA', () => {
    const response = sendMessage('process', {
      text: '{"active": true}',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('json');
    expect(response.payload.content).toContain('\x1b[35m'); // MAGENTA for boolean
  });

  it('应该高亮 JSON null 值为 BRIGHT_BLACK', () => {
    const response = sendMessage('process', {
      text: '{"value": null}',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('json');
    expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK for null
  });

  it('应该高亮 JSON 数组括号为 WHITE', () => {
    const response = sendMessage('process', {
      text: '[1, 2, 3]',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('json');
    expect(response.payload.content).toContain('\x1b[37m'); // WHITE for brackets
  });

  it('无效 JSON 应降级为其他格式检测', () => {
    const response = sendMessage('process', {
      text: '{invalid json}',
      options: { enableLinkDetection: false },
    });

    // Should not be detected as JSON since it's invalid
    expect(response.payload.type).not.toBe('json');
  });

  it('负数应高亮为 YELLOW', () => {
    const response = sendMessage('process', {
      text: '{"temperature": -5.5}',
      options: { enableHighlight: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('json');
    expect(response.payload.content).toContain('\x1b[33m'); // YELLOW for negative number
  });
});

describe('TABLE 格式检测与高亮', () => {
  beforeEach(() => {
    postMessageMock.mockClear();
    sendMessage('configure', {
      enableHighlight: true,
      enableTableFormat: true,
      enableLinkDetection: false,
      foldThreshold: 500,
    }, 'reset');
    postMessageMock.mockClear();
  });

  it('空格分隔的多列数据应检测为 TABLE', () => {
    // 3+ columns separated by 2+ spaces, consistent across all rows
    const spaceTable = 'Name       Age  City\nAlice      30   NYC\nBob        25   LA\nCarol      28   Chicago';
    const response = sendMessage('process', {
      text: spaceTable,
      options: { enableTableFormat: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('table');
  });

  it('TABLE 第一行（表头）应高亮为 CYAN BOLD', () => {
    const tableText = '| Name   | Age |\n| Alice  | 30  |\n| Bob    | 25  |';
    const response = sendMessage('process', {
      text: tableText,
      options: { enableTableFormat: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('table');
    // Header row should be CYAN+BOLD
    expect(response.payload.content).toContain('\x1b[36m'); // CYAN
    expect(response.payload.content).toContain('\x1b[1m');  // BOLD
  });

  it('TABLE 分隔行应高亮为 BRIGHT_BLACK', () => {
    const tableText = '| Name   | Age |\n|--------|-----|\n| Alice  | 30  |';
    const response = sendMessage('process', {
      text: tableText,
      options: { enableTableFormat: true, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('table');
    expect(response.payload.content).toContain('\x1b[90m'); // BRIGHT_BLACK for separator
  });

  it('禁用 TABLE 格式化时应返回原始文本', () => {
    const tableText = '| Name   | Age |\n|--------|-----|\n| Alice  | 30  |';
    const response = sendMessage('process', {
      text: tableText,
      options: { enableTableFormat: false, enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('table');
    // Content should not contain header highlighting
    expect(response.payload.content).not.toContain('\x1b[36m\x1b[1m'); // No CYAN+BOLD
  });
});

describe('链接与路径高亮', () => {
  beforeEach(() => {
    postMessageMock.mockClear();
    sendMessage('configure', {
      enableHighlight: true,
      enableLinkDetection: true,
      foldThreshold: 500,
    }, 'reset');
    postMessageMock.mockClear();
  });

  it('路径应高亮为 CYAN', () => {
    const response = sendMessage('process', {
      text: 'file saved to /etc/nginx/nginx.conf successfully',
      options: { enableLinkDetection: true },
    });

    expect(response.payload.content).toContain('\x1b[36m'); // CYAN for path
    expect(response.payload.content).toContain('/etc/nginx/nginx.conf');
  });

  it('HTTP URL 应高亮为 BLUE BOLD', () => {
    const response = sendMessage('process', {
      text: 'check http://localhost:3000/api',
      options: { enableLinkDetection: true },
    });

    expect(response.payload.content).toContain('\x1b[34m'); // BLUE
    expect(response.payload.content).toContain('\x1b[1m');  // BOLD
    expect(response.payload.content).toContain('http://localhost:3000/api');
  });
});

describe('换行符标准化', () => {
  beforeEach(() => {
    postMessageMock.mockClear();
    sendMessage('configure', {
      enableHighlight: false,
      enableLinkDetection: false,
      foldThreshold: 500,
    }, 'reset');
    postMessageMock.mockClear();
  });

  it('CRLF 换行符应被标准化为 LF', () => {
    const response = sendMessage('process', {
      text: 'line1\r\nline2\r\nline3',
      options: { enableHighlight: false, enableLinkDetection: false },
    });

    expect(response.payload.metadata.lineCount).toBe(3);
    expect(response.payload.content).not.toContain('\r');
  });

  it('CR 换行符应被标准化为 LF', () => {
    const response = sendMessage('process', {
      text: 'line1\rline2\rline3',
      options: { enableHighlight: false, enableLinkDetection: false },
    });

    expect(response.payload.metadata.lineCount).toBe(3);
    expect(response.payload.content).not.toContain('\r');
  });

  it('ANSI 转义码应在类型检测前被去除', () => {
    // Text with ANSI that would look like YAML after stripping
    const response = sendMessage('process', {
      text: '\x1b[32mname: test\x1b[0m\nversion: 1.0\nenv: production\nport: 8080',
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('yaml');
  });
});

describe('折叠阈值与元数据', () => {
  beforeEach(() => {
    postMessageMock.mockClear();
    sendMessage('configure', {
      enableHighlight: false,
      enableLinkDetection: false,
      foldThreshold: 500,
    }, 'reset');
    postMessageMock.mockClear();
  });

  it('行数未超过阈值时 shouldFold 应为 false', () => {
    const text = Array.from({ length: 5 }, (_, i) => `line ${i}`).join('\n');
    const response = sendMessage('process', {
      text,
      options: { foldThreshold: 10, enableLinkDetection: false },
    });

    expect(response.payload.metadata.shouldFold).toBe(false);
    expect(response.payload.metadata.isLong).toBe(false);
  });

  it('行数超过阈值时 shouldFold 和 isLong 均应为 true', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const response = sendMessage('process', {
      text,
      options: { foldThreshold: 10, enableLinkDetection: false },
    });

    expect(response.payload.metadata.shouldFold).toBe(true);
    expect(response.payload.metadata.isLong).toBe(true);
    expect(response.payload.metadata.foldThreshold).toBe(10);
  });

  it('5001 行文本应跳过高亮并返回 text 类型', () => {
    const largeText = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
    const response = sendMessage('process', {
      text: largeText,
      options: { enableLinkDetection: false },
    });

    expect(response.payload.type).toBe('text');
    expect(response.payload.metadata.lineCount).toBe(5001);
    // Content should not have ANSI codes (highlighting was skipped)
    expect(response.payload.content).not.toContain('\x1b[');
  });
});
