import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from './auth.store';
import apiClient from '../utils/apiClient';
import { setLocale } from '../i18n';
import { registerLogoutRedirectHandler } from '../utils/authRuntimeBridge';

// Mock 依赖
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../i18n', () => ({
  setLocale: vi.fn(),
}));

// Mock window.location
delete (window as any).location;
(window as any).location = { href: '' };

describe('auth.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    registerLogoutRedirectHandler(null);
    window.location.href = '';
  });

  afterEach(() => {
    registerLogoutRedirectHandler(null);
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useAuthStore();
      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.loginRequires2FA).toBe(false);
      expect(store.tempToken).toBeNull();
      expect(store.ipBlacklist).toEqual({ entries: [], total: 0 });
      expect(store.needsSetup).toBe(false);
      expect(store.publicCaptchaConfig).toBeNull();
      expect(store.passkeys).toBeNull();
      expect(store.passkeysLoading).toBe(false);
      expect(store.hasPasskeysAvailable).toBe(false);
      expect(store.isInitCompleted).toBe(false);
    });
  });

  describe('clearError', () => {
    it('应该清除错误状态', () => {
      const store = useAuthStore();
      store.error = '测试错误';
      store.clearError();
      expect(store.error).toBeNull();
    });
  });

  describe('setError', () => {
    it('应该设置错误状态', () => {
      const store = useAuthStore();
      store.setError('测试错误消息');
      expect(store.error).toBe('测试错误消息');
    });
  });

  describe('login', () => {
    it('登录成功（无 2FA）应更新状态并跳转', async () => {
      const store = useAuthStore();
      const mockUser = { id: 1, username: 'testuser', language: 'zh' as const };

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: mockUser },
      });

      const result = await store.login({ username: 'testuser', password: 'pass' });

      expect(result).toEqual({ success: true });
      expect(store.isAuthenticated).toBe(true);
      expect(store.user).toEqual(mockUser);
      expect(store.loginRequires2FA).toBe(false);
      expect(setLocale).toHaveBeenCalledWith('zh');
      expect(window.location.href).toBe('/');
    });

    it('登录需要 2FA 时应返回特殊状态并保存临时令牌', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          message: '需要 2FA',
          requiresTwoFactor: true,
          tempToken: 'temp-token-123',
        },
      });

      const result = await store.login({ username: 'testuser', password: 'pass' });

      expect(result).toEqual({ requiresTwoFactor: true });
      expect(store.loginRequires2FA).toBe(true);
      expect(store.tempToken).toBe('temp-token-123');
      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
    });

    it('登录失败应设置错误状态', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '用户名或密码错误' } },
      });

      const result = await store.login({ username: 'testuser', password: 'wrong' });

      expect(result).toEqual({ success: false, error: '用户名或密码错误' });
      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
      expect(store.error).toBe('用户名或密码错误');
    });

    it('登录时应传递 CAPTCHA Token', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: { id: 1, username: 'testuser' } },
      });

      await store.login({
        username: 'testuser',
        password: 'pass',
        captchaToken: 'captcha-token',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/auth/login', {
        username: 'testuser',
        password: 'pass',
        captchaToken: 'captcha-token',
      });
    });
  });

  describe('verifyLogin2FA', () => {
    it('2FA 验证成功应更新状态并跳转', async () => {
      const store = useAuthStore();
      const mockUser = { id: 1, username: 'testuser', language: 'en' as const };

      store.loginRequires2FA = true;
      store.tempToken = 'temp-token';

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '验证成功', user: mockUser },
      });

      const result = await store.verifyLogin2FA('123456');

      expect(result).toEqual({ success: true });
      expect(store.isAuthenticated).toBe(true);
      expect(store.user).toEqual(mockUser);
      expect(store.loginRequires2FA).toBe(false);
      expect(store.tempToken).toBeNull();
      expect(window.location.href).toBe('/');
    });

    it('2FA 验证失败应设置错误状态但保持 2FA 状态', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;
      store.tempToken = 'temp-token';

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '验证码错误' } },
      });

      const result = await store.verifyLogin2FA('000000');

      expect(result).toEqual({ success: false, error: '验证码错误' });
      expect(store.error).toBe('验证码错误');
      expect(store.loginRequires2FA).toBe(true); // 保持状态
    });

    it('不在 2FA 流程时调用应抛出错误', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = false;

      await expect(store.verifyLogin2FA('123456')).rejects.toThrow('当前登录流程不需要 2FA 验证。');
    });
  });

  describe('logout', () => {
    it('登出成功应清除状态并跳转到登录页', async () => {
      const store = useAuthStore();
      const redirectToLogin = vi.fn().mockResolvedValue(undefined);
      registerLogoutRedirectHandler(redirectToLogin);
      store.isAuthenticated = true;
      store.user = { id: 1, username: 'testuser' };

      vi.mocked(apiClient.post).mockResolvedValueOnce({});

      await store.logout();

      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
      expect(redirectToLogin).toHaveBeenCalledTimes(1);
    });

    it('登出失败应设置错误状态', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '登出失败' } },
      });

      await store.logout();

      expect(store.error).toBe('登出失败');
    });
  });

  describe('checkAuthStatus', () => {
    it('已认证状态应更新用户信息', async () => {
      const store = useAuthStore();
      const mockUser = {
        id: 1,
        username: 'testuser',
        isTwoFactorEnabled: true,
        language: 'zh' as const,
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { isAuthenticated: true, user: mockUser },
      });

      await store.checkAuthStatus();

      expect(store.isAuthenticated).toBe(true);
      expect(store.user).toEqual(mockUser);
      expect(setLocale).toHaveBeenCalledWith('zh');
    });

    it('未认证状态应清除用户信息', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;
      store.user = { id: 1, username: 'testuser' };

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { isAuthenticated: false },
      });

      await store.checkAuthStatus();

      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
    });

    it('检查失败应标记为未认证', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { status: 401, data: { message: 'Unauthorized' } },
      });

      await store.checkAuthStatus();

      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('修改密码成功应返回 true', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.put).mockResolvedValueOnce({
        data: { message: '密码修改成功' },
      });

      const result = await store.changePassword('oldpass', 'newpass');

      expect(result).toBe(true);
      expect(apiClient.put).toHaveBeenCalledWith('/auth/password', {
        currentPassword: 'oldpass',
        newPassword: 'newpass',
      });
    });

    it('未登录时修改密码应抛出错误', async () => {
      const store = useAuthStore();
      store.isAuthenticated = false;

      await expect(store.changePassword('old', 'new')).rejects.toThrow(
        '用户未登录，无法修改密码。',
      );
    });

    it('修改密码失败应设置错误并抛出', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '当前密码错误' } },
      });

      await expect(store.changePassword('wrong', 'new')).rejects.toThrow('当前密码错误');
      expect(store.error).toBe('当前密码错误');
    });
  });

  describe('IP 黑名单管理', () => {
    it('fetchIpBlacklist 应获取黑名单列表', async () => {
      const store = useAuthStore();
      const mockEntries = [
        {
          ip: '192.168.1.1',
          attempts: 5,
          last_attempt_at: Date.now(),
          blocked_until: Date.now() + 3600000,
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { entries: mockEntries, total: 1 },
      });

      const result = await store.fetchIpBlacklist();

      expect(result).toEqual({ entries: mockEntries, total: 1 });
      expect(store.ipBlacklist.entries).toEqual(mockEntries);
      expect(store.ipBlacklist.total).toBe(1);
    });

    it('deleteIpFromBlacklist 应删除指定 IP', async () => {
      const store = useAuthStore();
      store.ipBlacklist.entries = [
        { ip: '192.168.1.1', attempts: 5, last_attempt_at: Date.now(), blocked_until: null },
        { ip: '192.168.1.2', attempts: 3, last_attempt_at: Date.now(), blocked_until: null },
      ];
      store.ipBlacklist.total = 2;

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      const result = await store.deleteIpFromBlacklist('192.168.1.1');

      expect(result).toBe(true);
      expect(store.ipBlacklist.entries).toHaveLength(1);
      expect(store.ipBlacklist.entries[0].ip).toBe('192.168.1.2');
      expect(store.ipBlacklist.total).toBe(1);
    });
  });

  describe('checkSetupStatus', () => {
    it('需要设置时应返回 true', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { needsSetup: true },
      });

      const result = await store.checkSetupStatus();

      expect(result).toBe(true);
      expect(store.needsSetup).toBe(true);
    });

    it('检查失败应保守假设不需要设置', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('检查失败'));

      const result = await store.checkSetupStatus();

      expect(result).toBe(false);
      expect(store.needsSetup).toBe(false);
    });
  });

  describe('fetchCaptchaConfig', () => {
    it('应从 /settings/captcha 获取配置', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          enabled: true,
          provider: 'hcaptcha' as const,
          hcaptchaSiteKey: 'site-key-123',
          hcaptchaSecretKey: 'secret',
        },
      });

      await store.fetchCaptchaConfig();

      expect(store.publicCaptchaConfig).toEqual({
        enabled: true,
        provider: 'hcaptcha',
        hcaptchaSiteKey: 'site-key-123',
        recaptchaSiteKey: undefined,
      });
    });

    it('获取失败应设置默认禁用配置', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('获取失败'));

      await store.fetchCaptchaConfig();

      expect(store.publicCaptchaConfig).toEqual({
        enabled: false,
        provider: 'none',
      });
    });
  });

  describe('Passkey 功能', () => {
    it('loginWithPasskey 成功应设置认证状态', async () => {
      const store = useAuthStore();
      const mockUser = { id: 1, username: 'testuser' };

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: mockUser },
      });

      const result = await store.loginWithPasskey('testuser', { id: 'cred-123' });

      expect(result).toEqual({ success: true });
      expect(store.isAuthenticated).toBe(true);
      expect(store.user).toEqual(mockUser);
    });

    it('fetchPasskeys 应获取用户 Passkey 列表', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      const mockBackendPasskeys = [
        {
          credential_id: 'cred-1',
          public_key: 'key-1',
          counter: 1,
          transports: ['usb', 'nfc'],
          created_at: '2023-01-01T00:00:00Z',
          last_used_at: '2023-12-01T00:00:00Z',
          name: 'My Key',
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: mockBackendPasskeys,
      });

      await store.fetchPasskeys();

      expect(store.passkeys).toHaveLength(1);
      const passkeys = store.passkeys ?? [];
      const [firstPasskey] = passkeys;
      expect(firstPasskey).toEqual({
        credentialID: 'cred-1',
        publicKey: 'key-1',
        counter: 1,
        transports: ['usb', 'nfc'],
        creationDate: '2023-01-01T00:00:00Z',
        lastUsedDate: '2023-12-01T00:00:00Z',
        name: 'My Key',
      });
    });

    it('未认证时 fetchPasskeys 应警告并清空列表', async () => {
      const store = useAuthStore();
      store.isAuthenticated = false;

      await store.fetchPasskeys();

      expect(store.passkeys).toBeNull();
    });

    it('deletePasskey 成功应刷新列表', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      const result = await store.deletePasskey('cred-1');

      expect(result).toEqual({ success: true });
      expect(apiClient.delete).toHaveBeenCalledWith('/passkey/cred-1');
    });

    it('updatePasskeyName 成功应刷新列表', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      const result = await store.updatePasskeyName('cred-1', 'New Name');

      expect(result).toEqual({ success: true });
      expect(apiClient.put).toHaveBeenCalledWith('/passkey/cred-1/name', {
        name: 'New Name',
      });
    });

    it('checkHasPasskeysConfigured 应检查是否配置了 Passkey', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { hasPasskeys: true },
      });

      const result = await store.checkHasPasskeysConfigured('testuser');

      expect(result).toBe(true);
      expect(store.hasPasskeysAvailable).toBe(true);
      expect(apiClient.get).toHaveBeenCalledWith('/auth/passkey/has-configured', {
        params: { username: 'testuser' },
      });
    });
  });

  describe('loadInitData', () => {
    it('成功加载应更新所有状态', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          needsSetup: false,
          isAuthenticated: true,
          user: { id: 1, username: 'testuser', language: 'zh' },
          captchaConfig: {
            enabled: true,
            provider: 'hcaptcha',
            hcaptchaSiteKey: 'key-123',
            recaptchaSiteKey: null,
          },
        },
      });

      await store.loadInitData();

      expect(store.needsSetup).toBe(false);
      expect(store.isAuthenticated).toBe(true);
      expect(store.user).toEqual({ id: 1, username: 'testuser', language: 'zh' });
      expect(store.publicCaptchaConfig).toEqual({
        enabled: true,
        provider: 'hcaptcha',
        hcaptchaSiteKey: 'key-123',
        recaptchaSiteKey: undefined,
      });
      expect(store.isInitCompleted).toBe(true);
      expect(setLocale).toHaveBeenCalledWith('zh');
    });

    it('无效 CAPTCHA provider 时应降级处理', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          needsSetup: false,
          isAuthenticated: false,
          user: null,
          captchaConfig: {
            enabled: false,
            provider: 'invalid-provider',
            hcaptchaSiteKey: null,
            recaptchaSiteKey: null,
          },
        },
      });

      await store.loadInitData();

      expect(store.isInitCompleted).toBe(true);
      expect(store.needsSetup).toBe(true); // 首次加载降级
    });

    it('API 失败时应标记初始化完成并保留旧状态', async () => {
      const store = useAuthStore();
      store.user = { id: 1, username: 'existing' };
      store.isAuthenticated = true;

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('network'));

      await store.loadInitData();

      expect(store.isInitCompleted).toBe(true);
      // 旧状态被保留
      expect(store.user).toEqual({ id: 1, username: 'existing' });
      expect(store.isLoading).toBe(false);
    });

    it('API 失败且无旧状态时应设置 needsSetup=true', async () => {
      const store = useAuthStore();
      // 默认状态: user=null, needsSetup=false, isAuthenticated=false

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('network'));

      await store.loadInitData();

      expect(store.isInitCompleted).toBe(true);
      expect(store.needsSetup).toBe(true);
    });
  });

  describe('loginWithPasskey', () => {
    it('登录失败应返回错误', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: 'Passkey 验证失败' } },
      });

      const result = await store.loginWithPasskey('testuser', { id: 'cred-123' });

      expect(result).toEqual({ success: false, error: 'Passkey 验证失败' });
      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
    });
  });

  describe('getPasskeyRegistrationOptions', () => {
    it('成功时应返回 FIDO2 选项', async () => {
      const store = useAuthStore();
      const mockOptions = { challenge: 'abc', rp: { name: 'test' } };

      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: mockOptions });

      const result = await store.getPasskeyRegistrationOptions('testuser');

      expect(result).toEqual(mockOptions);
      expect(apiClient.post).toHaveBeenCalledWith('/auth/passkey/registration-options', {
        username: 'testuser',
      });
    });

    it('失败时应设置 error 并抛出', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '获取选项失败' } },
      });

      await expect(store.getPasskeyRegistrationOptions('testuser')).rejects.toThrow('获取选项失败');
      expect(store.error).toBeTruthy();
    });
  });

  describe('registerPasskey', () => {
    it('成功时应返回 success', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({});

      const result = await store.registerPasskey('testuser', { id: 'cred-123' });

      expect(result).toEqual({ success: true });
    });

    it('失败时应设置 error 并抛出', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '注册失败' } },
      });

      await expect(store.registerPasskey('testuser', { id: 'cred' })).rejects.toThrow('注册失败');
      expect(store.error).toBeTruthy();
    });
  });

  describe('IP 黑名单管理 失败路径', () => {
    it('fetchIpBlacklist 失败时应设置 error 并抛出', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '获取黑名单失败' } },
      });

      await expect(store.fetchIpBlacklist()).rejects.toThrow();
      expect(store.error).toBeTruthy();
    });

    it('deleteIpFromBlacklist 失败时应设置 error 并抛出', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.delete).mockRejectedValueOnce({
        response: { data: { message: '删除失败' } },
      });

      await expect(store.deleteIpFromBlacklist('10.0.0.1')).rejects.toThrow();
      expect(store.error).toBeTruthy();
    });
  });

  describe('login 特殊路径', () => {
    it('响应既无 user 也无 requiresTwoFactor 时应返回错误', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '意外响应' },
      });

      const result = await store.login({ username: 'test', password: 'pass' });

      expect(result).toEqual({ success: false, error: expect.any(String) });
      expect(store.isAuthenticated).toBe(false);
    });
  });

  describe('Passkey 失败路径', () => {
    it('loginWithPasskey 失败时应返回错误', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: 'Passkey 登录失败' } },
      });

      const result = await store.loginWithPasskey('user', { id: 'cred' });

      expect(result).toEqual({ success: false, error: 'Passkey 登录失败' });
      expect(store.isAuthenticated).toBe(false);
    });

    it('fetchPasskeys 失败时应清空 passkeys', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('fetch failed'));

      await store.fetchPasskeys();

      expect(store.passkeys).toBeNull();
      expect(store.error).toBeTruthy();
      expect(store.passkeysLoading).toBe(false);
    });

    it('deletePasskey 未认证时应抛出错误', async () => {
      const store = useAuthStore();
      store.isAuthenticated = false;

      await expect(store.deletePasskey('cred-1')).rejects.toThrow('not authenticated');
    });

    it('deletePasskey 失败时应设置 error 并抛出', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.delete).mockRejectedValueOnce({
        response: { data: { message: '删除 Passkey 失败' } },
      });

      await expect(store.deletePasskey('cred-1')).rejects.toThrow();
      expect(store.error).toBeTruthy();
    });

    it('updatePasskeyName 未认证时应抛出错误', async () => {
      const store = useAuthStore();
      store.isAuthenticated = false;

      await expect(store.updatePasskeyName('cred-1', 'Name')).rejects.toThrow('not authenticated');
    });

    it('updatePasskeyName 失败时应设置 error 并抛出', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '更新名称失败' } },
      });

      await expect(store.updatePasskeyName('cred-1', 'Name')).rejects.toThrow();
      expect(store.error).toBeTruthy();
    });
  });

  describe('checkHasPasskeysConfigured 失败路径', () => {
    it('检查失败时应默认返回 false', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('check failed'));

      const result = await store.checkHasPasskeysConfigured('testuser');

      expect(result).toBe(false);
      expect(store.hasPasskeysAvailable).toBe(false);
    });
  });

  describe('Getters', () => {
    it('loggedInUser 应返回用户名', () => {
      const store = useAuthStore();
      store.user = { id: 1, username: 'testuser' };

      expect(store.loggedInUser).toBe('testuser');
    });

    it('loggedInUser 未登录时应返回 undefined', () => {
      const store = useAuthStore();
      store.user = null;

      expect(store.loggedInUser).toBeUndefined();
    });
  });

  describe('isLoading 状态管理', () => {
    it('login 开始时应将 isLoading 设为 true，完成后设为 false', async () => {
      const store = useAuthStore();
      let loadingDuringRequest = false;

      vi.mocked(apiClient.post).mockImplementationOnce(async () => {
        loadingDuringRequest = store.isLoading;
        return { data: { message: '成功', user: { id: 1, username: 'user' } } };
      });

      await store.login({ username: 'user', password: 'pass' });

      expect(loadingDuringRequest).toBe(true);
      expect(store.isLoading).toBe(false);
    });

    it('login 失败后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('fail'));
      await store.login({ username: 'user', password: 'wrong' });
      expect(store.isLoading).toBe(false);
    });

    it('logout 操作完成后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.post).mockResolvedValueOnce({});
      await store.logout();
      expect(store.isLoading).toBe(false);
    });

    it('checkAuthStatus 完成后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { isAuthenticated: false },
      });
      await store.checkAuthStatus();
      expect(store.isLoading).toBe(false);
    });

    it('changePassword 完成后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;
      vi.mocked(apiClient.put).mockRejectedValueOnce(new Error('fail'));
      try {
        await store.changePassword('old', 'new');
      } catch {
        // expected
      }
      expect(store.isLoading).toBe(false);
    });

    it('fetchIpBlacklist 完成后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('fail'));
      try {
        await store.fetchIpBlacklist();
      } catch {
        // expected
      }
      expect(store.isLoading).toBe(false);
    });

    it('deleteIpFromBlacklist 完成后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.delete).mockRejectedValueOnce(new Error('fail'));
      try {
        await store.deleteIpFromBlacklist('1.2.3.4');
      } catch {
        // expected
      }
      expect(store.isLoading).toBe(false);
    });

    it('getPasskeyRegistrationOptions 完成后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('fail'));
      try {
        await store.getPasskeyRegistrationOptions('user');
      } catch {
        // expected
      }
      expect(store.isLoading).toBe(false);
    });

    it('registerPasskey 完成后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('fail'));
      try {
        await store.registerPasskey('user', {});
      } catch {
        // expected
      }
      expect(store.isLoading).toBe(false);
    });

    it('loadInitData 完成后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('fail'));
      await store.loadInitData();
      expect(store.isLoading).toBe(false);
    });
  });

  describe('login 追加边界条件', () => {
    it('登录前应重置 loginRequires2FA 为 false', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: { id: 1, username: 'testuser' } },
      });

      await store.login({ username: 'testuser', password: 'pass' });

      expect(store.loginRequires2FA).toBe(false);
    });

    it('登录成功用户无 language 时不应调用 setLocale', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: { id: 1, username: 'noLangUser' } },
      });

      await store.login({ username: 'noLangUser', password: 'pass' });

      expect(setLocale).not.toHaveBeenCalled();
    });

    it('2FA 需求时 tempToken 缺失应设为 null', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '需要 2FA', requiresTwoFactor: true },
        // no tempToken field
      });

      await store.login({ username: 'testuser', password: 'pass' });

      expect(store.tempToken).toBeNull();
    });

    it('登录前应清除 error', async () => {
      const store = useAuthStore();
      store.error = '旧错误';

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: { id: 1, username: 'testuser' } },
      });

      await store.login({ username: 'testuser', password: 'pass' });

      // error should be null after successful login (not set)
      expect(store.error).toBeNull();
    });

    it('登录失败后应清除临时令牌', async () => {
      const store = useAuthStore();
      store.tempToken = 'stale-token';

      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('fail'));

      await store.login({ username: 'user', password: 'wrong' });

      expect(store.tempToken).toBeNull();
    });

    it('login 时应传递 rememberMe 标志', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: { id: 1, username: 'user' } },
      });

      await store.login({ username: 'user', password: 'pass', rememberMe: true });

      expect(apiClient.post).toHaveBeenCalledWith('/auth/login', {
        username: 'user',
        password: 'pass',
        rememberMe: true,
      });
    });
  });

  describe('verifyLogin2FA 追加边界条件', () => {
    it('验证时应在请求体中包含 tempToken', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;
      store.tempToken = 'my-temp-token';

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '验证成功', user: { id: 1, username: 'testuser' } },
      });

      await store.verifyLogin2FA('123456');

      expect(apiClient.post).toHaveBeenCalledWith('/auth/login/2fa', {
        token: '123456',
        tempToken: 'my-temp-token',
      });
    });

    it('验证前应清除之前的 error', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;
      store.error = '旧错误';

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '验证成功', user: { id: 1, username: 'user' } },
      });

      await store.verifyLogin2FA('000000');

      expect(store.error).toBeNull();
    });

    it('2FA 成功用户无 language 时不应调用 setLocale', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '验证成功', user: { id: 2, username: 'noLangUser' } },
      });

      await store.verifyLogin2FA('111111');

      expect(setLocale).not.toHaveBeenCalled();
    });

    it('验证完成后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;

      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('fail'));

      await store.verifyLogin2FA('000000');

      expect(store.isLoading).toBe(false);
    });
  });

  describe('fetchIpBlacklist 参数传递', () => {
    it('应使用默认参数 limit=50, offset=0', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { entries: [], total: 0 },
      });

      await store.fetchIpBlacklist();

      expect(apiClient.get).toHaveBeenCalledWith('/settings/ip-blacklist', {
        params: { limit: 50, offset: 0 },
      });
    });

    it('应传递自定义 limit 和 offset', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { entries: [], total: 0 },
      });

      await store.fetchIpBlacklist(10, 20);

      expect(apiClient.get).toHaveBeenCalledWith('/settings/ip-blacklist', {
        params: { limit: 10, offset: 20 },
      });
    });

    it('fetchIpBlacklist 前应清除 error', async () => {
      const store = useAuthStore();
      store.error = '旧错误';

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { entries: [], total: 0 },
      });

      await store.fetchIpBlacklist();

      expect(store.error).toBeNull();
    });
  });

  describe('deleteIpFromBlacklist 追加测试', () => {
    it('应对 IP 地址进行 URL 编码', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      await store.deleteIpFromBlacklist('192.168.1.1');

      expect(apiClient.delete).toHaveBeenCalledWith('/settings/ip-blacklist/192.168.1.1');
    });

    it('total 减少时不应低于 0', async () => {
      const store = useAuthStore();
      store.ipBlacklist.entries = [
        { ip: '1.2.3.4', attempts: 1, last_attempt_at: Date.now(), blocked_until: null },
      ];
      store.ipBlacklist.total = 0; // already 0

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      await store.deleteIpFromBlacklist('1.2.3.4');

      expect(store.ipBlacklist.total).toBe(0); // Math.max(0, 0-1) = 0
    });

    it('删除 IP 后应从 entries 中移除该条目', async () => {
      const store = useAuthStore();
      store.ipBlacklist.entries = [
        { ip: '10.0.0.1', attempts: 2, last_attempt_at: Date.now(), blocked_until: null },
        { ip: '10.0.0.2', attempts: 3, last_attempt_at: Date.now(), blocked_until: null },
      ];
      store.ipBlacklist.total = 2;

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      await store.deleteIpFromBlacklist('10.0.0.1');

      expect(store.ipBlacklist.entries).toHaveLength(1);
      expect(store.ipBlacklist.entries[0].ip).toBe('10.0.0.2');
      expect(store.ipBlacklist.total).toBe(1);
    });
  });

  describe('checkAuthStatus 追加测试', () => {
    it('认证成功用户无 language 时不应调用 setLocale', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { isAuthenticated: true, user: { id: 1, username: 'nolang' } },
      });

      await store.checkAuthStatus();

      expect(setLocale).not.toHaveBeenCalled();
    });

    it('认证成功后应将 loginRequires2FA 设为 false', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { isAuthenticated: true, user: { id: 1, username: 'user' } },
      });

      await store.checkAuthStatus();

      expect(store.loginRequires2FA).toBe(false);
    });

    it('未认证时应将 loginRequires2FA 设为 false', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { isAuthenticated: false },
      });

      await store.checkAuthStatus();

      expect(store.loginRequires2FA).toBe(false);
    });

    it('错误时应将 loginRequires2FA 设为 false', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('fail'));

      await store.checkAuthStatus();

      expect(store.loginRequires2FA).toBe(false);
    });
  });

  describe('checkHasPasskeysConfigured 追加测试', () => {
    it('不传 username 时应使用空参数对象', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { hasPasskeys: false },
      });

      await store.checkHasPasskeysConfigured();

      expect(apiClient.get).toHaveBeenCalledWith('/auth/passkey/has-configured', {
        params: {},
      });
    });

    it('成功返回 false 时应更新 hasPasskeysAvailable', async () => {
      const store = useAuthStore();
      store.hasPasskeysAvailable = true;

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { hasPasskeys: false },
      });

      const result = await store.checkHasPasskeysConfigured('user');

      expect(result).toBe(false);
      expect(store.hasPasskeysAvailable).toBe(false);
    });
  });

  describe('loginWithPasskey 追加测试', () => {
    it('应发送正确的用户名和断言响应', async () => {
      const store = useAuthStore();
      const assertion = { id: 'cred-abc', response: { clientDataJSON: 'data' } };

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '成功', user: { id: 1, username: 'user' } },
      });

      await store.loginWithPasskey('user', assertion);

      expect(apiClient.post).toHaveBeenCalledWith('/auth/passkey/authenticate', {
        username: 'user',
        assertionResponse: assertion,
      });
    });

    it('成功登录前应重置 loginRequires2FA', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '成功', user: { id: 1, username: 'user' } },
      });

      await store.loginWithPasskey('user', {});

      expect(store.loginRequires2FA).toBe(false);
    });

    it('成功登录用户有 language 时应调用 setLocale', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '成功', user: { id: 1, username: 'user', language: 'en' as const } },
      });

      await store.loginWithPasskey('user', {});

      expect(setLocale).toHaveBeenCalledWith('en');
    });

    it('登录失败后 isLoading 应为 false', async () => {
      const store = useAuthStore();
      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('fail'));
      await store.loginWithPasskey('user', {});
      expect(store.isLoading).toBe(false);
    });
  });

  describe('loadInitData 追加测试', () => {
    it('成功加载 recaptcha provider 时应正确设置配置', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          needsSetup: false,
          isAuthenticated: false,
          user: null,
          captchaConfig: {
            enabled: true,
            provider: 'recaptcha',
            hcaptchaSiteKey: null,
            recaptchaSiteKey: 'recaptcha-key',
          },
        },
      });

      await store.loadInitData();

      expect(store.publicCaptchaConfig).toEqual({
        enabled: true,
        provider: 'recaptcha',
        hcaptchaSiteKey: undefined,
        recaptchaSiteKey: 'recaptcha-key',
      });
      expect(store.isInitCompleted).toBe(true);
    });

    it('成功加载 none provider 时应正确设置配置', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          needsSetup: true,
          isAuthenticated: false,
          user: null,
          captchaConfig: {
            enabled: false,
            provider: 'none',
            hcaptchaSiteKey: null,
            recaptchaSiteKey: null,
          },
        },
      });

      await store.loadInitData();

      expect(store.publicCaptchaConfig?.provider).toBe('none');
      expect(store.needsSetup).toBe(true);
      expect(store.isInitCompleted).toBe(true);
    });

    it('API 失败但旧状态不全为默认值时不应强制 needsSetup=true', async () => {
      const store = useAuthStore();
      // Simulate a user being set (non-default state)
      store.user = { id: 1, username: 'existinguser' };
      store.isAuthenticated = true;
      store.needsSetup = false;

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('network error'));

      await store.loadInitData();

      // user is not null, so the condition (user===null && needsSetup===false && isAuthenticated===false)
      // is NOT met, so needsSetup should remain false
      expect(store.needsSetup).toBe(false);
      expect(store.isInitCompleted).toBe(true);
    });
  });

  describe('fetchPasskeys 追加测试', () => {
    it('成功时 passkeysLoading 应在加载后为 false', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.fetchPasskeys();

      expect(store.passkeysLoading).toBe(false);
    });

    it('fetching 期间 error 应被清除', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;
      store.error = '旧错误';

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.fetchPasskeys();

      // error was cleared at start of fetchPasskeys
      expect(store.error).toBeNull();
    });

    it('成功时空列表 passkeys 应为空数组', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.fetchPasskeys();

      expect(store.passkeys).toEqual([]);
    });

    it('passkey 无 transports 时应正确映射', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: [
          {
            credential_id: 'cred-abc',
            public_key: 'pub-key',
            counter: 5,
            created_at: '2024-01-01T00:00:00Z',
            last_used_at: '2024-06-01T00:00:00Z',
            // no transports, no name
          },
        ],
      });

      await store.fetchPasskeys();

      expect(store.passkeys).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const pk = store.passkeys![0];
      expect(pk.credentialID).toBe('cred-abc');
      expect(pk.transports).toBeUndefined();
      expect(pk.name).toBeUndefined();
    });
  });
});
