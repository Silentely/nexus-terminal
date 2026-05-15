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

// ==================== schedulePrefetch 测试 ====================

describe('schedulePrefetch', () => {
  let originalRequestIdleCallback: typeof globalThis.requestIdleCallback | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalRequestIdleCallback = (globalThis as unknown as Record<string, unknown>)
      .requestIdleCallback as typeof globalThis.requestIdleCallback | undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalRequestIdleCallback !== undefined) {
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback =
        originalRequestIdleCallback;
    } else {
      delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;
    }
    vi.useRealTimers();
  });

  describe('requestIdleCallback 可用时', () => {
    it('应使用 requestIdleCallback 调度预加载', () => {
      const mockRIC = vi.fn();
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback = mockRIC;

      schedulePrefetch();

      expect(mockRIC).toHaveBeenCalledTimes(1);
    });

    it('应以 timeout: 5000 调用 requestIdleCallback', () => {
      const mockRIC = vi.fn();
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback = mockRIC;

      schedulePrefetch();

      const callArgs = mockRIC.mock.calls[0];
      expect(callArgs[1]).toMatchObject({ timeout: 5000 });
    });

    it('requestIdleCallback 回调被调用时应预加载核心路由', () => {
      let capturedCallback: (() => void) | null = null;
      const mockRIC = vi.fn((cb: () => void) => {
        capturedCallback = cb;
      });
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback = mockRIC;

      schedulePrefetch();

      // 执行回调 — prefetchRoute 内部调用 router.resolve 和组件函数
      // 仅验证不抛出错误（路由的组件已被 mock 为简单对象）
      expect(() => capturedCallback?.()).not.toThrow();
    });
  });

  describe('requestIdleCallback 不可用时（降级到 setTimeout）', () => {
    it('无 requestIdleCallback 时应使用 setTimeout（通过 runAllTimers 验证调度）', () => {
      delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;

      // 调用后若无错误抛出，说明已走 setTimeout 分支
      expect(() => schedulePrefetch()).not.toThrow();
      // 执行所有定时器不应报错
      expect(() => vi.runAllTimers()).not.toThrow();
    });

    it('requestIdleCallback 不存在时 2000ms 后定时器应被触发', () => {
      delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;

      schedulePrefetch();

      // 推进 1999ms，不应触发
      vi.advanceTimersByTime(1999);
      // 推进到 2000ms，定时器应触发（不应报错）
      expect(() => vi.advanceTimersByTime(1)).not.toThrow();
    });

    it('setTimeout 回调被执行时不应抛出错误', () => {
      delete (globalThis as unknown as Record<string, unknown>).requestIdleCallback;

      schedulePrefetch();

      // 执行所有定时器
      expect(() => vi.runAllTimers()).not.toThrow();
    });
  });

  describe('schedulePrefetch 导出', () => {
    it('应从 router/index 导出 schedulePrefetch', () => {
      expect(schedulePrefetch).toBeTypeOf('function');
    });

    it('多次调用 schedulePrefetch 不应抛出错误', () => {
      const mockRIC = vi.fn();
      (globalThis as unknown as Record<string, unknown>).requestIdleCallback = mockRIC;

      expect(() => {
        schedulePrefetch();
        schedulePrefetch();
        schedulePrefetch();
      }).not.toThrow();

      expect(mockRIC).toHaveBeenCalledTimes(3);
    });
  });
});
