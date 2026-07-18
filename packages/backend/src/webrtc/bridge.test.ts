import { EventEmitter } from 'events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { bridgeDataChannelToGateway } from './bridge';
import { resolveAndValidatePublicHost } from '../utils/url';
import { logger } from '../utils/logger';

type MockGatewayWebSocket = EventEmitter & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type MockDataChannel = {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onMessage: { subscribe: ReturnType<typeof vi.fn> };
  onclose?: () => void;
};

let capturedGatewayWs: MockGatewayWebSocket | null = null;

vi.mock('ws', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ws')>();
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const ws = new EventEmitter() as MockGatewayWebSocket;
    ws.send = vi.fn();
    ws.close = vi.fn();
    capturedGatewayWs = ws;
    return ws;
  }) as any;

  MockWebSocket.OPEN = 1;
  return { ...actual, default: MockWebSocket };
});

vi.mock('../utils/url', () => ({
  resolveAndValidatePublicHost: vi.fn(),
}));

vi.mock('../utils/ssrf-guard', () => ({
  createPinnedLookup: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createDataChannel(): MockDataChannel {
  return {
    send: vi.fn(),
    close: vi.fn(),
    onMessage: { subscribe: vi.fn() },
  };
}

describe('WebRTC 数据通道到 remote-gateway WebSocket 桥接', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedGatewayWs = null;
    process.env = { ...originalEnv, DEPLOYMENT_MODE: 'local' };
    vi.mocked(resolveAndValidatePublicHost).mockResolvedValue({
      hostname: 'gateway.example.com',
      addresses: ['203.0.113.10'],
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('外部 wss 网关应通过 HTTP 等价 URL 校验并保留配置路径', async () => {
    process.env.REMOTE_GATEWAY_WS_URL_LOCAL = 'wss://gateway.example.com/remote/bridge';
    const dc = createDataChannel();

    await bridgeDataChannelToGateway(
      dc as unknown as Parameters<typeof bridgeDataChannelToGateway>[0],
      'wss://client-controlled.example.net/ignored?token=secret-token#fragment',
      'session-1',
    );

    expect(resolveAndValidatePublicHost).toHaveBeenCalledWith(
      'https://gateway.example.com/remote/bridge?token=secret-token',
      'WebRTC-Bridge-session-1',
    );
    expect(WebSocket).toHaveBeenCalledWith(
      'wss://gateway.example.com/remote/bridge?token=secret-token',
      expect.objectContaining({ agent: expect.any(Object) }),
    );
    expect(capturedGatewayWs).not.toBeNull();
  });

  it('外部 ws 网关应通过 http URL 校验', async () => {
    process.env.REMOTE_GATEWAY_WS_URL_LOCAL = 'ws://gateway.example.com/plain-ws';
    const dc = createDataChannel();

    await bridgeDataChannelToGateway(
      dc as unknown as Parameters<typeof bridgeDataChannelToGateway>[0],
      'ws://client.example.net/ignored?token=secret-token',
      'session-ws',
    );

    expect(resolveAndValidatePublicHost).toHaveBeenCalledWith(
      'http://gateway.example.com/plain-ws?token=secret-token',
      'WebRTC-Bridge-session-ws',
    );
    expect(WebSocket).toHaveBeenCalledWith(
      'ws://gateway.example.com/plain-ws?token=secret-token',
      expect.objectContaining({ agent: expect.any(Object) }),
    );
  });

  it('内部网关地址应跳过 SSRF 校验并继续创建 WebSocket', async () => {
    process.env.REMOTE_GATEWAY_WS_URL_LOCAL = 'ws://localhost:8081/remote/bridge';
    const dc = createDataChannel();

    await bridgeDataChannelToGateway(
      dc as unknown as Parameters<typeof bridgeDataChannelToGateway>[0],
      'ws://client.example.net/ignored?token=secret-token',
      'session-internal',
    );

    expect(resolveAndValidatePublicHost).not.toHaveBeenCalled();
    expect(WebSocket).toHaveBeenCalledWith('ws://localhost:8081/remote/bridge?token=secret-token', {
      agent: undefined,
    });
    expect(capturedGatewayWs).not.toBeNull();
  });

  it('配置网关 URL 无效时不应记录敏感查询值', async () => {
    process.env.REMOTE_GATEWAY_WS_URL_LOCAL = 'not a url?token=secret-token';
    const dc = createDataChannel();

    await bridgeDataChannelToGateway(
      dc as unknown as Parameters<typeof bridgeDataChannelToGateway>[0],
      'wss://client.example.net/ignored',
      'session-config',
    );

    const serializedLogs = JSON.stringify(vi.mocked(logger.error).mock.calls);
    const serializedClientMessages = JSON.stringify(dc.send.mock.calls);

    expect(serializedLogs).not.toContain('secret-token');
    expect(serializedClientMessages).not.toContain('secret-token');
  });

  it('客户端传入网关 URL 无效时不应记录敏感查询值', async () => {
    const dc = createDataChannel();

    await bridgeDataChannelToGateway(
      dc as unknown as Parameters<typeof bridgeDataChannelToGateway>[0],
      'not a url?token=secret-token',
      'session-2',
    );

    const serializedLogs = JSON.stringify(vi.mocked(logger.error).mock.calls);
    const serializedClientMessages = JSON.stringify(dc.send.mock.calls);

    expect(serializedLogs).not.toContain('secret-token');
    expect(serializedClientMessages).not.toContain('secret-token');
  });

  it('SSRF 校验失败时不应暴露原始网关查询值', async () => {
    process.env.REMOTE_GATEWAY_WS_URL_LOCAL = 'wss://gateway.example.com/remote';
    vi.mocked(resolveAndValidatePublicHost).mockRejectedValueOnce(
      Object.assign(new Error('blocked token=secret-token'), {
        input: 'https://gateway.example.com/remote?token=secret-token',
      }),
    );
    const dc = createDataChannel();

    await bridgeDataChannelToGateway(
      dc as unknown as Parameters<typeof bridgeDataChannelToGateway>[0],
      'wss://client.example.net/ignored?token=secret-token',
      'session-3',
    );

    const serializedLogs = JSON.stringify(vi.mocked(logger.error).mock.calls);
    const serializedClientMessages = JSON.stringify(dc.send.mock.calls);

    expect(serializedLogs).not.toContain('secret-token');
    expect(serializedClientMessages).not.toContain('secret-token');
  });

  it('网关未就绪时应缓存客户端消息，open 后统一转发', async () => {
    process.env.REMOTE_GATEWAY_WS_URL_LOCAL = 'ws://localhost:8081/remote/bridge';
    const dc = createDataChannel();
    let onMessageHandler: ((data: unknown) => void) | undefined;
    dc.onMessage.subscribe.mockImplementation((handler: (data: unknown) => void) => {
      onMessageHandler = handler;
      return { unsubscribe: vi.fn() };
    });

    await bridgeDataChannelToGateway(
      dc as unknown as Parameters<typeof bridgeDataChannelToGateway>[0],
      'ws://localhost:8081/remote/bridge?token=abc',
      'session-queue',
    );

    expect(onMessageHandler).toBeDefined();
    onMessageHandler?.('4.sync,1.1;');
    expect(capturedGatewayWs?.send).not.toHaveBeenCalled();

    capturedGatewayWs?.emit('open');
    expect(capturedGatewayWs?.send).toHaveBeenCalledWith('4.sync,1.1;');
  });
});
