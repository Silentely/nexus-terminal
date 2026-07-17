/**
 * WebSocket 连接元信息工具测试
 */
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  detectClientType,
  getConnectionRequestMeta,
  getRateLimitKey,
  isClientType,
} from './connection-meta';
import type { AuthenticatedWebSocket } from './types';

describe('connection-meta', () => {
  describe('isClientType', () => {
    it('仅接受 desktop/mobile', () => {
      expect(isClientType('desktop')).toBe(true);
      expect(isClientType('mobile')).toBe(true);
      expect(isClientType('tablet')).toBe(false);
      expect(isClientType(null)).toBe(false);
      expect(isClientType(1)).toBe(false);
    });
  });

  describe('getRateLimitKey', () => {
    it('优先使用 sessionId', () => {
      const ws = { sessionId: 'sid-1', userId: 9 } as AuthenticatedWebSocket;
      expect(getRateLimitKey(ws)).toBe('sid-1');
    });

    it('无 sessionId 时回退到 userId', () => {
      const ws = { userId: 42 } as AuthenticatedWebSocket;
      expect(getRateLimitKey(ws)).toBe('ws_42');
    });

    it('均缺失时使用 anon', () => {
      const ws = {} as AuthenticatedWebSocket;
      expect(getRateLimitKey(ws)).toBe('ws_anon');
    });
  });

  describe('detectClientType', () => {
    it('应识别常见移动 UA', () => {
      expect(detectClientType('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)')).toBe(
        'mobile',
      );
      expect(detectClientType('Mozilla/5.0 (Linux; Android 13) Chrome/120.0')).toBe('mobile');
      expect(detectClientType('iPad; CPU OS 15_0')).toBe('mobile');
    });

    it('桌面 UA 应返回 desktop', () => {
      expect(
        detectClientType(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120',
        ),
      ).toBe('desktop');
    });
  });

  describe('getConnectionRequestMeta', () => {
    it('应透传升级阶段写入的字段', () => {
      const request = {
        clientType: 'mobile',
        isRdpProxy: true,
        clientIpAddress: '1.2.3.4',
      } as Request & {
        clientType: string;
        isRdpProxy: boolean;
        clientIpAddress: string;
      };

      const meta = getConnectionRequestMeta(request);
      expect(meta.clientType).toBe('mobile');
      expect(meta.isRdpProxy).toBe(true);
      expect(meta.clientIpAddress).toBe('1.2.3.4');
    });
  });
});
