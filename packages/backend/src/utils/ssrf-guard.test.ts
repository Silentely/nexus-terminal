import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dns/promises 用于 SSRF 测试
vi.mock('dns/promises', () => ({
  default: {
    resolve4: vi.fn().mockResolvedValue([]),
    resolve6: vi.fn().mockResolvedValue([]),
  },
}));

// Mock logger 避免测试输出噪音
vi.mock('./logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock axios
vi.mock('axios', () => ({
  default: vi.fn(),
}));

import dns from 'dns/promises';
import axios from 'axios';
import { safeHttpGet, safeHttpPost, cleanupDnsCache, createPinnedLookup } from './ssrf-guard';

describe('ssrf-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupDnsCache();
  });

  describe('safeHttpGet', () => {
    it('应阻止私有 IP 的请求', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['192.168.1.100']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      await expect(safeHttpGet('http://internal.example.com/api')).rejects.toThrow(
        '目标地址解析到不允许的网络范围',
      );
    });

    it('应阻止 DNS 解析失败的请求', async () => {
      vi.mocked(dns.resolve4).mockRejectedValue(new Error('ENOTFOUND'));
      vi.mocked(dns.resolve6).mockRejectedValue(new Error('ENOTFOUND'));

      await expect(safeHttpGet('https://api.openai.com/')).rejects.toThrow(
        '目标域名无法解析，无法验证地址安全性，请求已阻止。',
      );
    });

    it('应允许公网域名的请求', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['142.250.80.46']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);
      vi.mocked(axios).mockResolvedValue({
        status: 200,
        data: 'ok',
        headers: {},
        config: {},
        statusText: 'OK',
      });

      const response = await safeHttpGet('https://api.openai.com/test');
      expect(response.status).toBe(200);
      expect(axios).toHaveBeenCalled();
    });

    it('应阻止回环地址的请求', async () => {
      await expect(safeHttpGet('http://127.0.0.1/admin')).rejects.toThrow(
        '目标地址解析到不允许的网络范围',
      );
    });

    it('应阻止链路本地地址的请求', async () => {
      await expect(safeHttpGet('http://169.254.169.254/metadata')).rejects.toThrow(
        '目标地址解析到不允许的网络范围',
      );
    });

    it('应传递请求配置到 axios', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['142.250.80.46']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);
      vi.mocked(axios).mockResolvedValue({
        status: 200,
        data: 'ok',
        headers: {},
        config: {},
        statusText: 'OK',
      });

      await safeHttpGet('https://api.openai.com/test', {
        timeout: 5000,
        headers: { Authorization: 'Bearer test' },
      });

      expect(axios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.openai.com/test',
          timeout: 5000,
          headers: { Authorization: 'Bearer test' },
          maxRedirects: 0,
        }),
      );
    });
  });

  describe('safeHttpPost', () => {
    it('应阻止私有 IP 的 POST 请求', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['10.0.0.1']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);

      await expect(
        safeHttpPost('http://internal.example.com/api', { data: 'test' }),
      ).rejects.toThrow('目标地址解析到不允许的网络范围');
    });

    it('应允许公网域名的 POST 请求', async () => {
      vi.mocked(dns.resolve4).mockResolvedValue(['142.250.80.46']);
      vi.mocked(dns.resolve6).mockResolvedValue([]);
      vi.mocked(axios).mockResolvedValue({
        status: 200,
        data: { ok: true },
        headers: {},
        config: {},
        statusText: 'OK',
      });

      const response = await safeHttpPost('https://api.telegram.org/bot123/sendMessage', {
        chat_id: 123,
        text: 'test',
      });
      expect(response.status).toBe(200);
    });
  });

  describe('createPinnedLookup', () => {
    it('空地址数组应抛出明确错误', () => {
      expect(() => createPinnedLookup([])).toThrow('DNS 绑定失败：未解析到任何有效 IP 地址');
    });

    it('undefined 地址数组应抛出明确错误', () => {
      expect(() => createPinnedLookup(undefined as unknown as string[])).toThrow(
        'DNS 绑定失败：未解析到任何有效 IP 地址',
      );
    });

    it('all:true 时 IPv4 应返回数组格式（http.Agent 实际行为）', () => {
      const lookup = createPinnedLookup(['142.250.80.46']);
      const callback = vi.fn();
      lookup('example.com', { all: true }, callback);
      expect(callback).toHaveBeenCalledWith(null, [{ address: '142.250.80.46', family: 4 }]);
    });

    it('all:true 时 IPv6 应返回数组格式且 family 6', () => {
      const lookup = createPinnedLookup(['2607:f8b0:4004:800::200e']);
      const callback = vi.fn();
      lookup('example.com', { all: true }, callback);
      expect(callback).toHaveBeenCalledWith(null, [
        { address: '2607:f8b0:4004:800::200e', family: 6 },
      ]);
    });

    it('all:false 时应返回旧格式 (address, family)', () => {
      const lookup = createPinnedLookup(['142.250.80.46']);
      const callback = vi.fn();
      lookup('example.com', { all: false }, callback);
      expect(callback).toHaveBeenCalledWith(null, '142.250.80.46', 4);
    });
  });

  describe('cleanupDnsCache', () => {
    it('应清理过期的缓存条目', () => {
      // cleanupDnsCache 不应抛出错误
      expect(() => cleanupDnsCache()).not.toThrow();
    });
  });
});
