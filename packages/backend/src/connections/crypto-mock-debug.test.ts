/**
 * 调试测试 - 验证 crypto mock 是否在导入 connection.service 后仍能工作
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 导入被 mock 的模块和服务
import { encrypt, decrypt } from '../utils/crypto';
import { createConnection } from './connection.service';
import * as ConnectionRepository from './connection.repository';

// Mock 所有依赖模块
vi.mock('./connection.repository', () => ({
  findAllConnectionsWithTags: vi.fn(),
  findConnectionByIdWithTags: vi.fn(),
  findFullConnectionById: vi.fn(),
  findConnectionByName: vi.fn(),
  createConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  updateConnectionTags: vi.fn(),
  findConnectionTags: vi.fn(),
  addTagToMultipleConnections: vi.fn(),
}));

vi.mock('../utils/crypto', () => ({
  encrypt: vi.fn((value: string) => `encrypted_${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted_', '')),
}));

vi.mock('../ssh-keys/ssh-keys.service', () => ({
  getSshKeyDbRowById: vi.fn(),
  getDecryptedSshKeyById: vi.fn(),
}));

vi.mock('../audit/audit.service', () => ({
  AuditLogService: vi.fn().mockImplementation(() => ({
    logAction: vi.fn(),
  })),
}));

describe('Crypto Mock With Connection Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encrypt should return encrypted string', () => {
    const result = encrypt('test');
    console.log('encrypt result:', result);
    console.log('encrypt function:', encrypt.toString());
    expect(result).toBe('encrypted_test');
  });

  it('createConnection should call encrypt with password', async () => {
    (ConnectionRepository.createConnection as any).mockResolvedValue(1);
    (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
      id: 1,
      name: 'Test',
      type: 'SSH',
      host: '192.168.1.1',
      port: 22,
      tag_ids: [],
    });

    const input = {
      name: 'Test',
      type: 'SSH',
      host: '192.168.1.1',
      port: 22,
      username: 'admin',
      auth_method: 'password' as const,
      password: 'secret123',
    };

    await createConnection(input);

    console.log('encrypt call count:', (encrypt as any).mock?.calls?.length);
    console.log('encrypt mock calls:', (encrypt as any).mock?.calls);
    console.log(
      'Repository.createConnection calls:',
      (ConnectionRepository.createConnection as any).mock.calls
    );

    expect(encrypt).toHaveBeenCalledWith('secret123');
  });
});
