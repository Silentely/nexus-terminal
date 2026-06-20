import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { useI18n } from 'vue-i18n';
import { log } from '@/utils/log';

export function useAboutSection() {
  const { t } = useI18n();
  const appVersion = ref<string>('');

  // --- Version Check State ---
  const latestVersion = ref<string | null>(null);
  const isCheckingVersion = ref(false);
  const versionCheckError = ref<string | null>(null);

  const isUpdateAvailable = computed(() => {
    if (!latestVersion.value) return false;

    const cleanLatestVersion = latestVersion.value.startsWith('v')
      ? latestVersion.value.substring(1)
      : latestVersion.value;
    const cleanAppVersion = appVersion.value.startsWith('v')
      ? appVersion.value.substring(1)
      : appVersion.value;

    return cleanLatestVersion !== cleanAppVersion && cleanLatestVersion > cleanAppVersion;
  });

  const loadAppVersion = async () => {
    try {
      const response = await axios.get('/VERSION');
      appVersion.value = response.data.trim();
    } catch (error: unknown) {
      log.error('加载应用版本失败:', error);
      appVersion.value = '未知版本';
    }
  };

  const checkLatestVersion = async () => {
    isCheckingVersion.value = true;
    versionCheckError.value = null;
    latestVersion.value = null;
    try {
      const response = await axios.get('/api/v1/version/latest');
      if (response.data?.tag) {
        latestVersion.value = response.data.tag;
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          log.warn('暂无可用的发布版本');
          versionCheckError.value = t('settings.about.error.noReleases', '没有找到发布版本。');
        } else if (error.response?.status === 403) {
          log.error('GitHub API 访问频率受限:', error);
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
    }
  };

  onMounted(async () => {
    await loadAppVersion();
    checkLatestVersion();
  });

  return {
    appVersion,
    latestVersion,
    isCheckingVersion,
    versionCheckError,
    isUpdateAvailable,
    checkLatestVersion,
  };
}
