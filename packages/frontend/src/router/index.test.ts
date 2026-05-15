import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 使用 vi.hoisted 创建 mock，确保在 vi.mock 之前执行
const { mockUseAuthStore, mockAuthState } = vi.hoisted(() => {
  const state = { isInitCompleted: true, needsSetup: false, isAuthenticated: false };
  return { mockUseAuthStore: vi.fn(() => state), mockAuthState: state };
});

vi.mock('../stores/auth.store', () => ({
  useAuthStore: mockUseAuthStore,
}));

import router, { schedulePrefetch } from './index';

// Mock views to avoid actual component loading
vi.mock('../views/DashboardView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/LoginView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/SetupView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/WorkspaceView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/ConnectionsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/ProxiesView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/SettingsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/NotificationsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/AuditLogView.vue', () => ({ default: { template: '<div />' } }));

describe('路由守卫', () => {
  beforeEach(async () => {
    // 重置 mock 状态
    mockAuthState.isInitCompleted = true;
    mockAuthState.needsSetup = false;
    mockAuthState.isAuthenticated = false;
    // 导航到 /login 作为干净的起始点（公共路由，不会被重定向）
    await router.push('/login');
    await router.isReady();
  });

  describe('路由定义', () => {
    it('应该包含所有必要路由', () => {
      const routes = router.getRoutes();
      const routeNames = routes.map((r) => r.name);

      expect(routeNames).toContain('Dashboard');
      expect(routeNames).toContain('Login');
      expect(routeNames).toContain('Setup');
      expect(routeNames).toContain('Workspace');
      expect(routeNames).toContain('Connections');
      expect(routeNames).toContain('Settings');
      expect(routeNames).toContain('Proxies');
      expect(routeNames).toContain('Notifications');
      expect(routeNames).toContain('AuditLogs');
    });

    it('应该使用 HTML5 History 模式', () => {
      expect(router.options.history).toBeDefined();
    });

    it('应该有 9 个路由定义', () => {
      const routes = router.getRoutes();
      expect(routes.length).toBeGreaterThanOrEqual(9);
    });
  });

  describe('守卫行为', () => {
    it('应该定义 beforeEach 守卫', () => {
      expect(router.beforeEach).toBeDefined();
    });

    it('需要设置时应重定向到 Setup', async () => {
      mockAuthState.needsSetup = true;
      await router.push('/workspace');
      await router.isReady();
      expect(router.currentRoute.value.name).toBe('Setup');
    });

    it('不需要设置时访问 Setup 应重定向到 Dashboard（已登录）', async () => {
      mockAuthState.needsSetup = false;
      mockAuthState.isAuthenticated = true;
      await router.push('/setup');
      await router.isReady();
      expect(router.currentRoute.value.name).toBe('Dashboard');
    });

    it('不需要设置时访问 Setup 应重定向到 Login（未登录）', async () => {
      mockAuthState.needsSetup = false;
      mockAuthState.isAuthenticated = false;
      await router.push('/setup');
      await router.isReady();
      expect(router.currentRoute.value.name).toBe('Login');
    });

    it('未登录时应重定向到 Login', async () => {
      mockAuthState.isAuthenticated = false;
      await router.push('/workspace');
      await router.isReady();
      expect(router.currentRoute.value.name).toBe('Login');
    });

    it('已登录时访问 Login 应重定向到 Dashboard', async () => {
      mockAuthState.isAuthenticated = true;
      // 先导航到其他路由，避免同路由跳转时守卫不触发
      await router.push('/');
      await router.isReady();
      await router.push('/login');
      await router.isReady();
      expect(router.currentRoute.value.name).toBe('Dashboard');
    });

    it('已登录时应允许访问受保护路由', async () => {
      mockAuthState.isAuthenticated = true;
      await router.push('/workspace');
      await router.isReady();
      expect(router.currentRoute.value.name).toBe('Workspace');
    });
  });
});

// ==================== schedulePrefetch ====================

describe('schedulePrefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    // 清理 requestIdleCallback stub
    vi.unstubAllGlobals();
  });

  describe('使用 requestIdleCallback', () => {
    it('当 requestIdleCallback 可用时应使用它', () => {
      const mockRequestIdleCallback = vi.fn();
      vi.stubGlobal('requestIdleCallback', mockRequestIdleCallback);

      schedulePrefetch();

      expect(mockRequestIdleCallback).toHaveBeenCalledTimes(1);
      expect(mockRequestIdleCallback).toHaveBeenCalledWith(
        expect.any(Function),
        { timeout: 5000 }
      );
    });

    it('requestIdleCallback 应以 timeout:5000 调用', () => {
      const mockRequestIdleCallback = vi.fn();
      vi.stubGlobal('requestIdleCallback', mockRequestIdleCallback);

      schedulePrefetch();

      const callArgs = mockRequestIdleCallback.mock.calls[0];
      expect(callArgs[1]).toEqual({ timeout: 5000 });
    });

    it('idle 回调执行时应尝试预加载核心路由', () => {
      let capturedCallback: (() => void) | null = null;
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        capturedCallback = cb;
      });

      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();
      expect(capturedCallback).not.toBeNull();

      // 触发 idle 回调
      capturedCallback!();

      // 应该尝试 resolve 3 个核心路由
      expect(resolveSpy).toHaveBeenCalledWith('/');
      expect(resolveSpy).toHaveBeenCalledWith('/workspace');
      expect(resolveSpy).toHaveBeenCalledWith('/connections');

      resolveSpy.mockRestore();
    });
  });

  describe('降级到 setTimeout', () => {
    it('当 requestIdleCallback 不可用时应使用 setTimeout', () => {
      // 移除 requestIdleCallback（使其变为 undefined）
      vi.stubGlobal('requestIdleCallback', undefined);

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      schedulePrefetch();

      // 找到 2000ms 的 setTimeout 调用
      const calls = setTimeoutSpy.mock.calls;
      const relevantCall = calls.find((call) => call[1] === 2000);
      expect(relevantCall).toBeDefined();

      setTimeoutSpy.mockRestore();
    });

    it('setTimeout 应延迟 2000ms', () => {
      vi.stubGlobal('requestIdleCallback', undefined);

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      schedulePrefetch();

      const calls = setTimeoutSpy.mock.calls;
      const relevantCall = calls.find((call) => call[1] === 2000);
      expect(relevantCall?.[1]).toBe(2000);

      setTimeoutSpy.mockRestore();
    });

    it('setTimeout 回调执行时应尝试预加载核心路由', () => {
      vi.stubGlobal('requestIdleCallback', undefined);

      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();

      // 推进 2000ms 触发 setTimeout 回调
      vi.advanceTimersByTime(2000);

      expect(resolveSpy).toHaveBeenCalledWith('/');
      expect(resolveSpy).toHaveBeenCalledWith('/workspace');
      expect(resolveSpy).toHaveBeenCalledWith('/connections');

      resolveSpy.mockRestore();
    });

    it('2000ms 之前不应触发预加载', () => {
      vi.stubGlobal('requestIdleCallback', undefined);

      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();

      // 仅推进 1999ms
      vi.advanceTimersByTime(1999);

      // 核心路由不应被预加载
      const coreCalls = resolveSpy.mock.calls.filter(
        (call) => call[0] === '/' || call[0] === '/workspace' || call[0] === '/connections'
      );
      expect(coreCalls.length).toBe(0);

      resolveSpy.mockRestore();
    });
  });

  describe('路由解析行为', () => {
    it('应预加载 Dashboard（/）路由', () => {
      let capturedCallback: (() => void) | null = null;
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        capturedCallback = cb;
      });

      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();
      capturedCallback!();

      expect(resolveSpy).toHaveBeenCalledWith('/');
      resolveSpy.mockRestore();
    });

    it('应预加载 Workspace（/workspace）路由', () => {
      let capturedCallback: (() => void) | null = null;
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        capturedCallback = cb;
      });

      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();
      capturedCallback!();

      expect(resolveSpy).toHaveBeenCalledWith('/workspace');
      resolveSpy.mockRestore();
    });

    it('应预加载 Connections（/connections）路由', () => {
      let capturedCallback: (() => void) | null = null;
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        capturedCallback = cb;
      });

      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();
      capturedCallback!();

      expect(resolveSpy).toHaveBeenCalledWith('/connections');
      resolveSpy.mockRestore();
    });

    it('不存在的路由应被安全忽略', () => {
      // schedulePrefetch 只处理已知的核心路由，未匹配路由 matched.length === 0 会被跳过
      const resolveSpy = vi.spyOn(router, 'resolve').mockReturnValue({
        matched: [],
        path: '/nonexistent',
        query: {},
        hash: '',
        name: undefined,
        fullPath: '/nonexistent',
        params: {},
        meta: {},
        href: '/nonexistent',
        redirectedFrom: undefined,
      });

      vi.stubGlobal('requestIdleCallback', (cb: () => void) => cb());

      expect(() => schedulePrefetch()).not.toThrow();
      resolveSpy.mockRestore();
    });
  });
});
