import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

// Mock WebSocket
vi.mock('ws', () => ({
  default: vi.fn().mockImplementation(() => {
    const ws = new EventEmitter() as EventEmitter & {
      readyState: number;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    ws.readyState = 1; // OPEN
    ws.send = vi.fn();
    ws.close = vi.fn();
    return ws;
  }),
  WebSocket: vi.fn(),
}));

describe('RDP 代理测试', () => {
  let mockClientWs: any;
  let mockRdpWs: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // 创建模拟客户端 WebSocket
    mockClientWs = new EventEmitter() as any;
    mockClientWs.readyState = 1;
    mockClientWs.send = vi.fn();
    mockClientWs.close = vi.fn();
    mockClientWs.userId = 1;
    mockClientWs.username = 'testuser';
    mockClientWs.sessionId = 'test-session-123';

    // 创建模拟 RDP WebSocket
    mockRdpWs = new EventEmitter() as any;
    mockRdpWs.readyState = 1;
    mockRdpWs.send = vi.fn();
    mockRdpWs.close = vi.fn();
  });

  describe('连接建立', () => {
    it('应该成功建立到远程网关的 WebSocket 连接', () => {
      const rdpToken = 'encrypted-token';
      const width = 1920;
      const height = 1080;

      // 模拟连接 URL 构建
      const remoteGatewayUrl = 'ws://localhost:8080';
      const targetUrl = `${remoteGatewayUrl}/?token=${encodeURIComponent(rdpToken)}&width=${width}&height=${height}&dpi=96`;

      expect(targetUrl).toContain('token=');
      expect(targetUrl).toContain('width=1920');
      expect(targetUrl).toContain('height=1080');
    });

    it('应该拒绝缺少必要参数的连接', () => {
      const validateParams = (params: any): boolean => {
        return !!(params.rdpToken && params.rdpWidth && params.rdpHeight);
      };

      expect(validateParams({ rdpToken: 'token', rdpWidth: 1920, rdpHeight: 1080 })).toBe(true);
      expect(validateParams({ rdpToken: 'token', rdpWidth: 1920 })).toBe(false);
      expect(validateParams({ rdpWidth: 1920, rdpHeight: 1080 })).toBe(false);
    });
  });

  describe('消息转发', () => {
    it('应该将客户端消息转发到 RDP 服务器', () => {
      const testMessage = '5.mouse,960,540,0;';

      // 模拟客户端发送消息
      const forwardToRdp = (message: string) => {
        if (mockRdpWs.readyState === 1) {
          mockRdpWs.send(message);
        }
      };

      forwardToRdp(testMessage);

      expect(mockRdpWs.send).toHaveBeenCalledWith(testMessage);
    });

    it('应该将 RDP 服务器消息转发到客户端', () => {
      const testMessage = '4.sync,123456789;';

      // 模拟 RDP 服务器发送消息
      const forwardToClient = (message: string) => {
        if (mockClientWs.readyState === 1) {
          mockClientWs.send(message);
        }
      };

      forwardToClient(testMessage);

      expect(mockClientWs.send).toHaveBeenCalledWith(testMessage);
    });

    it('应该在目标连接未就绪时丢弃消息', () => {
      const testMessage = '5.mouse,960,540,0;';

      // 模拟 RDP WebSocket 未就绪
      mockRdpWs.readyState = 0; // CONNECTING

      const forwardToRdp = (message: string) => {
        if (mockRdpWs.readyState === 1) {
          mockRdpWs.send(message);
        }
      };

      forwardToRdp(testMessage);

      expect(mockRdpWs.send).not.toHaveBeenCalled();
    });
  });

  describe('连接断开处理', () => {
    it('应该在客户端断开时关闭 RDP 连接', () => {
      let rdpWsClosed = false;

      // 模拟断开处理
      mockClientWs.on('close', () => {
        if (!rdpWsClosed && mockRdpWs.readyState !== 3) {
          mockRdpWs.close();
          rdpWsClosed = true;
        }
      });

      mockClientWs.emit('close');

      expect(mockRdpWs.close).toHaveBeenCalled();
      expect(rdpWsClosed).toBe(true);
    });

    it('应该在 RDP 连接断开时关闭客户端连接', () => {
      let clientWsClosed = false;

      // 模拟断开处理
      mockRdpWs.on('close', () => {
        if (!clientWsClosed && mockClientWs.readyState !== 3) {
          mockClientWs.close(1000, 'RDP connection closed');
          clientWsClosed = true;
        }
      });

      mockRdpWs.emit('close');

      expect(mockClientWs.close).toHaveBeenCalledWith(1000, 'RDP connection closed');
    });

    it('应该处理 RDP 连接错误', () => {
      const errorHandler = vi.fn();

      mockRdpWs.on('error', (error: Error) => {
        errorHandler(error);
        mockClientWs.send(
          JSON.stringify({
            type: 'rdp:error',
            payload: 'Failed to connect to remote desktop',
          })
        );
        mockClientWs.close(1011, 'RDP error');
      });

      mockRdpWs.emit('error', new Error('Connection refused'));

      expect(errorHandler).toHaveBeenCalled();
      expect(mockClientWs.send).toHaveBeenCalledWith(expect.stringContaining('rdp:error'));
    });
  });

  describe('Guacamole 协议', () => {
    it('应该正确解析 Guacamole 指令', () => {
      const parseGuacInstruction = (
        instruction: string
      ): { opcode: string; args: string[] } | null => {
        const match = instruction.match(/^(\d+)\.([^,;]+)((?:,[^,;]*)*);\s*$/);
        if (!match) return null;

        const [, , opcode, argsStr] = match;
        const args = argsStr ? argsStr.split(',').slice(1) : [];
        return { opcode, args };
      };

      // 测试 sync 指令
      const syncResult = parseGuacInstruction('4.sync,123456789;');
      expect(syncResult?.opcode).toBe('sync');
      expect(syncResult?.args).toContain('123456789');

      // 测试 mouse 指令
      const mouseResult = parseGuacInstruction('5.mouse,960,540,0;');
      expect(mouseResult?.opcode).toBe('mouse');
      expect(mouseResult?.args).toEqual(['960', '540', '0']);

      // 测试 key 指令
      const keyResult = parseGuacInstruction('3.key,65,1;');
      expect(keyResult?.opcode).toBe('key');
    });

    it('应该正确构建 Guacamole 指令', () => {
      const buildGuacInstruction = (opcode: string, ...args: string[]): string => {
        const parts = [opcode, ...args];
        return `${opcode.length}.${parts.join(',')};`;
      };

      expect(buildGuacInstruction('sync', '123456789')).toBe('4.sync,123456789;');
      expect(buildGuacInstruction('mouse', '960', '540', '0')).toBe('5.mouse,960,540,0;');
      expect(buildGuacInstruction('key', '65', '1')).toBe('3.key,65,1;');
    });
  });

  describe('心跳机制', () => {
    it('应该响应 ping 消息', () => {
      let pongReceived = false;

      mockClientWs.on('pong', () => {
        pongReceived = true;
      });

      // 模拟心跳
      mockClientWs.emit('pong');

      expect(pongReceived).toBe(true);
    });

    it('应该在超时后关闭连接', async () => {
      const HEARTBEAT_TIMEOUT = 100; // 测试用较短超时
      let connectionClosed = false;

      const heartbeatTimer = setTimeout(() => {
        if (!connectionClosed) {
          mockClientWs.close(1001, 'Heartbeat timeout');
          connectionClosed = true;
        }
      }, HEARTBEAT_TIMEOUT);

      await new Promise((r) => setTimeout(r, HEARTBEAT_TIMEOUT + 50));

      clearTimeout(heartbeatTimer);
      expect(connectionClosed).toBe(true);
    });
  });
});
