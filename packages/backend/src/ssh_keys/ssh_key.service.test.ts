/**
 * SSH Key Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock SSH Key Repository
vi.mock('./ssh_key.repository', () => ({
  createSshKey: vi.fn(),
  findSshKeyById: vi.fn(),
  findAllSshKeyNames: vi.fn(),
  findAllSshKeys: vi.fn(),
  updateSshKey: vi.fn(),
  deleteSshKey: vi.fn(),
}));

// Mock crypto utils
vi.mock('../utils/crypto', () => ({
  encrypt: vi.fn((value: string) => `encrypted_${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted_', '')),
}));

import * as SshKeyRepository from './ssh_key.repository';
import { encrypt, decrypt } from '../utils/crypto';
import {
  createSshKey,
  getAllSshKeyNames,
  getSshKeyDbRowById,
  getDecryptedSshKeyById,
  updateSshKey,
  deleteSshKey,
  getAllDecryptedSshKeys,
} from './ssh_key.service';

describe('SSH Key Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockDbRow = {
    id: 1,
    name: 'My SSH Key',
    encrypted_private_key: 'encrypted_privatekey',
    encrypted_passphrase: 'encrypted_passphrase',
    created_at: 1000,
    updated_at: 1000,
  };

  describe('createSshKey', () => {
    it('应成功创建 SSH 密钥并加密凭证', async () => {
      (SshKeyRepository.createSshKey as any).mockResolvedValueOnce(5);

      const result = await createSshKey({
        name: 'New Key',
        private_key: 'my_private_key',
        passphrase: 'my_passphrase',
      });

      expect(result).toEqual({ id: 5, name: 'New Key' });
      expect(encrypt).toHaveBeenCalledWith('my_private_key');
      expect(encrypt).toHaveBeenCalledWith('my_passphrase');
      expect(SshKeyRepository.createSshKey).toHaveBeenCalledWith({
        name: 'New Key',
        encrypted_private_key: 'encrypted_my_private_key',
        encrypted_passphrase: 'encrypted_my_passphrase',
      });
    });

    it('应支持无密码短语的密钥', async () => {
      (SshKeyRepository.createSshKey as any).mockResolvedValueOnce(6);

      const result = await createSshKey({
        name: 'Key Without Pass',
        private_key: 'my_key',
      });

      expect(result).toEqual({ id: 6, name: 'Key Without Pass' });
      expect(SshKeyRepository.createSshKey).toHaveBeenCalledWith({
        name: 'Key Without Pass',
        encrypted_private_key: 'encrypted_my_key',
        encrypted_passphrase: null,
      });
    });

    it('缺少名称应抛出异常', async () => {
      await expect(createSshKey({ name: '', private_key: 'key' })).rejects.toThrow(
        '必须提供密钥名称和私钥内容。'
      );
    });

    it('缺少私钥应抛出异常', async () => {
      await expect(createSshKey({ name: 'Test', private_key: '' })).rejects.toThrow(
        '必须提供密钥名称和私钥内容。'
      );
    });

    it('名称重复时应抛出友好异常', async () => {
      (SshKeyRepository.createSshKey as any).mockRejectedValueOnce(
        new Error('UNIQUE constraint failed: ssh_keys.name')
      );

      await expect(createSshKey({ name: 'Duplicate', private_key: 'key' })).rejects.toThrow(
        'SSH 密钥名称 "Duplicate" 已存在。'
      );
    });
  });

  describe('getAllSshKeyNames', () => {
    it('应返回所有密钥名称列表', async () => {
      const mockNames = [
        { id: 1, name: 'Key A' },
        { id: 2, name: 'Key B' },
      ];
      (SshKeyRepository.findAllSshKeyNames as any).mockResolvedValueOnce(mockNames);

      const result = await getAllSshKeyNames();

      expect(result).toEqual(mockNames);
      expect(SshKeyRepository.findAllSshKeyNames).toHaveBeenCalled();
    });
  });

  describe('getSshKeyDbRowById', () => {
    it('应返回数据库原始行数据', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(mockDbRow);

      const result = await getSshKeyDbRowById(1);

      expect(result).toEqual(mockDbRow);
      expect(SshKeyRepository.findSshKeyById).toHaveBeenCalledWith(1);
    });

    it('密钥不存在时应返回 null', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(null);

      const result = await getSshKeyDbRowById(999);

      expect(result).toBeNull();
    });
  });

  describe('getDecryptedSshKeyById', () => {
    it('应返回解密后的密钥详情', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(mockDbRow);

      const result = await getDecryptedSshKeyById(1);

      expect(result).toEqual({
        id: 1,
        name: 'My SSH Key',
        privateKey: 'privatekey',
        passphrase: 'passphrase',
      });
      expect(decrypt).toHaveBeenCalledWith('encrypted_privatekey');
      expect(decrypt).toHaveBeenCalledWith('encrypted_passphrase');
    });

    it('无密码短语时 passphrase 应为 undefined', async () => {
      const rowWithoutPass = { ...mockDbRow, encrypted_passphrase: null };
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(rowWithoutPass);

      const result = await getDecryptedSshKeyById(1);

      expect(result?.passphrase).toBeUndefined();
    });

    it('密钥不存在时应返回 null', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(null);

      const result = await getDecryptedSshKeyById(999);

      expect(result).toBeNull();
    });

    it('解密失败时应抛出异常', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(mockDbRow);
      (decrypt as any).mockImplementationOnce(() => {
        throw new Error('Decryption failed');
      });

      await expect(getDecryptedSshKeyById(1)).rejects.toThrow('解密 SSH 密钥 1 失败。');
    });
  });

  describe('updateSshKey', () => {
    it('应成功更新密钥名称', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(mockDbRow);
      (SshKeyRepository.updateSshKey as any).mockResolvedValueOnce(true);

      const result = await updateSshKey(1, { name: 'Updated Name' });

      expect(result).toEqual({ id: 1, name: 'Updated Name' });
      expect(SshKeyRepository.updateSshKey).toHaveBeenCalledWith(1, {
        name: 'Updated Name',
      });
    });

    it('更新私钥时应同时更新密码短语', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(mockDbRow);
      (SshKeyRepository.updateSshKey as any).mockResolvedValueOnce(true);

      await updateSshKey(1, {
        private_key: 'new_key',
        passphrase: 'new_pass',
      });

      expect(encrypt).toHaveBeenCalledWith('new_key');
      expect(encrypt).toHaveBeenCalledWith('new_pass');
    });

    it('密钥不存在时应返回 null', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(null);

      const result = await updateSshKey(999, { name: 'Test' });

      expect(result).toBeNull();
    });

    it('空名称应抛出异常', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(mockDbRow);

      await expect(updateSshKey(1, { name: '' })).rejects.toThrow('密钥名称不能为空。');
    });

    it('空私钥应抛出异常', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(mockDbRow);

      await expect(updateSshKey(1, { private_key: '' })).rejects.toThrow('私钥内容不能为空。');
    });

    it('名称重复时应抛出友好异常', async () => {
      (SshKeyRepository.findSshKeyById as any).mockResolvedValueOnce(mockDbRow);
      (SshKeyRepository.updateSshKey as any).mockRejectedValueOnce(
        new Error('UNIQUE constraint failed: ssh_keys.name')
      );

      await expect(updateSshKey(1, { name: 'Duplicate' })).rejects.toThrow(
        'SSH 密钥名称 "Duplicate" 已存在。'
      );
    });
  });

  describe('deleteSshKey', () => {
    it('应成功删除密钥', async () => {
      (SshKeyRepository.deleteSshKey as any).mockResolvedValueOnce(true);

      const result = await deleteSshKey(1);

      expect(result).toBe(true);
      expect(SshKeyRepository.deleteSshKey).toHaveBeenCalledWith(1);
    });

    it('密钥不存在时应返回 false', async () => {
      (SshKeyRepository.deleteSshKey as any).mockResolvedValueOnce(false);

      const result = await deleteSshKey(999);

      expect(result).toBe(false);
    });
  });

  describe('getAllDecryptedSshKeys', () => {
    it('应返回所有解密后的密钥列表', async () => {
      const mockRows = [
        mockDbRow,
        { ...mockDbRow, id: 2, name: 'Key B', encrypted_passphrase: null },
      ];
      (SshKeyRepository.findAllSshKeys as any).mockResolvedValueOnce(mockRows);

      const result = await getAllDecryptedSshKeys();

      expect(result).toHaveLength(2);
      expect(result[0].privateKey).toBe('privatekey');
      expect(result[1].passphrase).toBeUndefined();
    });

    it('单个密钥解密失败不影响其他密钥', async () => {
      const mockRows = [mockDbRow, { ...mockDbRow, id: 2, name: 'Key B' }];
      (SshKeyRepository.findAllSshKeys as any).mockResolvedValueOnce(mockRows);
      // 第一个密钥解密失败
      (decrypt as any)
        .mockImplementationOnce(() => {
          throw new Error('Decryption failed');
        })
        .mockImplementation((value: string) => value.replace('encrypted_', ''));

      const result = await getAllDecryptedSshKeys();

      // 第一个密钥解密失败被跳过，只返回第二个
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });
  });
});
