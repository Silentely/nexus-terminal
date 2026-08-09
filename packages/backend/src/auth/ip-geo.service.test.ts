/**
 * auth/ip-geo.service 单元测试
 * 覆盖 IP 地理位置查询的缓存分层、私有 IP 过滤、禁用开关与格式化
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockDb = vi.hoisted(() => ({
  get: vi.fn(),
  run: vi.fn(),
}));
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue(mockDb),
  getDb: vi.fn(),
  runDb: vi.fn(),
}));

import { lookupGeoInfo, ipGeoService } from './ip-geo.service';

describe('ip-geo.service', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认启用且使用 ip-api
    process.env.ENABLE_GEO_LOOKUP = 'true';
    process.env.GEO_PROVIDER = 'ip-api';
    // mock fetch 返回地理位置
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        status: 'success',
        country: '中国',
        city: '北京',
        isp: 'China Telecom',
        as: 'AS4134',
        query: '8.8.8.8',
      }),
    });
    // 清空内存缓存（通过直接操作单例内部不可行，这里依赖每次测试新环境）
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    (ipGeoService as unknown as { memCache: Map<string, unknown> }).memCache.clear();
  });

  it('空 IP 应返回 undefined', async () => {
    expect(await lookupGeoInfo(null)).toBeUndefined();
    expect(await lookupGeoInfo(undefined)).toBeUndefined();
  });

  it('禁用时应返回 undefined', async () => {
    process.env.ENABLE_GEO_LOOKUP = 'false';
    expect(await lookupGeoInfo('8.8.8.8')).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('私有 IP 不应查询 API', async () => {
    expect(await lookupGeoInfo('192.168.1.1')).toBeUndefined();
    expect(await lookupGeoInfo('127.0.0.1')).toBeUndefined();
    expect(await lookupGeoInfo('10.0.0.5')).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('公网 IP 应查询 API 并格式化结果', async () => {
    const result = await lookupGeoInfo('8.8.8.8');

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(result).toBe('中国, 北京 | AS4134');
  });

  it('查询结果应写入内存缓存（第二次不重复请求）', async () => {
    await lookupGeoInfo('8.8.8.8');
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 第二次查询命中 L1 缓存，不重复调用 API
    await lookupGeoInfo('8.8.8.8');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('API 返回非 ok 时应静默返回 undefined', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    expect(await lookupGeoInfo('8.8.8.8')).toBeUndefined();
  });

  it('API 抛错时应静默返回 undefined', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    expect(await lookupGeoInfo('8.8.8.8')).toBeUndefined();
  });
});
