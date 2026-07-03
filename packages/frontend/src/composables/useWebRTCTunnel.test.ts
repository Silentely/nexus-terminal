import { describe, expect, it } from 'vitest';
import { DEFAULT_WEBRTC_CONNECT_TIMEOUT_MS, useWebRTCTunnel } from './useWebRTCTunnel';

describe('useWebRTCTunnel', () => {
  it('默认连接超时应长于后端 remote-gateway 连接窗口', () => {
    expect(DEFAULT_WEBRTC_CONNECT_TIMEOUT_MS).toBeGreaterThan(15_000);
  });

  it('应导出 WebRTC tunnel 工厂函数', () => {
    const { createTunnel, isWebRTCSupported, getDefaultICEConfig } = useWebRTCTunnel();

    expect(createTunnel).toEqual(expect.any(Function));
    expect(isWebRTCSupported).toEqual(expect.any(Function));
    expect(Array.isArray(getDefaultICEConfig())).toBe(true);
  });
});
