/**
 * Import-Export Service 单元测试
 * 测试连接配置导入导出的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough, Readable } from 'stream';
import { EventEmitter } from 'events';

import {
  exportConnectionsAsEncryptedZip,
  importConnections,
  ImportResult,
} from './import-export.service';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const mockConnectionRepo = vi.hoisted(() => ({
  bulkInsertConnections: vi.fn(),
}));

const mockProxyRepo = vi.hoisted(() => ({
  findProxyByNameTypeHostPort: vi.fn(),
  createProxy: vi.fn(),
}));

const mockTagService = vi.hoisted(() => ({
  getAllTags: vi.fn(),
}));

const mockDbConnection = vi.hoisted(() => ({
  getDbInstance: vi.fn(),
  runDb: vi.fn(),
  getDb: vi.fn(),
  allDb: vi.fn(),
}));

const mockCrypto = vi.hoisted(() => ({
  decrypt: vi.fn(),
  getEncryptionKeyBuffer: vi.fn(),
}));

const mockSshKeysService = vi.hoisted(() => ({
  getAllDecryptedSshKeys: vi.fn(),
}));

// Mock archiver
const mockArchiver = vi.hoisted(() => {
  const createMockArchive = () => {
    const archive = new EventEmitter() as EventEmitter & {
      append: ReturnType<typeof vi.fn>;
      finalize: ReturnType<typeof vi.fn>;
      pipe: ReturnType<typeof vi.fn>;
    };
    archive.append = vi.fn();
    archive.finalize = vi.fn().mockResolvedValue(undefined);
    archive.pipe = vi.fn().mockReturnThis();
    return archive;
  };
  return {
    default: {
      create: vi.fn(() => createMockArchive()),
      registerFormat: vi.fn(),
    },
    create: vi.fn(() => createMockArchive()),
    registerFormat: vi.fn(),
  };
});

// Mock 依赖模块
vi.mock('../connections/connection.repository', () => mockConnectionRepo);
vi.mock('../proxies/proxy.repository', () => mockProxyRepo);
vi.mock('../tags/tag.service', () => mockTagService);
vi.mock('../database/connection', () => mockDbConnection);
vi.mock('../utils/crypto', () => mockCrypto);
vi.mock('../ssh-keys/ssh-keys.service', () => mockSshKeysService);
vi.mock('archiver', () => mockArchiver);
vi.mock('archiver-zip-encrypted', () => ({}));

describe('ImportExportService', () => {
  const mockDb = {};
  const mockConnections = [
    {
      id: 1,
      name: 'Test SSH',
      type: 'SSH',
      host: '192.168.1.1',
      port: 22,
      username: 'user1',
      auth_method: 'password',
      encrypted_password: 'encrypted_pass',
      encrypted_private_key: null,
      encrypted_passphrase: null,
      ssh_key_id: null,
      proxy_db_id: null,
      proxy_name: null,
      proxy_type: null,
      proxy_host: null,
      proxy_port: null,
      proxy_username: null,
      proxy_auth_method: null,
    },
    {
      id: 2,
      name: 'Test RDP',
      type: 'RDP',
      host: '192.168.1.2',
      port: 3389,
      username: 'admin',
      auth_method: 'password',
      encrypted_password: 'encrypted_rdp_pass',
      encrypted_private_key: null,
      encrypted_passphrase: null,
      ssh_key_id: null,
      proxy_db_id: 1,
      proxy_name: 'Proxy1',
      proxy_type: 'SOCKS5',
      proxy_host: '10.0.0.1',
      proxy_port: 1080,
      proxy_username: 'proxyuser',
      proxy_auth_method: 'password',
      proxy_encrypted_password: 'encrypted_proxy_pass',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbConnection.getDbInstance.mockResolvedValue(mockDb);
    mockDbConnection.allDb.mockResolvedValue(mockConnections);
    mockDbConnection.runDb.mockResolvedValue(undefined);
    mockTagService.getAllTags.mockResolvedValue([
      { id: 1, name: 'Production' },
      { id: 2, name: 'Development' },
    ]);
    mockSshKeysService.getAllDecryptedSshKeys.mockResolvedValue([]);
    mockCrypto.decrypt.mockImplementation((val: string) => `decrypted_${val}`);

    // Mock ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-xx';
  });

  describe('exportConnectionsAsEncryptedZip', () => {
    it('应成功导出连接为加密 ZIP', async () => {
      // 模拟标签关联
      mockDbConnection.allDb
        .mockResolvedValueOnce(mockConnections)
        .mockResolvedValueOnce([{ connection_id: 1, tag_id: 1 }]);

      // 创建模拟 archive
      const mockArchive = new EventEmitter() as EventEmitter & {
        append: ReturnType<typeof vi.fn>;
        finalize: ReturnType<typeof vi.fn>;
      };
      mockArchive.append = vi.fn();
      mockArchive.finalize = vi.fn().mockImplementation(() => {
        // 模拟写入数据
        process.nextTick(() => {
          mockArchive.emit('data', Buffer.from('zip-content'));
        });
        return Promise.resolve();
      });
      mockArchiver.default.create.mockReturnValue(mockArchive);

      const result = await exportConnectionsAsEncryptedZip(false);

      expect(result).toBeInstanceOf(Buffer);
      expect(mockArchive.append).toHaveBeenCalledWith(
        expect.stringContaining('user1@192.168.1.1:22'),
        { name: 'connections.txt' }
      );
      expect(mockArchive.finalize).toHaveBeenCalled();
    });

    it('应包含 SSH 密钥当 includeSshKeys 为 true', async () => {
      mockDbConnection.allDb.mockResolvedValueOnce(mockConnections).mockResolvedValueOnce([]);
      mockSshKeysService.getAllDecryptedSshKeys.mockResolvedValue([
        { id: 1, name: 'my-key', privateKey: '-----BEGIN RSA PRIVATE KEY-----' },
      ]);

      const mockArchive = new EventEmitter() as EventEmitter & {
        append: ReturnType<typeof vi.fn>;
        finalize: ReturnType<typeof vi.fn>;
      };
      mockArchive.append = vi.fn();
      mockArchive.finalize = vi.fn().mockResolvedValue(undefined);
      mockArchiver.default.create.mockReturnValue(mockArchive);

      await exportConnectionsAsEncryptedZip(true);

      expect(mockSshKeysService.getAllDecryptedSshKeys).toHaveBeenCalled();
      expect(mockArchive.append).toHaveBeenCalledWith('-----BEGIN RSA PRIVATE KEY-----', {
        name: 'ssh_keys/my-key.txt',
      });
    });

    it('ENCRYPTION_KEY 未设置时应抛出错误', async () => {
      delete process.env.ENCRYPTION_KEY;
      mockDbConnection.allDb.mockResolvedValueOnce(mockConnections).mockResolvedValueOnce([]);

      await expect(exportConnectionsAsEncryptedZip(false)).rejects.toThrow(
        'ENCRYPTION_KEY is not set or is empty'
      );
    });

    it('应正确解密敏感数据', async () => {
      mockDbConnection.allDb.mockResolvedValueOnce(mockConnections).mockResolvedValueOnce([]);

      const mockArchive = new EventEmitter() as EventEmitter & {
        append: ReturnType<typeof vi.fn>;
        finalize: ReturnType<typeof vi.fn>;
      };
      mockArchive.append = vi.fn();
      mockArchive.finalize = vi.fn().mockResolvedValue(undefined);
      mockArchiver.default.create.mockReturnValue(mockArchive);

      await exportConnectionsAsEncryptedZip(false);

      expect(mockCrypto.decrypt).toHaveBeenCalledWith('encrypted_pass');
      expect(mockCrypto.decrypt).toHaveBeenCalledWith('encrypted_rdp_pass');
    });

    it('解密失败时应继续处理（静默忽略）', async () => {
      mockCrypto.decrypt.mockImplementation(() => {
        throw new Error('Decryption failed');
      });
      mockDbConnection.allDb.mockResolvedValueOnce(mockConnections).mockResolvedValueOnce([]);

      const mockArchive = new EventEmitter() as EventEmitter & {
        append: ReturnType<typeof vi.fn>;
        finalize: ReturnType<typeof vi.fn>;
      };
      mockArchive.append = vi.fn();
      mockArchive.finalize = vi.fn().mockResolvedValue(undefined);
      mockArchiver.default.create.mockReturnValue(mockArchive);

      // 不应抛出错误
      await expect(exportConnectionsAsEncryptedZip(false)).resolves.toBeDefined();
    });
  });

  describe('importConnections', () => {
    const validImportData = [
      {
        name: 'Imported SSH',
        type: 'SSH',
        host: '10.0.0.1',
        port: 22,
        username: 'importuser',
        auth_method: 'password',
        encrypted_password: 'enc_pass',
      },
    ];

    it('应成功导入有效的连接数据', async () => {
      const fileBuffer = Buffer.from(JSON.stringify(validImportData));
      mockConnectionRepo.bulkInsertConnections.mockResolvedValue([
        { connectionId: 1, originalData: validImportData[0] },
      ]);

      const result = await importConnections(fileBuffer);

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockDbConnection.runDb).toHaveBeenCalledWith(mockDb, 'BEGIN TRANSACTION');
      expect(mockDbConnection.runDb).toHaveBeenCalledWith(mockDb, 'COMMIT');
    });

    it('无效 JSON 应抛出错误', async () => {
      const fileBuffer = Buffer.from('not valid json');

      await expect(importConnections(fileBuffer)).rejects.toThrow('解析 JSON 文件失败');
    });

    it('非数组 JSON 应抛出错误', async () => {
      const fileBuffer = Buffer.from(JSON.stringify({ name: 'single object' }));

      await expect(importConnections(fileBuffer)).rejects.toThrow('JSON 文件内容必须是一个数组');
    });

    it('缺少必要字段时应记录失败', async () => {
      const invalidData = [{ name: 'Missing fields' }];
      const fileBuffer = Buffer.from(JSON.stringify(invalidData));
      mockConnectionRepo.bulkInsertConnections.mockResolvedValue([]);

      const result = await importConnections(fileBuffer);

      expect(result.failureCount).toBe(1);
      expect(result.errors[0].message).toContain('缺少或无效的连接类型');
    });

    it('SSH 连接缺少 auth_method 时应记录失败', async () => {
      const invalidSsh = [
        {
          name: 'SSH No Auth',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'user',
          // auth_method 缺失
        },
      ];
      const fileBuffer = Buffer.from(JSON.stringify(invalidSsh));
      mockConnectionRepo.bulkInsertConnections.mockResolvedValue([]);

      const result = await importConnections(fileBuffer);

      expect(result.failureCount).toBe(1);
      expect(result.errors[0].message).toContain('SSH 连接缺少有效的认证方式');
    });

    it('应正确处理带代理的连接', async () => {
      const dataWithProxy = [
        {
          name: 'With Proxy',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'user',
          auth_method: 'password',
          proxy: {
            name: 'New Proxy',
            type: 'SOCKS5',
            host: '192.168.1.1',
            port: 1080,
          },
        },
      ];
      const fileBuffer = Buffer.from(JSON.stringify(dataWithProxy));
      mockProxyRepo.findProxyByNameTypeHostPort.mockResolvedValue(null);
      mockProxyRepo.createProxy.mockResolvedValue(5);
      mockConnectionRepo.bulkInsertConnections.mockResolvedValue([
        { connectionId: 1, originalData: dataWithProxy[0] },
      ]);

      const result = await importConnections(fileBuffer);

      expect(result.successCount).toBe(1);
      expect(mockProxyRepo.createProxy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Proxy',
          type: 'SOCKS5',
          host: '192.168.1.1',
          port: 1080,
        })
      );
    });

    it('代理已存在时应复用', async () => {
      const dataWithProxy = [
        {
          name: 'With Existing Proxy',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'user',
          auth_method: 'password',
          proxy: {
            name: 'Existing Proxy',
            type: 'SOCKS5',
            host: '192.168.1.1',
            port: 1080,
          },
        },
      ];
      const fileBuffer = Buffer.from(JSON.stringify(dataWithProxy));
      mockProxyRepo.findProxyByNameTypeHostPort.mockResolvedValue({ id: 10 });
      mockConnectionRepo.bulkInsertConnections.mockResolvedValue([
        { connectionId: 1, originalData: dataWithProxy[0] },
      ]);

      const result = await importConnections(fileBuffer);

      expect(result.successCount).toBe(1);
      expect(mockProxyRepo.createProxy).not.toHaveBeenCalled();
    });

    it('应正确处理标签关联', async () => {
      const dataWithTags = [
        {
          name: 'With Tags',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'user',
          auth_method: 'password',
          tag_ids: [1, 2],
        },
      ];
      const fileBuffer = Buffer.from(JSON.stringify(dataWithTags));
      mockConnectionRepo.bulkInsertConnections.mockResolvedValue([
        { connectionId: 1, originalData: dataWithTags[0] },
      ]);

      const result = await importConnections(fileBuffer);

      expect(result.successCount).toBe(1);
      // 验证标签关联 SQL 被调用
      expect(mockDbConnection.runDb).toHaveBeenCalledWith(
        mockDb,
        'INSERT OR IGNORE INTO connection_tags (connection_id, tag_id) VALUES (?, ?)',
        [1, 1]
      );
      expect(mockDbConnection.runDb).toHaveBeenCalledWith(
        mockDb,
        'INSERT OR IGNORE INTO connection_tags (connection_id, tag_id) VALUES (?, ?)',
        [1, 2]
      );
    });

    it('事务出错时应回滚', async () => {
      const fileBuffer = Buffer.from(JSON.stringify(validImportData));
      mockConnectionRepo.bulkInsertConnections.mockRejectedValue(new Error('DB Error'));

      const result = await importConnections(fileBuffer);

      expect(result.failureCount).toBe(validImportData.length);
      expect(result.successCount).toBe(0);
      expect(mockDbConnection.runDb).toHaveBeenCalledWith(mockDb, 'ROLLBACK');
    });

    it('RDP 连接应使用 password 作为 auth_method', async () => {
      const rdpData = [
        {
          name: 'RDP Connection',
          type: 'RDP',
          host: '10.0.0.1',
          port: 3389,
          username: 'admin',
          auth_method: 'key', // 即使传入 key，也应该变为 password
          encrypted_password: 'enc',
        },
      ];
      const fileBuffer = Buffer.from(JSON.stringify(rdpData));
      mockConnectionRepo.bulkInsertConnections.mockResolvedValue([
        { connectionId: 1, originalData: rdpData[0] },
      ]);

      await importConnections(fileBuffer);

      expect(mockConnectionRepo.bulkInsertConnections).toHaveBeenCalledWith(
        mockDb,
        expect.arrayContaining([
          expect.objectContaining({
            auth_method: 'password', // 应该是 password
          }),
        ])
      );
    });
  });
});
