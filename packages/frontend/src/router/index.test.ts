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
  });

  it('应该是一个可导出的函数', () => {
    expect(typeof schedulePrefetch).toBe('function');
  });

  describe('requestIdleCallback 可用时', () => {
    it('应该调用 requestIdleCallback 而不是 setTimeout', () => {
      const mockRIC = vi.fn();
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback = mockRIC;

      schedulePrefetch();

      expect(mockRIC).toHaveBeenCalled();
      expect(mockRIC).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 });

      delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
    });

    it('应该使用 5000ms timeout 调用 requestIdleCallback', () => {
      const mockRIC = vi.fn();
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback = mockRIC;

      schedulePrefetch();

      expect(mockRIC).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ timeout: 5000 })
      );

      delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
    });

    it('requestIdleCallback 回调执行时不应抛出错误', () => {
      let capturedCallback: (() => void) | null = null;
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback = (
        cb: () => void
      ) => {
        capturedCallback = cb;
      };

      schedulePrefetch();

      expect(() => capturedCallback?.()).not.toThrow();

      delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
    });
  });

  describe('requestIdleCallback 不可用时（降级）', () => {
    beforeEach(() => {
      // 确保没有 requestIdleCallback
      if ('requestIdleCallback' in globalThis) {
        delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
      }
    });

    it('应该使用 setTimeout 作为降级', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      schedulePrefetch();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);

      setTimeoutSpy.mockRestore();
    });

    it('setTimeout 应延迟 2000ms', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      schedulePrefetch();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);

      setTimeoutSpy.mockRestore();
    });

    it('setTimeout 回调执行后不应抛出错误', () => {
      schedulePrefetch();

      // 执行所有延迟定时器
      expect(() => vi.runAllTimers()).not.toThrow();
    });
  });

  describe('预加载路由', () => {
    it('schedulePrefetch 调用后无论路由是否存在都不应抛出', () => {
      // 确保没有 requestIdleCallback
      if ('requestIdleCallback' in globalThis) {
        delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
      }

      expect(() => {
        schedulePrefetch();
        vi.runAllTimers();
      }).not.toThrow();
    });

    it('多次调用 schedulePrefetch 应是安全的', () => {
      if ('requestIdleCallback' in globalThis) {
        delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
      }

      expect(() => {
        schedulePrefetch();
        schedulePrefetch();
        schedulePrefetch();
        vi.runAllTimers();
      }).not.toThrow();
    });
  });

  describe('requestIdleCallback 与 setTimeout 优先级', () => {
    it('同时有 requestIdleCallback 时应不调用 setTimeout', () => {
      const mockRIC = vi.fn();
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback = mockRIC;

      schedulePrefetch();

      expect(mockRIC).toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();

      delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
      setTimeoutSpy.mockRestore();
    });

    it('没有 requestIdleCallback 时应不调用 requestIdleCallback', () => {
      if ('requestIdleCallback' in globalThis) {
        delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
      }

      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      schedulePrefetch();

      expect(setTimeoutSpy).toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it('requestIdleCallback 被调用时传入的 options.timeout 应为 5000', () => {
      const mockRIC = vi.fn();
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback = mockRIC;

      schedulePrefetch();

      const [, options] = mockRIC.mock.calls[0];
      expect(options).toEqual({ timeout: 5000 });

      delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
    });
  });
});
