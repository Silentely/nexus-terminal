import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentValidationError, validateEnvironment } from './env.validator';

describe('env validator - RP_ID', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ENCRYPTION_KEY: 'a'.repeat(64),
      SESSION_SECRET: 'b'.repeat(128),
      RP_ORIGIN: 'https://primary.example.com',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('应允许逗号分隔的有效 RP_ID 列表', () => {
    process.env.RP_ID = 'primary.example.com,secondary.example.net';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('RP_ID 包含非法值时应报错', () => {
    process.env.RP_ID = 'https://primary.example.com,secondary.example.net';

    try {
      validateEnvironment();
      throw new Error('expected validateEnvironment to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect((error as EnvironmentValidationError).errors).toContain(
        'RP_ID 必须是有效的域名，多个值请用逗号分隔',
      );
    }
  });
});
