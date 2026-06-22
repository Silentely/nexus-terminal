import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('app config - passkey rp configs', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('应支持单 RP_ID 映射多个 RP_ORIGIN', async () => {
    process.env.RP_ID = 'primary.example.com';
    process.env.RP_ORIGIN = 'https://primary.example.com, https://secondary.example.net';

    const { config, getPasskeyRelatedOriginsForRpId } = await import('./app.config');

    expect(config.passkeyRpConfigs).toHaveLength(2);
    expect(config.passkeyRpConfigs[0]).toMatchObject({
      rpId: 'primary.example.com',
      rpOrigin: 'https://primary.example.com',
      normalizedRpOrigin: 'https://primary.example.com',
      rpOriginHostname: 'primary.example.com',
    });
    expect(config.passkeyRpConfigs[1]).toMatchObject({
      rpId: 'primary.example.com',
      rpOrigin: 'https://secondary.example.net',
      normalizedRpOrigin: 'https://secondary.example.net',
      rpOriginHostname: 'secondary.example.net',
    });

    expect(getPasskeyRelatedOriginsForRpId('primary.example.com')).toEqual([
      'https://secondary.example.net',
    ]);
  });

  it('多 RP_ID 与 RP_ORIGIN 数量不一致时应快速失败', async () => {
    process.env.RP_ID = 'primary.example.com,secondary.example.net';
    process.env.RP_ORIGIN = 'https://primary.example.com';

    await expect(import('./app.config')).rejects.toThrow(
      'RP_ID and RP_ORIGIN must have the same number of entries',
    );
  });
});
