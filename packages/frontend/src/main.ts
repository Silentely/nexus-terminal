import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router, { schedulePrefetch } from './router';
import i18n from './i18n';
import { useAuthStore } from './stores/auth.store';
import { useSettingsStore } from './stores/settings.store';
import { useAppearanceStore } from './stores/appearance.store';
import {
  registerLogoutRedirectHandler,
  registerUnauthorizedLogoutHandler,
} from './utils/authRuntimeBridge';
import './style.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import 'splitpanes/dist/splitpanes.css';
import { useUiNotificationsStore } from './stores/uiNotifications.store';
import { log } from '@/utils/log';
// Element Plus styles are now auto-imported via unplugin-vue-components

const pinia = createPinia(); // 创建 Pinia 实例
pinia.use(piniaPluginPersistedstate); // 使用持久化插件

const app = createApp(App);

app.use(pinia); // 使用配置好的 Pinia 实例
app.use(router); // 立即启用路由,不再等待初始化完成
app.use(i18n); // 使用 i18n

const setupWebManifestLink = async () => {
  try {
    const response = await fetch('/manifest.json', {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'manual',
    });
    if (!response.ok || response.type === 'opaqueredirect') {
      return;
    }
    const manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = '/manifest.json';
    document.head.appendChild(manifestLink);
  } catch (error: unknown) {
    // 在受保护网关场景中，manifest 可能被重定向到登录页
    log.debug('[main.ts] manifest 链接添加失败（可能被网关拦截）:', error);
  }
};

// --- 应用初始化逻辑 (优化版:先挂载,后加载数据) ---
(async () => {
  const authStore = useAuthStore(pinia); // 实例化 Auth Store
  const appearanceStore = useAppearanceStore(pinia); // 提前实例化 AppearanceStore
  registerLogoutRedirectHandler(async () => {
    await router.push({ name: 'Login' });
  });
  registerUnauthorizedLogoutHandler(async () => {
    if (!authStore.isAuthenticated) {
      return false;
    }
    log.warn('Unauthorized access detected. Logging out.');
    await authStore.logout();
    return true;
  });

  try {
    log.info('[main.ts] 开始初始化应用...');

    // 1. 立即挂载应用,不等待数据加载
    await router.isReady(); // 等待路由初始化完成
    app.mount('#app');
    log.info('[main.ts] 应用已挂载,开始后台加载数据...');

    // 2. 后台异步加载初始化数据 (使用新的统一API)
    await authStore.loadInitData();
    log.info(
      `[main.ts] 初始化数据加载完成: needsSetup=${authStore.needsSetup}, isAuthenticated=${authStore.isAuthenticated}`,
    );

    // 3. 数据加载完成后,检查是否需要重定向
    const currentRoute = router.currentRoute.value;

    // 优先级1: 需要初始设置
    if (authStore.needsSetup && currentRoute.name !== 'Setup') {
      log.info('[main.ts] 需要初始设置,重定向到 /setup');
      router.push({ name: 'Setup' });
    }
    // 优先级2: 已登录用户在登录页，重定向到仪表盘
    else if (!authStore.needsSetup && currentRoute.name === 'Login' && authStore.isAuthenticated) {
      log.info('[main.ts] 已登录用户在登录页,重定向到仪表盘');
      router.push({ name: 'Dashboard' });
    }
    // 优先级3: 不需要设置但在设置页
    else if (!authStore.needsSetup && currentRoute.name === 'Setup') {
      log.info('[main.ts] 不需要设置,从 /setup 重定向');
      router.push(authStore.isAuthenticated ? { name: 'Dashboard' } : { name: 'Login' });
    }
    // 优先级4: 未认证用户访问受保护页面
    else if (
      !authStore.isAuthenticated &&
      currentRoute.name !== 'Login' &&
      currentRoute.name !== 'Setup'
    ) {
      log.info('[main.ts] 用户未认证,重定向到 /login');
      router.push({ name: 'Login' });
    }

    // 4. 如果用户已认证,加载用户特定数据
    if (!authStore.needsSetup && authStore.isAuthenticated) {
      log.info('[main.ts] 用户已认证,加载设置和外观数据...');
      const settingsStore = useSettingsStore(pinia);
      try {
        await Promise.all([
          settingsStore.loadInitialSettings(),
          appearanceStore.loadInitialAppearanceData(),
        ]);
        log.info('[main.ts] 用户设置和外观数据加载完成。');
      } catch (error: unknown) {
        log.error('[main.ts] 加载用户设置或外观数据失败:', error);
        // 加载失败也继续,可能使用默认值或显示错误
      }

      // 认证完成后预加载核心路由 chunk，减少后续页面切换的加载时间
      schedulePrefetch();
    }
  } catch (error: unknown) {
    // 捕获初始化过程中的意外错误
    log.error('[main.ts] 应用初始化过程中发生严重错误:', error);
    // 即使发生严重错误,应用也已经挂载,可能显示错误页面或回退状态
  }

  // --- PWA Service Worker Registration ---
  await setupWebManifestLink();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          log.info('SW registered: ', registration);

          // 检测 SW 更新：当有新的 Service Worker 进入 waiting 状态时通知用户刷新
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // 新 SW 已安装但尚未激活，通过通知系统提示用户刷新
                log.info('[SW] 新版本已就绪，等待用户确认刷新');
                try {
                  const uiNotificationsStore = useUiNotificationsStore();
                  uiNotificationsStore.addNotification({
                    type: 'info',
                    message: '应用有新版本可用，请刷新页面以获取最新内容。',
                    timeout: 0,
                  });
                } catch {
                  // 降级：如果通知 store 不可用，使用浏览器原生提示
                  if (window.confirm('应用有新版本可用，是否立即刷新以获取最新内容？')) {
                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                    window.location.reload();
                  }
                }
              }
            });
          });
        })
        .catch((registrationError: unknown) => {
          log.info('SW registration failed: ', registrationError);
        });
    });
  }
})();
