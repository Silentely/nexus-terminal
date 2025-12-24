/**
 * Passkey Service 单元测试
 * 测试 WebAuthn Passkey 认证的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PasskeyService } from './passkey.service';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const mockPasskeyRepo = vi.hoisted(() => ({
  getPasskeysByUserId: vi.fn(),
  getPasskeyByCredentialId: vi.fn(),
  createPasskey: vi.fn(),
  updatePasskeyCounter: vi.fn(),
  updatePasskeyLastUsedAt: vi.fn(),
  updatePasskeyName: vi.fn(),
  deletePasskey: vi.fn(),
  getFirstPasskey: vi.fn(),
}));

const mockUserRepo = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findUserByUsername: vi.fn(),
}));

const mockSimpleWebAuthn = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

// Mock 依赖模块
vi.mock('./passkey.repository', () => ({
  passkeyRepository: mockPasskeyRepo,
}));

vi.mock('../user/user.repository', () => ({
  userRepository: mockUserRepo,
}));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: mockSimpleWebAuthn.generateRegistrationOptions,
  verifyRegistrationResponse: mockSimpleWebAuthn.verifyRegistrationResponse,
  generateAuthenticationOptions: mockSimpleWebAuthn.generateAuthenticationOptions,
  verifyAuthenticationResponse: mockSimpleWebAuthn.verifyAuthenticationResponse,
}));

vi.mock('../config/app.config', () => ({
  config: {
    rpId: 'localhost',
    rpOrigin: 'http://localhost:3000',
    appName: 'Nexus Terminal Test',
  },
}));

describe('PasskeyService', () => {
  let service: PasskeyService;
  const mockUser = { id: 1, username: 'testuser', hashed_password: 'hash' };
  const mockPasskey = {
    id: 1,
    user_id: 1,
    credential_id: 'credential-123',
    public_key: 'base64PublicKey',
    counter: 0,
    transports: '["internal"]',
    backed_up: false,
    name: 'My Passkey',
    created_at: '2024-01-01',
    last_used_at: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PasskeyService(mockPasskeyRepo as any, mockUserRepo as any);
  });

  describe('generateRegistrationOptions', () => {
    it('应为有效用户生成注册选项', async () => {
      mockUserRepo.findUserById.mockResolvedValue(mockUser);
      mockPasskeyRepo.getPasskeysByUserId.mockResolvedValue([]);
      mockSimpleWebAuthn.generateRegistrationOptions.mockResolvedValue({
        challenge: 'challenge123',
        rp: { name: 'Nexus Terminal Test', id: 'localhost' },
        user: { id: 'MQ', name: 'testuser', displayName: 'testuser' },
      });

      const result = await service.generateRegistrationOptions('testuser', 1);

      expect(result).toHaveProperty('challenge');
      expect(mockSimpleWebAuthn.generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpName: 'Nexus Terminal Test',
          rpID: 'localhost',
          userName: 'testuser',
        })
      );
    });

    it('用户不存在时应抛出错误', async () => {
      mockUserRepo.findUserById.mockResolvedValue(null);

      await expect(service.generateRegistrationOptions('testuser', 1)).rejects.toThrow(
        'User not found or username mismatch'
      );
    });

    it('用户名不匹配时应抛出错误', async () => {
      mockUserRepo.findUserById.mockResolvedValue({ ...mockUser, username: 'otheruser' });

      await expect(service.generateRegistrationOptions('testuser', 1)).rejects.toThrow(
        'User not found or username mismatch'
      );
    });

    it('应排除已存在的凭证', async () => {
      mockUserRepo.findUserById.mockResolvedValue(mockUser);
      mockPasskeyRepo.getPasskeysByUserId.mockResolvedValue([mockPasskey]);
      mockSimpleWebAuthn.generateRegistrationOptions.mockResolvedValue({
        challenge: 'challenge123',
      });

      await service.generateRegistrationOptions('testuser', 1);

      expect(mockSimpleWebAuthn.generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: expect.arrayContaining([
            expect.objectContaining({
              id: 'credential-123',
              type: 'public-key',
            }),
          ]),
        })
      );
    });
  });

  describe('verifyRegistration', () => {
    const mockRegistrationResponse = {
      registrationResponse: {
        id: 'new-credential-id',
        rawId: 'rawId',
        response: { clientDataJSON: 'data', attestationObject: 'attestation' },
        type: 'public-key',
      },
    };

    it('应验证成功的注册并返回新 Passkey 数据', async () => {
      mockUserRepo.findUserById.mockResolvedValue(mockUser);
      mockSimpleWebAuthn.verifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            publicKey: new Uint8Array([1, 2, 3]),
            id: 'new-credential-id',
            counter: 0,
            transports: ['internal'],
          },
          credentialBackedUp: true,
        },
      });

      const result = await service.verifyRegistration(
        mockRegistrationResponse as any,
        'expected-challenge',
        '1'
      );

      expect(result.verified).toBe(true);
      expect(result.newPasskeyToSave).toBeDefined();
      expect(result.newPasskeyToSave?.user_id).toBe(1);
      expect(result.newPasskeyToSave?.credential_id).toBe('new-credential-id');
    });

    it('无效的用户 handle 应抛出错误', async () => {
      await expect(
        service.verifyRegistration(mockRegistrationResponse as any, 'challenge', 'invalid')
      ).rejects.toThrow('Invalid user handle provided.');
    });

    it('用户不存在时应抛出错误', async () => {
      mockUserRepo.findUserById.mockResolvedValue(null);

      await expect(
        service.verifyRegistration(mockRegistrationResponse as any, 'challenge', '1')
      ).rejects.toThrow('User not found for the provided handle.');
    });

    it('缺少凭证 ID 时应抛出错误', async () => {
      mockUserRepo.findUserById.mockResolvedValue(mockUser);
      const invalidResponse = { registrationResponse: {} };

      await expect(
        service.verifyRegistration(invalidResponse as any, 'challenge', '1')
      ).rejects.toThrow('Missing or malformed credential ID from client');
    });
  });

  describe('generateAuthenticationOptions', () => {
    it('应为已知用户生成认证选项', async () => {
      mockUserRepo.findUserByUsername.mockResolvedValue(mockUser);
      mockPasskeyRepo.getPasskeysByUserId.mockResolvedValue([mockPasskey]);
      mockSimpleWebAuthn.generateAuthenticationOptions.mockResolvedValue({
        challenge: 'auth-challenge',
        allowCredentials: [{ id: 'credential-123', type: 'public-key' }],
      });

      const result = await service.generateAuthenticationOptions('testuser');

      expect(result).toHaveProperty('challenge');
      expect(mockSimpleWebAuthn.generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'localhost',
          allowCredentials: expect.arrayContaining([
            expect.objectContaining({
              id: 'credential-123',
              type: 'public-key',
            }),
          ]),
        })
      );
    });

    it('无用户名时应生成可发现凭证选项', async () => {
      mockSimpleWebAuthn.generateAuthenticationOptions.mockResolvedValue({
        challenge: 'discoverable-challenge',
      });

      const result = await service.generateAuthenticationOptions();

      expect(result).toHaveProperty('challenge');
      expect(mockSimpleWebAuthn.generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: undefined,
        })
      );
    });

    it('用户不存在时应生成无限制的认证选项', async () => {
      mockUserRepo.findUserByUsername.mockResolvedValue(null);
      mockSimpleWebAuthn.generateAuthenticationOptions.mockResolvedValue({
        challenge: 'challenge',
      });

      await service.generateAuthenticationOptions('nonexistent');

      expect(mockSimpleWebAuthn.generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: undefined,
        })
      );
    });
  });

  describe('verifyAuthentication', () => {
    const mockAuthResponse = {
      id: 'credential-123',
      response: {
        authenticatorData: 'YXV0aGVudGljYXRvckRhdGFBdXRoZW50aWNhdG9yRGF0YUF1dGhlbnRpY2F0b3JEYXRh',
        clientDataJSON: 'clientData',
        signature: 'signature',
      },
    };

    it('应成功验证认证并更新计数器', async () => {
      mockPasskeyRepo.getPasskeyByCredentialId.mockResolvedValue(mockPasskey);
      mockSimpleWebAuthn.verifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });
      mockPasskeyRepo.updatePasskeyCounter.mockResolvedValue(undefined);
      mockPasskeyRepo.updatePasskeyLastUsedAt.mockResolvedValue(undefined);

      const result = await service.verifyAuthentication(mockAuthResponse as any, 'challenge');

      expect(result.verified).toBe(true);
      expect(result.passkey).toBeDefined();
      expect(result.userId).toBe(1);
      expect(mockPasskeyRepo.updatePasskeyCounter).toHaveBeenCalledWith('credential-123', 1);
      expect(mockPasskeyRepo.updatePasskeyLastUsedAt).toHaveBeenCalledWith('credential-123');
    });

    it('缺少凭证 ID 时应抛出错误', async () => {
      const invalidResponse = { response: {} };

      await expect(
        service.verifyAuthentication(invalidResponse as any, 'challenge')
      ).rejects.toThrow('Credential ID missing from authentication response.');
    });

    it('找不到 Passkey 时应抛出错误', async () => {
      mockPasskeyRepo.getPasskeyByCredentialId.mockResolvedValue(null);

      await expect(
        service.verifyAuthentication(mockAuthResponse as any, 'challenge')
      ).rejects.toThrow('Authentication failed. Passkey not found.');
    });

    it('验证失败时应抛出错误', async () => {
      mockPasskeyRepo.getPasskeyByCredentialId.mockResolvedValue(mockPasskey);
      mockSimpleWebAuthn.verifyAuthenticationResponse.mockResolvedValue({
        verified: false,
      });

      await expect(
        service.verifyAuthentication(mockAuthResponse as any, 'challenge')
      ).rejects.toThrow('Authentication failed.');
    });
  });

  describe('listPasskeysByUserId', () => {
    it('应返回用户的 Passkey 列表（过滤敏感信息）', async () => {
      mockPasskeyRepo.getPasskeysByUserId.mockResolvedValue([mockPasskey]);

      const result = await service.listPasskeysByUserId(1);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('credential_id');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).not.toHaveProperty('public_key');
    });

    it('无 Passkey 时应返回空数组', async () => {
      mockPasskeyRepo.getPasskeysByUserId.mockResolvedValue([]);

      const result = await service.listPasskeysByUserId(1);

      expect(result).toEqual([]);
    });
  });

  describe('deletePasskey', () => {
    it('应成功删除用户自己的 Passkey', async () => {
      mockPasskeyRepo.getPasskeyByCredentialId.mockResolvedValue(mockPasskey);
      mockPasskeyRepo.deletePasskey.mockResolvedValue(true);

      const result = await service.deletePasskey(1, 'credential-123');

      expect(result).toBe(true);
      expect(mockPasskeyRepo.deletePasskey).toHaveBeenCalledWith('credential-123');
    });

    it('Passkey 不存在时应抛出错误', async () => {
      mockPasskeyRepo.getPasskeyByCredentialId.mockResolvedValue(null);

      await expect(service.deletePasskey(1, 'nonexistent')).rejects.toThrow('Passkey not found.');
    });

    it('尝试删除他人的 Passkey 时应抛出错误', async () => {
      mockPasskeyRepo.getPasskeyByCredentialId.mockResolvedValue({
        ...mockPasskey,
        user_id: 2,
      });

      await expect(service.deletePasskey(1, 'credential-123')).rejects.toThrow(
        'Unauthorized to delete this passkey.'
      );
    });
  });

  describe('updatePasskeyName', () => {
    it('应成功更新 Passkey 名称', async () => {
      mockPasskeyRepo.getPasskeyByCredentialId.mockResolvedValue(mockPasskey);
      mockPasskeyRepo.updatePasskeyName.mockResolvedValue(undefined);

      await service.updatePasskeyName(1, 'credential-123', 'New Name');

      expect(mockPasskeyRepo.updatePasskeyName).toHaveBeenCalledWith('credential-123', 'New Name');
    });

    it('Passkey 不存在时应抛出错误', async () => {
      mockPasskeyRepo.getPasskeyByCredentialId.mockResolvedValue(null);

      await expect(service.updatePasskeyName(1, 'nonexistent', 'Name')).rejects.toThrow(
        'Passkey not found.'
      );
    });

    it('尝试更新他人的 Passkey 时应抛出错误', async () => {
      mockPasskeyRepo.getPasskeyByCredentialId.mockResolvedValue({
        ...mockPasskey,
        user_id: 2,
      });

      await expect(service.updatePasskeyName(1, 'credential-123', 'Name')).rejects.toThrow(
        'Unauthorized to update this passkey name.'
      );
    });
  });

  describe('hasPasskeysConfigured', () => {
    it('用户有 Passkey 时应返回 true', async () => {
      mockUserRepo.findUserByUsername.mockResolvedValue(mockUser);
      mockPasskeyRepo.getPasskeysByUserId.mockResolvedValue([mockPasskey]);

      const result = await service.hasPasskeysConfigured('testuser');

      expect(result).toBe(true);
    });

    it('用户无 Passkey 时应返回 false', async () => {
      mockUserRepo.findUserByUsername.mockResolvedValue(mockUser);
      mockPasskeyRepo.getPasskeysByUserId.mockResolvedValue([]);

      const result = await service.hasPasskeysConfigured('testuser');

      expect(result).toBe(false);
    });

    it('用户不存在时应返回 false', async () => {
      mockUserRepo.findUserByUsername.mockResolvedValue(null);

      const result = await service.hasPasskeysConfigured('nonexistent');

      expect(result).toBe(false);
    });

    it('无用户名时应检查系统是否有任何 Passkey', async () => {
      mockPasskeyRepo.getFirstPasskey.mockResolvedValue(mockPasskey);

      const result = await service.hasPasskeysConfigured();

      expect(result).toBe(true);
      expect(mockPasskeyRepo.getFirstPasskey).toHaveBeenCalled();
    });

    it('系统无任何 Passkey 时应返回 false', async () => {
      mockPasskeyRepo.getFirstPasskey.mockResolvedValue(null);

      const result = await service.hasPasskeysConfigured();

      expect(result).toBe(false);
    });
  });
});
