import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth.store'; // 导入 Auth Store

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
  // 初始设置页面
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('../views/SetupView.vue'),
  },
  // 其他路由...
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL), // 使用 HTML5 History 模式
  routes,
});

// 添加全局前置守卫
router.beforeEach((to, from, next) => {
  // 在守卫内部获取 store 实例，确保 Pinia 已初始化
  const authStore = useAuthStore();

  // 定义不需要认证的路由名称列表
  // 定义不需要认证的路由名称列表 (现在包括 Setup)
  const publicRoutes = ['Login', 'Setup'];
  const requiresAuth = !publicRoutes.includes(to.name as string);

  // 假设有一个状态表示是否需要初始设置，这里暂时用一个变量模拟
  // 实际应用中，这个状态应该在应用启动时通过 API 获取
  const { needsSetup } = authStore; // 从 authStore 获取状态

  if (needsSetup && to.name !== 'Setup') {
    // 如果需要设置，但目标不是设置页面，则强制重定向到设置页面
    console.log('路由守卫：需要初始设置，重定向到 /setup');
    next({ name: 'Setup' });
  } else if (!needsSetup && to.name === 'Setup') {
    // 如果不需要设置，但尝试访问设置页面，重定向到登录页或首页
    console.log('路由守卫：不需要设置，从 /setup 重定向');
    next(authStore.isAuthenticated ? { name: 'Dashboard' } : { name: 'Login' });
  } else if (requiresAuth && !authStore.isAuthenticated && !needsSetup) {
    // 如果需要认证、用户未登录且不需要设置，重定向到登录页
    console.log('路由守卫：未登录，重定向到 /login');
    next({ name: 'Login' });
  } else if (to.name === 'Login' && authStore.isAuthenticated && !needsSetup) {
    // 如果用户已登录、不需要设置且尝试访问登录页，重定向到仪表盘
    console.log('路由守卫：已登录，从 /login 重定向到 /');
    next({ name: 'Dashboard' });
  } else {
    // 其他情况（例如访问公共页面，或已登录访问需认证页面）允许导航
    next();
  }
});

export default router;
