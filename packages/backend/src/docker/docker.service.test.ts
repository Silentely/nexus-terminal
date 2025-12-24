/**
 * Docker Service 单元测试
 * 测试 Docker CLI 操作的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DockerService, DockerCommand } from './docker.service';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// 使用 vi.hoisted 确保 mockExecAsync 在 mock 提升后仍然可用
const { mockExecAsync } = vi.hoisted(() => {
  const mockExecAsync = vi.fn();
  return { mockExecAsync };
});

// Mock promisify to return a mockable async function
vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecAsync),
}));

describe('DockerService', () => {
  let service: DockerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DockerService();
    // 重置缓存状态
    (service as any).isDockerAvailableCache = null;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('checkDockerAvailability', () => {
    it('Docker 可用时应返回 true', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: 'Docker version 20.10.0', stderr: '' });

      const result = await service.checkDockerAvailability();

      expect(result).toBe(true);
    });

    it('Docker 不可用时应返回 false', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('command not found: docker'));

      const result = await service.checkDockerAvailability();

      expect(result).toBe(false);
    });

    it('应缓存可用状态', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: 'Docker version 20.10.0', stderr: '' });

      await service.checkDockerAvailability();
      const result = await service.checkDockerAvailability();

      expect(result).toBe(true);
      expect(mockExecAsync).toHaveBeenCalledTimes(1); // 只调用一次，第二次使用缓存
    });

    it('应缓存不可用状态', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('not found'));

      await service.checkDockerAvailability();
      const result = await service.checkDockerAvailability();

      expect(result).toBe(false);
      expect(mockExecAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('getContainerStatus', () => {
    it('Docker 不可用时应返回空容器列表', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('docker not found'));

      const result = await service.getContainerStatus();

      expect(result).toEqual({ available: false, containers: [] });
    });

    it('应正确获取容器列表', async () => {
      const mockContainer = {
        Id: 'abc123def456',
        Names: 'test-container',
        Image: 'nginx:latest',
        ImageID: 'sha256:xxx',
        Command: 'nginx -g daemon off;',
        Created: 1700000000,
        State: 'running',
        Status: 'Up 2 hours',
        Ports: [],
        Labels: {},
      };

      // 第一次调用检查可用性
      mockExecAsync.mockResolvedValueOnce({ stdout: 'Docker version 20.10.0', stderr: '' });
      // 第二次调用获取容器列表
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify(mockContainer),
        stderr: '',
      });
      // 第三次调用获取统计信息
      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await service.getContainerStatus();

      expect(result.available).toBe(true);
      expect(result.containers).toHaveLength(1);
      expect(result.containers[0].Id).toBe('abc123def456');
      expect(result.containers[0].Names).toEqual(['test-container']);
    });

    it('应正确合并统计信息到容器', async () => {
      const mockContainer = {
        Id: 'abc123def456789',
        Names: 'test-container',
        Image: 'nginx:latest',
        ImageID: 'sha256:xxx',
        Command: 'nginx',
        Created: 1700000000,
        State: 'running',
        Status: 'Up 2 hours',
        Ports: [],
        Labels: {},
      };

      const mockStats = {
        ID: 'abc123def456', // 短 ID
        Name: 'test-container',
        CPUPerc: '1.5%',
        MemUsage: '100MiB / 1GiB',
        MemPerc: '10%',
        NetIO: '1MB / 500KB',
        BlockIO: '10MB / 5MB',
        PIDs: '10',
      };

      mockExecAsync.mockResolvedValueOnce({ stdout: 'Docker version', stderr: '' });
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify(mockContainer),
        stderr: '',
      });
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify(mockStats),
        stderr: '',
      });

      const result = await service.getContainerStatus();

      expect(result.containers[0].stats).not.toBeNull();
      expect(result.containers[0].stats?.CPUPerc).toBe('1.5%');
    });

    it('应处理无效的容器 JSON', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: 'Docker version', stderr: '' });
      mockExecAsync.mockResolvedValueOnce({
        stdout:
          'invalid json line\n{"Id": "valid123", "Names": "valid", "Image": "img", "ImageID": "sha", "Command": "cmd", "Created": 0, "State": "running", "Status": "Up", "Ports": [], "Labels": {}}',
        stderr: '',
      });
      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      const result = await service.getContainerStatus();

      expect(result.available).toBe(true);
      expect(result.containers).toHaveLength(1); // 只有有效的容器
      expect(result.containers[0].Id).toBe('valid123');
    });

    it('docker ps 失败时应标记不可用', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: 'Docker version', stderr: '' });
      mockExecAsync.mockRejectedValueOnce(new Error('permission denied'));

      const result = await service.getContainerStatus();

      expect(result.available).toBe(false);
      expect(result.containers).toEqual([]);
    });

    it('docker stats 失败时仍应返回容器列表', async () => {
      const mockContainer = {
        Id: 'abc123',
        Names: 'test',
        Image: 'nginx',
        ImageID: 'sha',
        Command: 'cmd',
        Created: 0,
        State: 'running',
        Status: 'Up',
        Ports: [],
        Labels: {},
      };

      mockExecAsync.mockResolvedValueOnce({ stdout: 'Docker version', stderr: '' });
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify(mockContainer),
        stderr: '',
      });
      mockExecAsync.mockRejectedValueOnce(new Error('stats failed'));

      const result = await service.getContainerStatus();

      expect(result.available).toBe(true);
      expect(result.containers).toHaveLength(1);
      expect(result.containers[0].stats).toBeNull();
    });
  });

  describe('executeContainerCommand', () => {
    beforeEach(() => {
      // 确保 Docker 可用
      (service as any).isDockerAvailableCache = true;
    });

    it('Docker 不可用时应抛出错误', async () => {
      (service as any).isDockerAvailableCache = null;
      mockExecAsync.mockRejectedValueOnce(new Error('docker not found'));

      await expect(service.executeContainerCommand('abc123', 'start')).rejects.toThrow(
        'Docker is not available.'
      );
    });

    it('应成功执行 start 命令', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: 'abc123', stderr: '' });

      await expect(service.executeContainerCommand('abc123', 'start')).resolves.toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalledWith('docker start abc123', expect.any(Object));
    });

    it('应成功执行 stop 命令', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: 'abc123', stderr: '' });

      await expect(service.executeContainerCommand('abc123', 'stop')).resolves.toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalledWith('docker stop abc123', expect.any(Object));
    });

    it('应成功执行 restart 命令', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: 'abc123', stderr: '' });

      await expect(service.executeContainerCommand('abc123', 'restart')).resolves.toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalledWith('docker restart abc123', expect.any(Object));
    });

    it('应成功执行 remove 命令', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: 'abc123', stderr: '' });

      await expect(service.executeContainerCommand('abc123', 'remove')).resolves.toBeUndefined();
      expect(mockExecAsync).toHaveBeenCalledWith('docker rm -f abc123', expect.any(Object));
    });

    it('应拒绝无效的容器 ID 格式', async () => {
      await expect(service.executeContainerCommand('', 'start')).rejects.toThrow(
        'Invalid container ID format.'
      );
    });

    it('应清理容器 ID 中的特殊字符', async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      await service.executeContainerCommand('abc123!@#$%^&*()', 'start');

      expect(mockExecAsync).toHaveBeenCalledWith('docker start abc123', expect.any(Object));
    });

    it('应在 stderr 包含错误关键词时抛出错误', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: 'Error: No such container',
      });

      await expect(service.executeContainerCommand('notfound', 'start')).rejects.toThrow(
        'Docker command failed: Error: No such container'
      );
    });

    it('命令执行失败时应抛出错误', async () => {
      mockExecAsync.mockRejectedValueOnce({
        message: 'Command failed',
        stderr: 'container not found',
      });

      await expect(service.executeContainerCommand('abc123', 'start')).rejects.toThrow(
        'Failed to execute Docker command "start": container not found'
      );
    });

    it('不支持的命令应抛出错误', async () => {
      await expect(
        service.executeContainerCommand('abc123', 'invalid' as DockerCommand)
      ).rejects.toThrow('Unsupported Docker command: invalid');
    });

    it('应允许非错误的 stderr 输出', async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: 'abc123',
        stderr: 'Warning: some warning message',
      });

      await expect(service.executeContainerCommand('abc123', 'start')).resolves.toBeUndefined();
    });
  });
});
