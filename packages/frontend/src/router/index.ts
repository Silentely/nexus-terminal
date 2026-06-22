import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { log } from '@/utils/log';

// 路由配置
const routes: Array<RouteRecordRaw> = [
  // 首页/仪表盘 (占位符)
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/DashboardView.vue'), // 指向实际的仪表盘组件
    // component: { template: '<div>仪表盘 (建设中)</div>' } // 移除临时占位
  },
  // 登录页面 (占位符)
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'), // 指向实际的登录组件
  },
  // 代理管理页面
  {
    path: '/proxies',
    name: 'Proxies',
    component: () => import('../views/ProxiesView.vue'),
  },
  // 连接管理页面
  {
    path: '/connections',
    name: 'Connections',
    component: () => import('../views/ConnectionsView.vue'),
  },
  // 移除：标签管理页面路由
  // {
  //   path: '/tags',
  //   name: 'Tags',
  //   component: () => import('../views/TagsView.vue')
  // },
  // 工作区页面 (不再需要 connectionId 参数)
  {
    path: '/workspace', // 移除动态路由段
    name: 'Workspace',
    component: () => import('../views/WorkspaceView.vue'),
    // props: true // 不再需要传递 props
  },
  // 设置页面
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/SettingsView.vue'),
  },
  // 通知管理页面
  {
    path: '/notifications',
    name: 'Notifications',
    component: () => import('../views/NotificationsView.vue'),
  },
  // 审计日志页面
  {
    path: '/audit-logs',
    name: 'AuditLogs',
    component: () => import('../views/AuditLogView.vue'),
  },
  // AI 审计分析页面
  {
    path: '/ai-audit',
    name: 'AiAudit',
    component: () => import('../views/AiAuditView.vue'),
  },
  // 初始设置页面
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('../views/SetupView.vue'),
  },
  // 404 兜底路由：未匹配的路径重定向到首页
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL), // 使用 HTML5 History 模式
  routes,
});

// 添加全局前置守卫
router.beforeEach(async (to) => {
  const { useAuthStore } = await import('../stores/auth.store');
  const authStore = useAuthStore();

  // 定义不需要认证的路由名称列表 (现在包括 Setup)
  const publicRoutes = ['Login', 'Setup'];
  const requiresAuth = !publicRoutes.includes(to.name as string);

  // 如果初始化尚未完成，允许导航（让 main.ts 完成初始化后再重定向）
  // 这样可以避免基于不完整的状态做决策，导致 UI 闪烁
  if (!authStore.isInitCompleted) {
    log.info('路由守卫：初始化尚未完成，允许导航（等待 main.ts 完成初始化）');
    return true;
  }

  // 初始化完成后，根据最新状态做导航决策
  const { needsSetup } = authStore; // 从 authStore 获取状态

  if (needsSetup && to.name !== 'Setup') {
    // 如果需要设置，但目标不是设置页面，则强制重定向到设置页面
    log.info('路由守卫：需要初始设置，重定向到 /setup');
    return { name: 'Setup' };
  } else if (!needsSetup && to.name === 'Setup') {
    // 如果不需要设置，但尝试访问设置页面，重定向到登录页或首页
    log.info('路由守卫：不需要设置，从 /setup 重定向');
    return authStore.isAuthenticated ? { name: 'Dashboard' } : { name: 'Login' };
  } else if (requiresAuth && !authStore.isAuthenticated && !needsSetup) {
    // 如果需要认证、用户未登录且不需要设置，重定向到登录页
    log.info('路由守卫：未登录，重定向到 /login');
    return { name: 'Login' };
  } else if (to.name === 'Login' && authStore.isAuthenticated && !needsSetup) {
    // 如果用户已登录、不需要设置且尝试访问登录页，重定向到仪表盘
    log.info('路由守卫：已登录，从 /login 重定向到 /');
    return { name: 'Dashboard' };
  }
  // 其他情况（例如访问公共页面，或已登录访问需认证页面）允许导航
  return true;
});

/**
 * Preloads lazy-loaded chunks for a given route.
 *
 * Resolves the route and invokes any lazy component import factories found on matched route records so the browser can fetch the corresponding chunks ahead of navigation.
 *
 * @param path - A router-resolvable location (for example a URL path or named route) identifying which route's chunks to preload
 */
function prefetchRoute(path: string) {
  try {
    const route = router.resolve(path);
    if (route.matched.length > 0) {
      // 触发路由组件的 dynamic import，浏览器会自动下载对应 chunk
      route.matched.forEach((record) => {
        if (typeof record.components?.default === 'function') {
          (record.components.default as () => Promise<unknown>)().catch(() => {
            // chunk 下载失败不影响用户体验，后续导航时会重试
          });
        }
      });
    }
  } catch {
    // 路由解析失败时静默忽略
  }
}

/**
 * Schedules prefetching of core route chunks when the browser is idle.
 *
 * Prefetches Dashboard (`/`), Workspace (`/workspace`), and Connections (`/connections`) in that priority order.
 * Uses `requestIdleCallback` with a 5000ms timeout when available, otherwise falls back to a 2000ms delayed `setTimeout`.
 */
function schedulePrefetch() {
  const CORE_ROUTES = ['/', '/workspace', '/connections'];

  const doPrefetch = () => {
    CORE_ROUTES.forEach((path) => prefetchRoute(path));
  };

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(doPrefetch, { timeout: 5000 });
  } else {
    // 降级：延迟 2 秒后执行
    setTimeout(doPrefetch, 2000);
  }
}

export { schedulePrefetch };
export default router;
