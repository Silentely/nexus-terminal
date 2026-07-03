/**
 * WebRTC 信令 — getICEConfig 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getICEConfig, getWeriftICEConfig } from './signaling';

describe('getICEConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // 清除自定义 STUN/TURN 环境变量
    delete process.env.WEBRTC_STUN_URLS;
    delete process.env.WEBRTC_TURN_URLS;
    delete process.env.WEBRTC_TURN_USERNAME;
    delete process.env.WEBRTC_TURN_CREDENTIAL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('应返回默认 5 个 STUN 服务器（无 TURN）', () => {
    const config = getICEConfig();

    expect(config.iceServers).toHaveLength(1);
    const urls = config.iceServers[0].urls as string[];
    expect(urls).toEqual([
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
      'stun:stun.chat.bilibili.com:3478',
      'stun:stun.miwifi.com:3478',
    ]);
    // 默认无 TURN
    expect(config.iceServers[0]).not.toHaveProperty('username');
    expect(config.iceServers[0]).not.toHaveProperty('credential');
  });

  it('WEBRTC_STUN_URLS 覆盖时应使用自定义 STUN 列表', () => {
    process.env.WEBRTC_STUN_URLS = 'stun:custom1.example.com:3478,stun:custom2.example.com:3478';

    const config = getICEConfig();

    const urls = config.iceServers[0].urls as string[];
    expect(urls).toEqual(['stun:custom1.example.com:3478', 'stun:custom2.example.com:3478']);
  });

  it('WEBRTC_STUN_URLS 应正确 trim 空格', () => {
    process.env.WEBRTC_STUN_URLS =
      'stun:a.example.com:3478 , stun:b.example.com:3478 , stun:c.example.com:3478';

    const config = getICEConfig();

    const urls = config.iceServers[0].urls as string[];
    expect(urls).toEqual([
      'stun:a.example.com:3478',
      'stun:b.example.com:3478',
      'stun:c.example.com:3478',
    ]);
  });

  it('WEBRTC_STUN_URLS 为空字符串时应返回空 STUN 列表（需自行配置）', () => {
    process.env.WEBRTC_STUN_URLS = '';

    const config = getICEConfig();

    // 空字符串经过 split/trim/filter 后为空数组（truthy），不会 fallback 到默认值
    const urls = config.iceServers[0].urls as string[];
    expect(urls).toHaveLength(0);
  });

  it('配置 TURN 服务器时应添加为第二个 iceServer', () => {
    process.env.WEBRTC_TURN_URLS = 'turn:turn.example.com:3478';
    process.env.WEBRTC_TURN_USERNAME = 'testuser';
    process.env.WEBRTC_TURN_CREDENTIAL = 'testpass';

    const config = getICEConfig();

    expect(config.iceServers).toHaveLength(2);
    expect(config.iceServers[1].urls).toEqual(['turn:turn.example.com:3478']);
    expect(config.iceServers[1].username).toBe('testuser');
    expect(config.iceServers[1].credential).toBe('testpass');
  });

  it('TURN URL 应正确 trim 空格', () => {
    process.env.WEBRTC_TURN_URLS = 'turn:a.example.com:3478 , turn:b.example.com:3478';
    process.env.WEBRTC_TURN_USERNAME = 'user';
    process.env.WEBRTC_TURN_CREDENTIAL = 'pass';

    const config = getICEConfig();

    expect(config.iceServers[1].urls).toEqual([
      'turn:a.example.com:3478',
      'turn:b.example.com:3478',
    ]);
  });

  it('WEBRTC_TURN_URLS 未设置时不应添加 TURN 条目', () => {
    process.env.WEBRTC_TURN_USERNAME = 'user';
    process.env.WEBRTC_TURN_CREDENTIAL = 'pass';

    const config = getICEConfig();

    expect(config.iceServers).toHaveLength(1);
  });

  it('WEBRTC_TURN_URLS 为空字符串时不应添加 TURN 条目', () => {
    process.env.WEBRTC_TURN_URLS = '';

    const config = getICEConfig();

    expect(config.iceServers).toHaveLength(1);
  });

  it('应将多个 ICE URL 展开为 werift 支持的单 URL 条目', () => {
    process.env.WEBRTC_STUN_URLS = 'stun:a.example.com:3478,stun:b.example.com:3478';
    process.env.WEBRTC_TURN_URLS = 'turn:turn.example.com:3478';
    process.env.WEBRTC_TURN_USERNAME = 'user';
    process.env.WEBRTC_TURN_CREDENTIAL = 'pass';

    const config = getWeriftICEConfig();

    expect(config).toEqual([
      { urls: 'stun:a.example.com:3478', username: undefined, credential: undefined },
      { urls: 'stun:b.example.com:3478', username: undefined, credential: undefined },
      { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
    ]);
    expect(config.map((server) => server.urls)).not.toContain(
      'stun:a.example.com:3478,stun:b.example.com:3478',
    );
  });
});
