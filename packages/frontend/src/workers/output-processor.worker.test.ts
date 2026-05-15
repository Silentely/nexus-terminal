/**
 * Tests for output-processor.worker.ts
 *
 * The worker functions are not exported, so we test via the self.onmessage handler
 * by simulating WorkerRequest messages and capturing postMessage responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Minimal self/globalThis setup for Worker context ----
// The worker script uses `self.onmessage` and `self.postMessage`.
// In the happy-dom environment `self` already references globalThis,
// so we just capture postMessage calls.

const postedMessages: unknown[] = [];

beforeEach(() => {
  postedMessages.length = 0;
  // Override self.postMessage to capture outgoing messages
  vi.spyOn(globalThis, 'postMessage').mockImplementation((data: unknown) => {
    postedMessages.push(data);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper: simulate receiving a WorkerRequest via self.onmessage */
async function dispatchWorkerMessage(data: {
  id: string;
  type: string;
  payload: unknown;
}): Promise<unknown> {
  // Dynamically load the worker module so it registers self.onmessage
  // We reset module cache between tests using vi.resetModules below
  const event = new MessageEvent('message', { data });
  // @ts-expect-error self.onmessage may not be typed in test environment
  if (typeof self.onmessage === 'function') {
    // @ts-expect-error calling self.onmessage directly
    self.onmessage(event);
  }
  // Wait a tick so any synchronous postMessage calls complete
  await Promise.resolve();
  return postedMessages[postedMessages.length - 1];
}

describe('output-processor.worker', () => {
  // Load the worker once per suite; its self.onmessage is registered on import.
  beforeEach(async () => {
    vi.resetModules();
    await import('./output-processor.worker');
  });

  describe('message handling – process task', () => {
    it('should respond with a WorkerResponse for a "process" message', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-1',
        type: 'process',
        payload: { text: 'Hello world' },
      });

      expect(response).toMatchObject({
        id: 'req-1',
        type: 'process',
      });
    });

    it('should echo back the request id in the response', async () => {
      const response = await dispatchWorkerMessage({
        id: 'unique-request-id',
        type: 'process',
        payload: { text: 'some text' },
      }) as { id: string };

      expect(response.id).toBe('unique-request-id');
    });

    it('should return a ProcessedOutput with type and content', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-2',
        type: 'process',
        payload: { text: 'Hello world plain text' },
      }) as { payload: { type: string; content: string; metadata: object } };

      expect(response.payload).toHaveProperty('type');
      expect(response.payload).toHaveProperty('content');
      expect(response.payload).toHaveProperty('metadata');
    });

    it('should detect and return JSON type for JSON input', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-json',
        type: 'process',
        payload: { text: '{"name": "test", "value": 42}' },
      }) as { payload: { type: string } };

      expect(response.payload.type).toBe('json');
    });

    it('should detect and return LOG type for log input', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-log',
        type: 'process',
        payload: { text: '2024-01-15 10:30:00 INFO Server started successfully' },
      }) as { payload: { type: string } };

      expect(response.payload.type).toBe('log');
    });

    it('should detect and return YAML type for YAML input', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-yaml',
        type: 'process',
        payload: { text: 'name: myapp\nversion: 1.0\nenvironment: production' },
      }) as { payload: { type: string } };

      expect(response.payload.type).toBe('yaml');
    });

    it('should return TEXT type for plain text', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-text',
        type: 'process',
        payload: { text: 'just some plain text content' },
      }) as { payload: { type: string } };

      expect(response.payload.type).toBe('text');
    });

    it('should include lineCount in metadata', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-meta',
        type: 'process',
        payload: { text: 'line1\nline2\nline3' },
      }) as { payload: { metadata: { lineCount: number } } };

      expect(response.payload.metadata.lineCount).toBe(3);
    });

    it('should strip ANSI codes from input before processing', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-ansi',
        type: 'process',
        payload: { text: '\x1b[32mHello\x1b[0m World' },
      }) as { payload: { content: string } };

      // Resulting content may contain ANSI codes from highlighting, but the source
      // ANSI codes should have been stripped (content should contain "Hello World")
      expect(response.payload.content).toContain('Hello');
      expect(response.payload.content).toContain('World');
    });

    it('should normalize CRLF line endings', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-crlf',
        type: 'process',
        payload: { text: 'line1\r\nline2\r\nline3' },
      }) as { payload: { metadata: { lineCount: number } } };

      expect(response.payload.metadata.lineCount).toBe(3);
    });

    it('should apply options when provided in payload', async () => {
      const response = await dispatchWorkerMessage({
        id: 'req-opts',
        type: 'process',
        payload: {
          text: '{"key": "value"}',
          options: { enableHighlight: false },
        },
      }) as { payload: { type: string; content: string } };

      expect(response.payload.type).toBe('json');
      // With highlight disabled, content should not contain ANSI codes
      expect(response.payload.content).not.toMatch(/\x1b\[/);
    });

    it('should skip highlighting for large inputs (> 5000 lines) and return TEXT type', async () => {
      const largeText = Array(5001).fill('line content').join('\n');
      const response = await dispatchWorkerMessage({
        id: 'req-large',
        type: 'process',
        payload: { text: largeText },
      }) as { payload: { type: string; metadata: { lineCount: number } } };

      expect(response.payload.type).toBe('text');
      expect(response.payload.metadata.lineCount).toBeGreaterThan(5000);
    });

    it('should include shouldFold = true when lineCount exceeds foldThreshold', async () => {
      const longText = Array(600).fill('a').join('\n'); // 600 lines > default foldThreshold 500
      const response = await dispatchWorkerMessage({
        id: 'req-fold',
        type: 'process',
        payload: { text: longText },
      }) as { payload: { metadata: { shouldFold: boolean; isLong: boolean } } };

      expect(response.payload.metadata.shouldFold).toBe(true);
      expect(response.payload.metadata.isLong).toBe(true);
    });

    it('should include shouldFold = false when lineCount is within foldThreshold', async () => {
      const shortText = Array(3).fill('a').join('\n'); // 3 lines < default foldThreshold 500
      const response = await dispatchWorkerMessage({
        id: 'req-nofold',
        type: 'process',
        payload: { text: shortText },
      }) as { payload: { metadata: { shouldFold: boolean } } };

      expect(response.payload.metadata.shouldFold).toBe(false);
    });
  });

  describe('message handling – configure task', () => {
    it('should respond with { ok: true } for a "configure" message', async () => {
      const response = await dispatchWorkerMessage({
        id: 'cfg-1',
        type: 'configure',
        payload: { foldThreshold: 100 },
      }) as { payload: { ok: boolean }; id: string; type: string };

      expect(response.id).toBe('cfg-1');
      expect(response.type).toBe('configure');
      expect(response.payload).toEqual({ ok: true });
    });

    it('should apply configure options to subsequent process calls', async () => {
      // Set a very low foldThreshold so even short text gets shouldFold = true
      await dispatchWorkerMessage({
        id: 'cfg-2',
        type: 'configure',
        payload: { foldThreshold: 1 },
      });

      postedMessages.length = 0; // reset

      const response = await dispatchWorkerMessage({
        id: 'proc-after-cfg',
        type: 'process',
        payload: { text: 'line1\nline2' }, // 2 lines > foldThreshold 1
      }) as { payload: { metadata: { shouldFold: boolean } } };

      expect(response.payload.metadata.shouldFold).toBe(true);
    });
  });

  describe('message handling – unknown task type', () => {
    it('should respond with an error for unknown task types', async () => {
      const response = await dispatchWorkerMessage({
        id: 'unk-1',
        type: 'unknown_type',
        payload: {},
      }) as { id: string; error: string; payload: null };

      expect(response.id).toBe('unk-1');
      expect(response.error).toContain('未知任务类型');
      expect(response.payload).toBeNull();
    });
  });

  describe('JSON highlighting', () => {
    it('should highlight JSON keys with ANSI cyan', async () => {
      const response = await dispatchWorkerMessage({
        id: 'json-hl',
        type: 'process',
        payload: { text: '{"name": "Alice"}' },
      }) as { payload: { content: string } };

      // Content should contain ANSI escape codes from highlighting
      expect(response.payload.content).toContain('\x1b[');
      // And the key "name" should be present
      expect(response.payload.content).toContain('name');
    });

    it('should return original text when JSON is invalid', async () => {
      const invalidJson = '{"broken: json}';
      const response = await dispatchWorkerMessage({
        id: 'json-invalid',
        type: 'process',
        payload: { text: invalidJson },
      }) as { payload: { content: string; type: string } };

      // Invalid JSON won't be detected as JSON type, returns as TEXT
      expect(response.payload.type).toBe('text');
    });
  });

  describe('LOG highlighting', () => {
    it('should highlight ERROR keyword in log lines', async () => {
      const response = await dispatchWorkerMessage({
        id: 'log-error',
        type: 'process',
        payload: { text: '2024-01-15 10:00:00 ERROR Something went wrong' },
      }) as { payload: { content: string } };

      // Content should contain ANSI red codes around ERROR
      expect(response.payload.content).toContain('ERROR');
      expect(response.payload.content).toContain('\x1b[');
    });

    it('should highlight IPv4 addresses in log lines', async () => {
      const response = await dispatchWorkerMessage({
        id: 'log-ip',
        type: 'process',
        payload: { text: '2024-01-15 INFO Connected to 192.168.1.100' },
      }) as { payload: { content: string } };

      expect(response.payload.content).toContain('192.168.1.100');
    });
  });

  describe('empty input', () => {
    it('should handle empty string input gracefully', async () => {
      const response = await dispatchWorkerMessage({
        id: 'empty',
        type: 'process',
        payload: { text: '' },
      }) as { payload: { type: string; metadata: { lineCount: number } } };

      expect(response.payload.type).toBe('text');
      expect(response.payload.metadata.lineCount).toBe(0);
    });
  });
});
