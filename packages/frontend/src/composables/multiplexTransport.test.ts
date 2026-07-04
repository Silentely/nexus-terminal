import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChannel, disconnectAll } from './multiplexTransport';

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn();

  constructor(
    readonly url: string,
    readonly protocol?: string,
  ) {}

  close(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

describe('multiplexTransport', () => {
  const createdWebSockets: MockWebSocket[] = [];

  beforeEach(() => {
    createdWebSockets.length = 0;
    const WebSocketMock = vi.fn((url: string, protocol?: string) => {
      const ws = new MockWebSocket(url, protocol);
      createdWebSockets.push(ws);
      return ws;
    }) as unknown as {
      CONNECTING: number;
      OPEN: number;
      CLOSING: number;
      CLOSED: number;
    };
    WebSocketMock.CONNECTING = MockWebSocket.CONNECTING;
    WebSocketMock.OPEN = MockWebSocket.OPEN;
    WebSocketMock.CLOSING = MockWebSocket.CLOSING;
    WebSocketMock.CLOSED = MockWebSocket.CLOSED;
    vi.stubGlobal('WebSocket', WebSocketMock);
    vi.stubGlobal('location', { protocol: 'http:', host: 'app.example.test' });
  });

  afterEach(() => {
    disconnectAll();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('物理连接未打开时通道发送应返回 false', () => {
    const channel = createChannel('sid-1', '1');

    const sent = channel.sendMessage({ type: 'sftp:list', payload: {} });

    expect(sent).toBe(false);
    expect(createdWebSockets[0].send).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"sftp:list"'),
    );
  });

  it('物理连接打开后通道发送应返回 true', () => {
    const channel = createChannel('sid-1', '1');
    const ws = createdWebSockets[0];
    ws.simulateOpen();
    ws.send.mockClear();

    const sent = channel.sendMessage({ type: 'sftp:list', payload: {} });

    expect(sent).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'sftp:list', payload: {}, sid: 'sid-1' }),
    );
  });
});
