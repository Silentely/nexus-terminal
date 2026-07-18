/**
 * 应用版本检查 composable
 *
 * - 模块级共享状态：Settings 页签角标与关于页共用同一结果，避免重复请求
 * - 请求去重：并发 check 合并为同一 Promise
 * - 语义化版本比较：仅当远程版本数值上更高时提示更新
 * - 统一走后端 /api/v1/version/check（VERSION 优先，Releases 兜底）
 */
import { ref, computed } from 'vue';
import axios from 'axios';
import { useI18n } from 'vue-i18n';
import { log } from '@/utils/log';
import { GITHUB_REPO_URL } from '@/utils/constants';
import {
  isComparableVersion,
  isNewerVersion,
  normalizeVersion,
  buildReleaseTagUrl,
} from '@/utils/version';

/** 模块级共享状态（单例） */
const appVersion = ref<string>('');
const latestVersion = ref<string | null>(null);
const releaseHtmlUrl = ref<string | null>(null);
const isCheckingVersion = ref(false);
const versionCheckError = ref<string | null>(null);

let loadAppVersionPromise: Promise<void> | null = null;
let checkLatestPromise: Promise<void> | null = null;
/** 本地 VERSION 是否已加载成功 */
let hasLoadedAppVersion = false;
/** 是否已成功拿到过远程版本（失败仍允许重试） */
let hasSuccessfulCheck = false;

interface VersionCheckResponse {
  version?: string | null;
  rawVersion?: string | null;
  htmlUrl?: string | null;
  source?: string | null;
  error?: string;
}

export function useVersionCheck() {
  const { t } = useI18n();

  const isUpdateAvailable = computed(() => {
    if (!latestVersion.value || !appVersion.value) return false;
    return isNewerVersion(latestVersion.value, appVersion.value);
  });

  /** 发布页链接：后端提供优先，否则按版本拼装 */
  const releaseUrl = computed(() => {
    if (releaseHtmlUrl.value) return releaseHtmlUrl.value;
    if (latestVersion.value && isComparableVersion(latestVersion.value)) {
      return buildReleaseTagUrl(GITHUB_REPO_URL, latestVersion.value);
    }
    return `${GITHUB_REPO_URL}/releases`;
  });

  const loadAppVersion = async (force = false) => {
    if (!force && hasLoadedAppVersion && appVersion.value) return;
    if (loadAppVersionPromise) return loadAppVersionPromise;

    loadAppVersionPromise = (async () => {
      try {
        const response = await axios.get<string>('/VERSION', {
          // 避免 SW / 浏览器缓存导致本地版本滞后
          headers: { 'Cache-Control': 'no-cache' },
          params: { _t: Date.now() },
        });
        const text =
          typeof response.data === 'string'
            ? response.data.trim()
            : String(response.data ?? '').trim();
        appVersion.value = text || t('settings.about.unknownVersion', '未知版本');
        hasLoadedAppVersion = true;
      } catch (error: unknown) {
        log.error('加载应用版本失败:', error);
        appVersion.value = t('settings.about.unknownVersion', '未知版本');
        hasLoadedAppVersion = false;
      } finally {
        loadAppVersionPromise = null;
      }
    })();

    return loadAppVersionPromise;
  };

  /**
   * 检查远程最新版本
   * @param force 为 true 时忽略「已成功检查」短路，强制重新请求
   */
  const checkLatestVersion = async (force = false) => {
    if (!force && hasSuccessfulCheck && latestVersion.value) {
      // 已有结果时仅确保本地版本已加载
      if (!appVersion.value) await loadAppVersion();
      return;
    }

    if (checkLatestPromise) return checkLatestPromise;

    checkLatestPromise = (async () => {
      isCheckingVersion.value = true;
      versionCheckError.value = null;

      try {
        await loadAppVersion(force);

        const response = await axios.get<VersionCheckResponse>('/api/v1/version/check');
        const data = response.data;
        const remote =
          (data.version && data.version.trim()) ||
          (data.rawVersion && data.rawVersion.trim()) ||
          null;

        if (!remote) {
          throw new Error(data.error || 'empty_version');
        }

        // 展示用保留可读形式（优先规范化后的版本）
        latestVersion.value = isComparableVersion(remote)
          ? normalizeVersion(remote)
          : remote.trim();
        releaseHtmlUrl.value = data.htmlUrl ?? null;
        hasSuccessfulCheck = true;
      } catch (error: unknown) {
        hasSuccessfulCheck = false;
        latestVersion.value = null;
        releaseHtmlUrl.value = null;

        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 404) {
            log.warn('暂无可用的发布版本');
            versionCheckError.value = t('settings.about.error.noReleases', '没有找到发布版本。');
          } else if (status === 403) {
            log.error('版本检查 API 访问受限:', error);
            versionCheckError.value = t(
              'settings.about.error.rateLimit',
              'API 访问频率受限，请稍后再试。',
            );
          } else {
            log.error('检查最新版本失败:', error);
            versionCheckError.value = t(
              'settings.about.error.checkFailed',
              '检查更新失败，请检查网络连接或稍后再试。',
            );
          }
        } else {
          log.error('检查最新版本失败:', error);
          versionCheckError.value = t(
            'settings.about.error.checkFailed',
            '检查更新失败，请检查网络连接或稍后再试。',
          );
        }
      } finally {
        isCheckingVersion.value = false;
        checkLatestPromise = null;
      }
    })();

    return checkLatestPromise;
  };

  return {
    appVersion,
    latestVersion,
    releaseUrl,
    isCheckingVersion,
    versionCheckError,
    isUpdateAvailable,
    loadAppVersion,
    checkLatestVersion,
  };
}

/** 测试用：重置模块级状态 */
export function __resetVersionCheckStateForTests() {
  appVersion.value = '';
  latestVersion.value = null;
  releaseHtmlUrl.value = null;
  isCheckingVersion.value = false;
  versionCheckError.value = null;
  loadAppVersionPromise = null;
  checkLatestPromise = null;
  hasLoadedAppVersion = false;
  hasSuccessfulCheck = false;
}
