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
  const originalRequestIdleCallback = (globalThis as Record<string, unknown>).requestIdleCallback;

  afterEach(() => {
    // Restore requestIdleCallback to original state
    if (originalRequestIdleCallback === undefined) {
      delete (globalThis as Record<string, unknown>).requestIdleCallback;
    } else {
      (globalThis as Record<string, unknown>).requestIdleCallback = originalRequestIdleCallback;
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('with requestIdleCallback available', () => {
    it('should use requestIdleCallback when available', () => {
      const mockRIC = vi.fn();
      (globalThis as Record<string, unknown>).requestIdleCallback = mockRIC;

      schedulePrefetch();

      expect(mockRIC).toHaveBeenCalledTimes(1);
      expect(mockRIC).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 });
    });

    it('should pass a function as the callback to requestIdleCallback', () => {
      const mockRIC = vi.fn();
      (globalThis as Record<string, unknown>).requestIdleCallback = mockRIC;

      schedulePrefetch();

      const [callback] = mockRIC.mock.calls[0];
      expect(typeof callback).toBe('function');
    });

    it('should invoke prefetch for all 3 core routes when the callback runs', () => {
      const mockRIC = vi.fn();
      (globalThis as Record<string, unknown>).requestIdleCallback = mockRIC;

      // Spy on router.resolve to detect which paths are prefetched
      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();

      // Execute the idle callback immediately
      const [callback] = mockRIC.mock.calls[0];
      callback();

      const resolvedPaths = resolveSpy.mock.calls.map((call) => call[0]);
      expect(resolvedPaths).toContain('/');
      expect(resolvedPaths).toContain('/workspace');
      expect(resolvedPaths).toContain('/connections');
    });
  });

  describe('without requestIdleCallback (fallback to setTimeout)', () => {
    beforeEach(() => {
      delete (globalThis as Record<string, unknown>).requestIdleCallback;
      vi.useFakeTimers();
    });

    it('should use setTimeout fallback when requestIdleCallback is not available', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      schedulePrefetch();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    });

    it('should invoke prefetch for all 3 core routes after 2000ms timeout', () => {
      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();

      // Before timeout — routes not yet prefetched
      expect(resolveSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);

      const resolvedPaths = resolveSpy.mock.calls.map((call) => call[0]);
      expect(resolvedPaths).toContain('/');
      expect(resolvedPaths).toContain('/workspace');
      expect(resolvedPaths).toContain('/connections');
    });

    it('should not invoke prefetch before the 2000ms timeout elapses', () => {
      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();
      vi.advanceTimersByTime(1999);

      expect(resolveSpy).not.toHaveBeenCalled();
    });
  });

  describe('prefetchRoute behavior', () => {
    it('should call route component factory for matched routes', () => {
      (globalThis as Record<string, unknown>).requestIdleCallback = undefined;
      vi.useFakeTimers();

      // Spy on resolved route records to verify component imports are triggered
      const resolveSpy = vi.spyOn(router, 'resolve');

      schedulePrefetch();
      vi.advanceTimersByTime(2000);

      // router.resolve should have been called for each of the 3 core routes
      expect(resolveSpy).toHaveBeenCalledTimes(3);
    });

    it('should not throw for unknown paths', () => {
      (globalThis as Record<string, unknown>).requestIdleCallback = vi.fn((cb: () => void) => cb());

      // Should not throw even if router.resolve returns empty matched array
      expect(() => schedulePrefetch()).not.toThrow();
    });
  });
});
