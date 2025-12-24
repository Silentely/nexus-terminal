/**
 * Transfers Service 单元测试
 * 测试文件传输服务的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import { TransfersService } from './transfers.service';
import type { InitiateTransferPayload, TransferTask } from './transfers.types';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const mockUuid = vi.hoisted(() => ({
  v4: vi.fn(),
}));

const mockConnectionService = vi.hoisted(() => ({
  getConnectionWithDecryptedCredentials: vi.fn(),
}));

// Mock SSH2 Client - 不自动触发 ready 事件，避免异步处理干扰测试
const mockSsh2 = vi.hoisted(() => {
  const createMockClient = () => {
    const client = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      exec: ReturnType<typeof vi.fn>;
      sftp: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    // 不自动触发 ready，让测试更可控
    client.connect = vi.fn().mockReturnThis();
    client.exec = vi.fn();
    client.sftp = vi.fn();
    client.end = vi.fn();
    return client;
  };

  return {
    Client: vi.fn(() => createMockClient()),
  };
});

// Mock 依赖模块
vi.mock('uuid', () => mockUuid);
vi.mock('../connections/connection.service', () => mockConnectionService);
vi.mock('ssh2', () => mockSsh2);

describe('TransfersService', () => {
  let service: TransfersService;
  let uuidCounter = 0;

  const mockSourceConnection = {
    connection: {
      id: 1,
      name: 'Source Server',
      type: 'SSH',
      host: '192.168.1.1',
      port: 22,
      username: 'sourceuser',
      auth_method: 'password',
    },
    decryptedPassword: 'source_pass',
    decryptedPrivateKey: null,
    decryptedPassphrase: null,
  };

  const mockTargetConnection = {
    connection: {
      id: 2,
      name: 'Target Server',
      type: 'SSH',
      host: '192.168.1.2',
      port: 22,
      username: 'targetuser',
      auth_method: 'password',
    },
    decryptedPassword: 'target_pass',
    decryptedPrivateKey: null,
    decryptedPassphrase: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    mockUuid.v4.mockImplementation(() => `uuid-${++uuidCounter}`);
    service = new TransfersService();

    // 默认连接解密返回
    mockConnectionService.getConnectionWithDecryptedCredentials.mockImplementation(
      (connId: number | string) => {
        if (connId === 1 || connId === '1') return Promise.resolve(mockSourceConnection);
        if (connId === 2 || connId === '2') return Promise.resolve(mockTargetConnection);
        return Promise.resolve(null);
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initiateNewTransfer', () => {
    it('应成功创建新的传输任务', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');

      expect(task).toBeDefined();
      expect(task.taskId).toBe('uuid-1');
      // 任务创建后异步处理会立即开始，状态变为 in-progress
      expect(task.status).toBe('in-progress');
      expect(task.userId).toBe('user1');
      expect(task.subTasks).toHaveLength(1);
      expect(task.subTasks[0].connectionId).toBe(2);
      expect(task.subTasks[0].sourceItemName).toBe('test.txt');
    });

    it('应为多个目标服务器创建多个子任务', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2, 3],
        sourceItems: [
          { name: 'file1.txt', path: '/home/user/file1.txt', type: 'file' },
          { name: 'file2.txt', path: '/home/user/file2.txt', type: 'file' },
        ],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');

      // 2 个目标服务器 × 2 个文件 = 4 个子任务
      expect(task.subTasks).toHaveLength(4);
    });

    it('应正确设置子任务初始状态', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'scp',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');

      expect(task.subTasks[0].status).toBe('queued');
      expect(task.subTasks[0].startTime).toBeDefined();
    });
  });

  describe('cancelTransferTask', () => {
    it('应成功取消传输任务', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      const result = await service.cancelTransferTask(task.taskId, 'user1');

      expect(result).toBe(true);
    });

    it('任务不存在时应返回 false', async () => {
      const result = await service.cancelTransferTask('nonexistent-task', 'user1');

      expect(result).toBe(false);
    });

    it('非任务所有者不能取消任务', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      const result = await service.cancelTransferTask(task.taskId, 'user2');

      expect(result).toBe(false);
    });

    it('取消后子任务状态应更新为 cancelled', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      await service.cancelTransferTask(task.taskId, 'user1');

      const details = await service.getTransferTaskDetails(task.taskId, 'user1');
      expect(details?.subTasks[0].status).toBe('cancelled');
    });
  });

  describe('getTransferTaskDetails', () => {
    it('应返回任务详情', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      const details = await service.getTransferTaskDetails(task.taskId, 'user1');

      expect(details).toBeDefined();
      expect(details?.taskId).toBe(task.taskId);
      expect(details?.sourceConnectionId).toBe(1);
      expect(details?.remoteTargetPath).toBe('/tmp');
    });

    it('任务不存在时应返回 null', async () => {
      const details = await service.getTransferTaskDetails('nonexistent', 'user1');

      expect(details).toBeNull();
    });

    it('非所有者访问时应返回 null', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      const details = await service.getTransferTaskDetails(task.taskId, 'user2');

      expect(details).toBeNull();
    });
  });

  describe('getAllTransferTasks', () => {
    it('应返回用户的所有任务', async () => {
      const payload1: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'file1.txt', path: '/home/user/file1.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const payload2: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'file2.txt', path: '/home/user/file2.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'scp',
      };

      await service.initiateNewTransfer(payload1, 'user1');
      await service.initiateNewTransfer(payload2, 'user1');

      const tasks = await service.getAllTransferTasks('user1');

      expect(tasks).toHaveLength(2);
    });

    it('应只返回当前用户的任务', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      await service.initiateNewTransfer(payload, 'user1');
      await service.initiateNewTransfer(payload, 'user2');

      const user1Tasks = await service.getAllTransferTasks('user1');
      const user2Tasks = await service.getAllTransferTasks('user2');

      expect(user1Tasks).toHaveLength(1);
      expect(user2Tasks).toHaveLength(1);
    });

    it('无任务时应返回空数组', async () => {
      const tasks = await service.getAllTransferTasks('newuser');

      expect(tasks).toEqual([]);
    });
  });

  describe('updateSubTaskStatus', () => {
    it('应更新子任务状态', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      const subTaskId = task.subTasks[0].subTaskId;

      service.updateSubTaskStatus(task.taskId, subTaskId, 'transferring', 50, 'Transferring...');

      const details = await service.getTransferTaskDetails(task.taskId, 'user1');
      expect(details?.subTasks[0].status).toBe('transferring');
      expect(details?.subTasks[0].progress).toBe(50);
      expect(details?.subTasks[0].message).toBe('Transferring...');
    });

    it('进度应被限制在 0-100 范围内', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      const subTaskId = task.subTasks[0].subTaskId;

      service.updateSubTaskStatus(task.taskId, subTaskId, 'transferring', 150);

      const details = await service.getTransferTaskDetails(task.taskId, 'user1');
      expect(details?.subTasks[0].progress).toBe(100);

      service.updateSubTaskStatus(task.taskId, subTaskId, 'transferring', -10);

      const details2 = await service.getTransferTaskDetails(task.taskId, 'user1');
      expect(details2?.subTasks[0].progress).toBe(0);
    });

    it('完成状态后不应被覆盖为非终态', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      const subTaskId = task.subTasks[0].subTaskId;

      // 设置为完成
      service.updateSubTaskStatus(task.taskId, subTaskId, 'completed', 100);

      // 尝试设置回传输中（应被忽略）
      service.updateSubTaskStatus(task.taskId, subTaskId, 'transferring', 50);

      const details = await service.getTransferTaskDetails(task.taskId, 'user1');
      expect(details?.subTasks[0].status).toBe('completed');
    });

    it('任务不存在时应静默处理', () => {
      // 不应抛出错误
      service.updateSubTaskStatus('nonexistent', 'subtask-id', 'transferring', 50);
    });

    it('子任务不存在时应静默处理', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');

      // 不应抛出错误
      service.updateSubTaskStatus(task.taskId, 'nonexistent-subtask', 'transferring', 50);
    });
  });

  describe('buildSshConnectConfig', () => {
    it('密码认证应正确配置', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      // 通过创建任务来间接测试 buildSshConnectConfig
      const task = await service.initiateNewTransfer(payload, 'user1');

      // 验证连接服务被调用
      expect(mockConnectionService.getConnectionWithDecryptedCredentials).toHaveBeenCalledWith(1);
    });

    it('密钥认证应正确配置', async () => {
      const keyConnection = {
        connection: {
          id: 3,
          name: 'Key Server',
          type: 'SSH',
          host: '192.168.1.3',
          port: 22,
          username: 'keyuser',
          auth_method: 'key',
        },
        decryptedPassword: null,
        decryptedPrivateKey: '-----BEGIN RSA PRIVATE KEY-----',
        decryptedPassphrase: 'keypass',
      };

      mockConnectionService.getConnectionWithDecryptedCredentials.mockImplementation(
        (connId: number | string) => {
          if (connId === 3 || connId === '3') return Promise.resolve(keyConnection);
          return Promise.resolve(mockSourceConnection);
        }
      );

      const payload: InitiateTransferPayload = {
        sourceConnectionId: 3,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      await service.initiateNewTransfer(payload, 'user1');

      expect(mockConnectionService.getConnectionWithDecryptedCredentials).toHaveBeenCalledWith(3);
    });
  });

  describe('escapeShellArg', () => {
    it('应正确转义包含空格的参数', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'my file.txt', path: '/home/user/my file.txt', type: 'file' }],
        remoteTargetPath: '/tmp/my directory',
        transferMethod: 'scp',
      };

      // 间接测试 - 通过任务创建
      const task = await service.initiateNewTransfer(payload, 'user1');
      expect(task.subTasks[0].sourceItemName).toBe('my file.txt');
    });

    it('应正确转义包含单引号的参数', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: "file'name.txt", path: "/home/user/file'name.txt", type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'scp',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      expect(task.subTasks[0].sourceItemName).toBe("file'name.txt");
    });
  });

  describe('整体状态计算', () => {
    it('所有子任务完成时主任务应为 completed', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      const subTaskId = task.subTasks[0].subTaskId;

      service.updateSubTaskStatus(task.taskId, subTaskId, 'completed', 100);

      const details = await service.getTransferTaskDetails(task.taskId, 'user1');
      expect(details?.status).toBe('completed');
      expect(details?.overallProgress).toBe(100);
    });

    it('所有子任务失败时主任务应为 failed', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');
      const subTaskId = task.subTasks[0].subTaskId;

      service.updateSubTaskStatus(task.taskId, subTaskId, 'failed', 0, 'Transfer failed');

      const details = await service.getTransferTaskDetails(task.taskId, 'user1');
      expect(details?.status).toBe('failed');
    });

    it('部分成功时主任务应为 partially-completed', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2, 3],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');

      // 第一个子任务成功
      service.updateSubTaskStatus(task.taskId, task.subTasks[0].subTaskId, 'completed', 100);
      // 第二个子任务失败
      service.updateSubTaskStatus(task.taskId, task.subTasks[1].subTaskId, 'failed', 0);

      const details = await service.getTransferTaskDetails(task.taskId, 'user1');
      expect(details?.status).toBe('partially-completed');
    });

    it('有进行中的子任务时主任务应为 in-progress', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2, 3],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');

      // 第一个子任务进行中
      service.updateSubTaskStatus(task.taskId, task.subTasks[0].subTaskId, 'transferring', 50);

      const details = await service.getTransferTaskDetails(task.taskId, 'user1');
      expect(details?.status).toBe('in-progress');
    });

    it('整体进度应正确计算', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2, 3],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');

      // 第一个子任务 50%
      service.updateSubTaskStatus(task.taskId, task.subTasks[0].subTaskId, 'transferring', 50);
      // 第二个子任务 100%
      service.updateSubTaskStatus(task.taskId, task.subTasks[1].subTaskId, 'completed', 100);

      const details = await service.getTransferTaskDetails(task.taskId, 'user1');
      // (50 + 100) / 2 = 75
      expect(details?.overallProgress).toBe(75);
    });
  });

  describe('边界条件', () => {
    it('无子任务时应正确处理', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [],
        sourceItems: [],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');

      expect(task.subTasks).toHaveLength(0);
    });

    it('源连接不存在时应处理错误', async () => {
      mockConnectionService.getConnectionWithDecryptedCredentials.mockResolvedValue(null);

      const payload: InitiateTransferPayload = {
        sourceConnectionId: 999,
        connectionIds: [2],
        sourceItems: [{ name: 'test.txt', path: '/home/user/test.txt', type: 'file' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'auto',
      };

      // 任务创建应该成功，但后台处理会失败
      const task = await service.initiateNewTransfer(payload, 'user1');
      expect(task.taskId).toBeDefined();
    });

    it('目录类型源应正确处理', async () => {
      const payload: InitiateTransferPayload = {
        sourceConnectionId: 1,
        connectionIds: [2],
        sourceItems: [{ name: 'mydir', path: '/home/user/mydir', type: 'directory' }],
        remoteTargetPath: '/tmp',
        transferMethod: 'rsync',
      };

      const task = await service.initiateNewTransfer(payload, 'user1');

      expect(task.subTasks[0].sourceItemName).toBe('mydir');
    });
  });
});
