/**
 * Guacamole 共用工具单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  charToKeysym,
  clearDisplayElement,
  isLowEndDevice,
  mapGuacamoleClientState,
  normalizeGuacamoleStatus,
  SPECIAL_KEYSYMS,
  buildRemoteDesktopWsBase,
  buildRdpProxyTunnelUrl,
  type NavigatorWithDeviceMemory,
} from './guacamoleHelpers';

describe('guacamoleHelpers', () => {
  describe('normalizeGuacamoleStatus', () => {
    it('应从对象中提取 code 与 message', () => {
      expect(normalizeGuacamoleStatus({ code: 519, message: 'timeout' })).toEqual({
        code: 519,
        message: 'timeout',
      });
    });

    it('对非对象应返回空对象', () => {
      expect(normalizeGuacamoleStatus(null)).toEqual({});
      expect(normalizeGuacamoleStatus('err')).toEqual({});
      expect(normalizeGuacamoleStatus(42)).toEqual({});
    });
  });

  describe('charToKeysym', () => {
    it('应映射特殊控制字符', () => {
      expect(charToKeysym('\n')).toBe(SPECIAL_KEYSYMS['\n']);
      expect(charToKeysym('\t')).toBe(SPECIAL_KEYSYMS['\t']);
      expect(charToKeysym('\b')).toBe(SPECIAL_KEYSYMS['\b']);
      expect(charToKeysym('\x1b')).toBe(SPECIAL_KEYSYMS['\x1b']);
    });

    it('对可打印 ASCII 应返回 charCode', () => {
      expect(charToKeysym('A')).toBe(65);
      expect(charToKeysym('a')).toBe(97);
      expect(charToKeysym(' ')).toBe(32);
    });

    it('空字符串应返回 0 而非 NaN', () => {
      expect(charToKeysym('')).toBe(0);
      expect(Number.isNaN(charToKeysym(''))).toBe(false);
    });
  });

  describe('mapGuacamoleClientState', () => {
    it('应映射完整状态机', () => {
      expect(mapGuacamoleClientState(0)).toEqual({
        connectionStatus: 'disconnected',
        i18nKeyPart: 'idle',
      });
      expect(mapGuacamoleClientState(1, 'connectingRdp')).toEqual({
        connectionStatus: 'connecting',
        i18nKeyPart: 'connectingRdp',
      });
      expect(mapGuacamoleClientState(1, 'connectingVnc')).toEqual({
        connectionStatus: 'connecting',
        i18nKeyPart: 'connectingVnc',
      });
      expect(mapGuacamoleClientState(2).connectionStatus).toBe('connecting');
      expect(mapGuacamoleClientState(3).connectionStatus).toBe('connected');
      expect(mapGuacamoleClientState(4).connectionStatus).toBe('disconnected');
      expect(mapGuacamoleClientState(5).i18nKeyPart).toBe('disconnected');
      expect(mapGuacamoleClientState(99).i18nKeyPart).toBe('unknownState');
    });
  });

  describe('clearDisplayElement', () => {
    it('应移除全部子节点', () => {
      const el = document.createElement('div');
      el.appendChild(document.createElement('span'));
      el.appendChild(document.createElement('canvas'));
      clearDisplayElement(el);
      expect(el.childNodes.length).toBe(0);
    });

    it('对 null/undefined 应安全返回', () => {
      expect(() => clearDisplayElement(null)).not.toThrow();
      expect(() => clearDisplayElement(undefined)).not.toThrow();
    });
  });

  describe('isLowEndDevice', () => {
    const asNav = (partial: Partial<NavigatorWithDeviceMemory>): NavigatorWithDeviceMemory =>
      partial as NavigatorWithDeviceMemory;

    it('核心数或内存偏低时应判定为低端', () => {
      expect(isLowEndDevice(asNav({ hardwareConcurrency: 2, deviceMemory: 8 }))).toBe(true);
      expect(isLowEndDevice(asNav({ hardwareConcurrency: 8, deviceMemory: 2 }))).toBe(true);
    });

    it('信息缺失或充足时不应误判', () => {
      expect(isLowEndDevice(asNav({ hardwareConcurrency: 0, deviceMemory: 0 }))).toBe(false);
      expect(isLowEndDevice(asNav({ hardwareConcurrency: 8, deviceMemory: 8 }))).toBe(false);
    });
  });

  describe('buildRemoteDesktopWsBase / buildRdpProxyTunnelUrl', () => {
    const originalLocation = window.location;

    beforeEach(() => {
      // jsdom 下可重定义 location
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          protocol: 'https:',
          host: 'example.test',
        },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    });

    it('应基于当前页面构建 wss 基址', () => {
      expect(buildRemoteDesktopWsBase()).toBe('wss://example.test/ws');
    });

    it('应拼装 token/width/height/dpi 查询参数', () => {
      const url = buildRdpProxyTunnelUrl('tok&en', 1024, 768, 96);
      expect(url.startsWith('wss://example.test/ws/rdp-proxy?')).toBe(true);
      expect(url).toContain('token=tok%26en');
      expect(url).toContain('width=1024');
      expect(url).toContain('height=768');
      expect(url).toContain('dpi=96');
    });

    it('无 dpi 时不应附带 dpi 参数', () => {
      const url = buildRdpProxyTunnelUrl('abc', 800, 600);
      expect(url).not.toContain('dpi=');
    });

    it('非法宽高应回退安全默认值', () => {
      const url = buildRdpProxyTunnelUrl('t', Number.NaN, -1);
      expect(url).toContain('width=800');
      expect(url).toContain('height=600');
    });
  });
});
