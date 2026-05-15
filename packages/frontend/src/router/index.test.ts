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
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('当 requestIdleCallback 可用时', () => {
    it('应调用 requestIdleCallback 而不是 setTimeout', () => {
      vi.useFakeTimers();
      const mockRIC = vi.fn();
      vi.stubGlobal('requestIdleCallback', mockRIC);

      schedulePrefetch();

      expect(mockRIC).toHaveBeenCalled();
    });

    it('requestIdleCallback 应传入 timeout: 5000', () => {
      vi.useFakeTimers();
      const mockRIC = vi.fn();
      vi.stubGlobal('requestIdleCallback', mockRIC);

      schedulePrefetch();

      expect(mockRIC).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 });
    });

    it('requestIdleCallback 回调应触发核心路由预加载', () => {
      vi.useFakeTimers();
      const resolveSpy = vi.spyOn(router, 'resolve');

      let capturedCallback: (() => void) | null = null;
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        capturedCallback = cb;
      });

      schedulePrefetch();
      // Execute the idle callback
      capturedCallback?.();

      // Should attempt to resolve core routes
      const resolvedPaths = resolveSpy.mock.calls.map((call) => call[0]);
      expect(resolvedPaths).toContain('/');
      expect(resolvedPaths).toContain('/workspace');
      expect(resolvedPaths).toContain('/connections');

      resolveSpy.mockRestore();
    });
  });

  describe('当 requestIdleCallback 不可用时', () => {
    it('应使用 setTimeout 作为降级方案', () => {
      vi.useFakeTimers();
      // Remove requestIdleCallback from global scope
      vi.stubGlobal('requestIdleCallback', undefined);

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      schedulePrefetch();

      expect(setTimeoutSpy).toHaveBeenCalled();
    });

    it('setTimeout 延迟应为 2000ms', () => {
      vi.useFakeTimers();
      vi.stubGlobal('requestIdleCallback', undefined);

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      schedulePrefetch();

      const timeoutCalls = setTimeoutSpy.mock.calls;
      const prefetchCall = timeoutCalls.find((call) => call[1] === 2000);
      expect(prefetchCall).toBeDefined();
    });

    it('setTimeout 回调执行后应触发路由预加载', () => {
      vi.useFakeTimers();
      vi.stubGlobal('requestIdleCallback', undefined);

      const resolveSpy = vi.spyOn(router, 'resolve');
      schedulePrefetch();

      // Advance timers to trigger the setTimeout callback
      vi.advanceTimersByTime(2000);

      const resolvedPaths = resolveSpy.mock.calls.map((call) => call[0]);
      expect(resolvedPaths).toContain('/');
      expect(resolvedPaths).toContain('/workspace');
      expect(resolvedPaths).toContain('/connections');

      resolveSpy.mockRestore();
    });
  });

  describe('核心路由预加载顺序', () => {
    it('预加载顺序应为 Dashboard > Workspace > Connections', () => {
      vi.useFakeTimers();
      const resolveSpy = vi.spyOn(router, 'resolve');

      let capturedCallback: (() => void) | null = null;
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        capturedCallback = cb;
      });

      schedulePrefetch();
      capturedCallback?.();

      const resolvedPaths = resolveSpy.mock.calls.map((call) => call[0]);
      const dashIndex = resolvedPaths.indexOf('/');
      const workspaceIndex = resolvedPaths.indexOf('/workspace');
      const connectionsIndex = resolvedPaths.indexOf('/connections');

      expect(dashIndex).toBeLessThan(workspaceIndex);
      expect(workspaceIndex).toBeLessThan(connectionsIndex);

      resolveSpy.mockRestore();
    });

    it('所有 3 个核心路由都应被预加载', () => {
      vi.useFakeTimers();
      const resolveSpy = vi.spyOn(router, 'resolve');

      let capturedCallback: (() => void) | null = null;
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        capturedCallback = cb;
      });

      schedulePrefetch();
      capturedCallback?.();

      const resolvedPaths = resolveSpy.mock.calls.map((call) => call[0]);
      expect(resolvedPaths.filter((p) => p === '/')).toHaveLength(1);
      expect(resolvedPaths.filter((p) => p === '/workspace')).toHaveLength(1);
      expect(resolvedPaths.filter((p) => p === '/connections')).toHaveLength(1);

      resolveSpy.mockRestore();
    });
  });

  describe('schedulePrefetch 导出', () => {
    it('schedulePrefetch 应该是一个函数', () => {
      expect(typeof schedulePrefetch).toBe('function');
    });

    it('调用时不应抛出错误', () => {
      vi.useFakeTimers();
      vi.stubGlobal('requestIdleCallback', undefined);
      expect(() => schedulePrefetch()).not.toThrow();
    });
  });
});
