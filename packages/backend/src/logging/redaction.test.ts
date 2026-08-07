/**
 * redaction.ts 单元测试
 * 覆盖字符串内容脱敏（URL query 参数、内嵌账号密码）与对象 key 脱敏
 */
import { describe, it, expect } from 'vitest';
import { redactSensitiveData, redactLogArgs, redactUrlForLog } from './redaction';

describe('logging/redaction', () => {
  describe('对象 key 脱敏', () => {
    it('应对敏感字段名脱敏', () => {
      const input = { password: 'x', token: 'y', normal: 'ok' };
      const result = redactSensitiveData(input) as Record<string, unknown>;
      expect(result.password).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.normal).toBe('ok');
    });

    it('应递归处理嵌套对象', () => {
      const input = { config: { apiKey: 'abc' }, name: 'n' };
      const result = redactSensitiveData(input) as {
        config: Record<string, unknown>;
      };
      expect(result.config.apiKey).toBe('[REDACTED]');
    });
  });

  describe('字符串内容脱敏', () => {
    it('应脱敏 URL query 中的 signature 参数', () => {
      const result = redactSensitiveData(
        'https://example.com/hook?signature=abc123def456&event=test',
      );
      expect(result).toBe('https://example.com/hook?signature=[REDACTED]&event=test');
    });

    it('应脱敏 URL query 中的 key 参数', () => {
      const result = redactSensitiveData('https://example.com/cb?key=secret-key-xyz');
      expect(result).toContain('key=[REDACTED]');
      expect(result).not.toContain('secret-key-xyz');
    });

    it('应脱敏 URL query 中的 access_token 参数', () => {
      const result = redactSensitiveData('https://example.com/api?access_token=token-abc');
      expect(result).toContain('access_token=[REDACTED]');
      expect(result).not.toContain('token-abc');
    });

    it('应脱敏 URL 内嵌账号密码', () => {
      const result = redactSensitiveData('https://user:pass123@example.com/resource');
      expect(result).toBe('https://user:[REDACTED]@example.com/resource');
    });

    it('应脱敏 key=value 形式的裸字符串', () => {
      const result = redactSensitiveData('token=abc123 some words');
      expect(result).toContain('token=[REDACTED]');
      expect(result).not.toContain('abc123');
    });

    it('应脱敏 Bearer token', () => {
      const result = redactSensitiveData('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9');
      expect(result).toContain('Bearer [REDACTED]');
    });

    it('不包含敏感信息时应原样保留', () => {
      const input = 'Sending POST notification to webhook URL: https://hooks.example.com/receive';
      const result = redactSensitiveData(input);
      expect(result).toBe(input);
    });
  });

  describe('redactUrlForLog', () => {
    it('应脱敏 URL query 中的敏感参数', () => {
      expect(redactUrlForLog('https://example.com/hook?signature=abc&event=x')).toBe(
        'https://example.com/hook?signature=[REDACTED]&event=x',
      );
    });

    it('应脱敏 URL 内嵌账号密码', () => {
      expect(redactUrlForLog('https://user:pass123@example.com/resource')).toBe(
        'https://user:[REDACTED]@example.com/resource',
      );
    });

    it('不敏感 URL 应保持不变', () => {
      const url = 'https://hooks.example.com/receive';
      expect(redactUrlForLog(url)).toBe(url);
    });
  });

  describe('边界与健壮性', () => {
    it('应处理 null/undefined/非字符串', () => {
      expect(redactSensitiveData(null)).toBeNull();
      expect(redactSensitiveData(undefined)).toBeUndefined();
      expect(redactSensitiveData(42)).toBe(42);
    });

    it('应保护循环引用', () => {
      const circular: Record<string, unknown> = { name: 'a' };
      circular.self = circular;
      const result = redactSensitiveData(circular) as Record<string, unknown>;
      expect(result.self).toBe('[Circular Reference]');
    });

    it('redactLogArgs 应逐参数脱敏', () => {
      const args = [{ password: 'secret' }, 'https://x.com/hook?signature=xyz', 'plain'];
      const result = redactLogArgs(args);
      expect(result[0]).toEqual({ password: '[REDACTED]' });
      expect(result[1]).toContain('signature=[REDACTED]');
      expect(result[2]).toBe('plain');
    });
  });
});
