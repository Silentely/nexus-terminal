/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSshKeysStore } from './sshKeys.store';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';

// Mock apiClient
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock errorExtractor
vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn((err: unknown, fallback: string) => {
    if (err instanceof Error) return err.message;
    return fallback;
  }),
}));

describe('sshKeys.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('sshKeys 应该初始化为空数组', () => {
      const store = useSshKeysStore();
      expect(store.sshKeys).toEqual([]);
    });

    it('isLoading 应该初始化为 false', () => {
      const store = useSshKeysStore();
      expect(store.isLoading).toBe(false);
    });

    it('error 应该初始化为 null', () => {
      const store = useSshKeysStore();
      expect(store.error).toBeNull();
    });
  });

  describe('fetchSshKeys', () => {
    it('应该成功获取 SSH 密钥列表', async () => {
      const mockKeys = [
        { id: 1, name: '生产密钥' },
        { id: 2, name: '测试密钥' },
      ];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockKeys });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      expect(apiClient.get).toHaveBeenCalledWith('/ssh-keys');
      expect(store.sshKeys).toEqual(mockKeys);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('获取失败时应该设置 error 信息', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('网络错误'));
      vi.mocked(extractErrorMessage).mockReturnValue('获取 SSH 密钥列表失败。');

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      expect(store.error).toBe('获取 SSH 密钥列表失败。');
      expect(store.sshKeys).toEqual([]);
      expect(store.isLoading).toBe(false);
    });

    it('请求完成后 isLoading 应重置为 false', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      expect(store.isLoading).toBe(false);
    });
  });

  describe('addSshKey', () => {
    const newKeyInput = { name: '新密钥', private_key: 'ssh-rsa AAAA...', passphrase: undefined };

    it('应该成功添加 SSH 密钥并返回 true', async () => {
      const mockKey = { id: 3, name: '新密钥' };
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { message: '添加成功', key: mockKey },
      });

      const store = useSshKeysStore();
      const result = await store.addSshKey(newKeyInput);

      expect(apiClient.post).toHaveBeenCalledWith('/ssh-keys', newKeyInput);
      expect(result).toBe(true);
      expect(store.sshKeys).toContainEqual(mockKey);
      expect(store.isLoading).toBe(false);
    });

    it('添加后应该按名称排序', async () => {
      // 预置已有密钥
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          { id: 1, name: 'Zebra' },
          { id: 2, name: 'Alpha' },
        ],
      });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      // 添加新密钥
      const mockNewKey = { id: 3, name: 'Middle' };
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { message: '添加成功', key: mockNewKey },
      });

      await store.addSshKey(newKeyInput);

      const names = store.sshKeys.map((k) => k.name);
      expect(names).toEqual(['Alpha', 'Middle', 'Zebra']);
    });

    it('添加失败时应该返回 false 并设置错误信息', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('密钥格式错误'));
      vi.mocked(extractErrorMessage).mockReturnValue('添加 SSH 密钥失败。');

      const store = useSshKeysStore();
      const result = await store.addSshKey(newKeyInput);

      expect(result).toBe(false);
      expect(store.error).toBe('添加 SSH 密钥失败。');
      expect(store.isLoading).toBe(false);
    });

    it('请求完成后 isLoading 应重置为 false', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { message: '添加成功', key: { id: 1, name: '新密钥' } },
      });

      const store = useSshKeysStore();
      await store.addSshKey(newKeyInput);

      expect(store.isLoading).toBe(false);
    });
  });

  describe('fetchDecryptedSshKey', () => {
    it('应该成功获取解密后的密钥详情', async () => {
      const mockDetail = {
        id: 1,
        name: '生产密钥',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n...',
        passphrase: 'mypass',
      };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockDetail });

      const store = useSshKeysStore();
      const result = await store.fetchDecryptedSshKey(1);

      expect(apiClient.get).toHaveBeenCalledWith('/ssh-keys/1/details');
      expect(result).toEqual(mockDetail);
      expect(store.isLoading).toBe(false);
    });

    it('获取失败时应该返回 null 并设置错误信息', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('密钥不存在'));
      vi.mocked(extractErrorMessage).mockReturnValue('获取密钥 1 详情失败。');

      const store = useSshKeysStore();
      const result = await store.fetchDecryptedSshKey(1);

      expect(result).toBeNull();
      expect(store.error).toBe('获取密钥 1 详情失败。');
      expect(store.isLoading).toBe(false);
    });

    it('请求完成后 isLoading 应重置为 false', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: null });

      const store = useSshKeysStore();
      await store.fetchDecryptedSshKey(99);

      expect(store.isLoading).toBe(false);
    });
  });

  describe('updateSshKey', () => {
    const updateInput = { name: '更新后的密钥名' };

    it('应该成功更新 SSH 密钥并返回 true', async () => {
      // 预置已有密钥
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          { id: 1, name: '旧名称' },
          { id: 2, name: '其他密钥' },
        ],
      });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      // 执行更新
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: '更新成功', key: { id: 1, name: '更新后的密钥名' } },
      });

      const result = await store.updateSshKey(1, updateInput);

      expect(apiClient.put).toHaveBeenCalledWith('/ssh-keys/1', updateInput);
      expect(result).toBe(true);
      expect(store.sshKeys.find((k) => k.id === 1)?.name).toBe('更新后的密钥名');
      expect(store.isLoading).toBe(false);
    });

    it('更新后应该按名称重新排序', async () => {
      // 预置已有密钥
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          { id: 1, name: 'Zebra' },
          { id: 2, name: 'Alpha' },
        ],
      });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      // 将 Zebra 更新为 Beta
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: '更新成功', key: { id: 1, name: 'Beta' } },
      });

      await store.updateSshKey(1, { name: 'Beta' });

      const names = store.sshKeys.map((k) => k.name);
      expect(names).toEqual(['Alpha', 'Beta']);
    });

    it('当密钥 ID 不存在时不应修改列表', async () => {
      // 预置已有密钥
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [{ id: 1, name: '现有密钥' }],
      });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      // 尝试更新不存在的密钥
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: '更新成功', key: { id: 999, name: '不存在' } },
      });

      const result = await store.updateSshKey(999, updateInput);

      expect(result).toBe(true);
      // 列表不应变化
      expect(store.sshKeys).toEqual([{ id: 1, name: '现有密钥' }]);
    });

    it('更新失败时应该返回 false 并设置错误信息', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('更新失败'));
      vi.mocked(extractErrorMessage).mockReturnValue('更新 SSH 密钥 1 失败。');

      const store = useSshKeysStore();
      const result = await store.updateSshKey(1, updateInput);

      expect(result).toBe(false);
      expect(store.error).toBe('更新 SSH 密钥 1 失败。');
      expect(store.isLoading).toBe(false);
    });

    it('请求完成后 isLoading 应重置为 false', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: '成功', key: { id: 1, name: 'x' } },
      });

      const store = useSshKeysStore();
      await store.updateSshKey(1, updateInput);

      expect(store.isLoading).toBe(false);
    });
  });

  describe('deleteSshKey', () => {
    it('应该成功删除 SSH 密钥并返回 true', async () => {
      // 预置已有密钥
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          { id: 1, name: '密钥 A' },
          { id: 2, name: '密钥 B' },
        ],
      });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      // 执行删除
      vi.mocked(apiClient.delete).mockResolvedValue({
        data: { message: '删除成功' },
      });

      const result = await store.deleteSshKey(1);

      expect(apiClient.delete).toHaveBeenCalledWith('/ssh-keys/1');
      expect(result).toBe(true);
      expect(store.sshKeys).toEqual([{ id: 2, name: '密钥 B' }]);
      expect(store.isLoading).toBe(false);
    });

    it('删除后列表应不包含已删除的密钥', async () => {
      // 预置已有密钥
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [
          { id: 1, name: '密钥 A' },
          { id: 2, name: '密钥 B' },
          { id: 3, name: '密钥 C' },
        ],
      });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      vi.mocked(apiClient.delete).mockResolvedValue({
        data: { message: '删除成功' },
      });

      await store.deleteSshKey(2);

      expect(store.sshKeys.find((k) => k.id === 2)).toBeUndefined();
      expect(store.sshKeys).toHaveLength(2);
    });

    it('删除失败时应该返回 false 并设置错误信息', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('删除失败'));
      vi.mocked(extractErrorMessage).mockReturnValue('删除 SSH 密钥 1 失败。');

      const store = useSshKeysStore();
      const result = await store.deleteSshKey(1);

      expect(result).toBe(false);
      expect(store.error).toBe('删除 SSH 密钥 1 失败。');
      expect(store.isLoading).toBe(false);
    });

    it('请求完成后 isLoading 应重置为 false', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: { message: 'ok' } });

      const store = useSshKeysStore();
      await store.deleteSshKey(1);

      expect(store.isLoading).toBe(false);
    });
  });

  describe('边界条件', () => {
    it('fetchSshKeys 返回空数组时 sshKeys 应为空', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      expect(store.sshKeys).toEqual([]);
    });

    it('addSshKey 添加到空列表后列表应包含新密钥', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { message: '添加成功', key: { id: 1, name: '第一个密钥' } },
      });

      const store = useSshKeysStore();
      await store.addSshKey({ name: '第一个密钥', private_key: 'key-data' });

      expect(store.sshKeys).toHaveLength(1);
      expect(store.sshKeys[0].name).toBe('第一个密钥');
    });

    it('多次调用 fetchSshKeys 应覆盖旧数据', async () => {
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: [{ id: 1, name: '密钥 A' }] })
        .mockResolvedValueOnce({
          data: [
            { id: 1, name: '密钥 A' },
            { id: 2, name: '密钥 B' },
          ],
        });

      const store = useSshKeysStore();
      await store.fetchSshKeys();
      expect(store.sshKeys).toHaveLength(1);

      await store.fetchSshKeys();
      expect(store.sshKeys).toHaveLength(2);
    });

    it('deleteSshKey 删除不存在的密钥时 API 应正常调用', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: { message: 'ok' } });

      const store = useSshKeysStore();
      const result = await store.deleteSshKey(999);

      expect(result).toBe(true);
      expect(apiClient.delete).toHaveBeenCalledWith('/ssh-keys/999');
    });

    it('updateSshKey 的 Partial 参数应支持仅更新部分字段', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: [{ id: 1, name: '原始名称' }],
      });

      const store = useSshKeysStore();
      await store.fetchSshKeys();

      vi.mocked(apiClient.put).mockResolvedValue({
        data: { message: '更新成功', key: { id: 1, name: '新名称' } },
      });

      const result = await store.updateSshKey(1, { passphrase: 'new-pass' });

      expect(result).toBe(true);
      expect(apiClient.put).toHaveBeenCalledWith('/ssh-keys/1', { passphrase: 'new-pass' });
    });

    it('并发调用 isLoading 状态应正确切换', async () => {
      // 模拟慢速请求
      let resolveGet: (value: unknown) => void;
      vi.mocked(apiClient.get).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      );

      const store = useSshKeysStore();
      const fetchPromise = store.fetchSshKeys();

      expect(store.isLoading).toBe(true);

      resolveGet!({ data: [] });
      await fetchPromise;

      expect(store.isLoading).toBe(false);
    });

    it('error 状态在连续操作中应被正确重置', async () => {
      // 第一次操作失败
      vi.mocked(apiClient.get).mockRejectedValue(new Error('第一次失败'));
      vi.mocked(extractErrorMessage).mockReturnValue('第一次失败');

      const store = useSshKeysStore();
      await store.fetchSshKeys();
      expect(store.error).toBe('第一次失败');

      // 第二次操作成功，error 应被清除
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
      await store.fetchSshKeys();
      expect(store.error).toBeNull();
    });
  });
});
