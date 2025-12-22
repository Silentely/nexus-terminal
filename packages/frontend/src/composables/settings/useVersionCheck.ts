import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { useI18n } from 'vue-i18n';

export function useVersionCheck() {
  const { t } = useI18n();
  const appVersion = ref<string>('');
  const latestVersion = ref<string | null>(null);
  const isCheckingVersion = ref(false);
  const versionCheckError = ref<string | null>(null);

  const isUpdateAvailable = computed(() => {
    if (!latestVersion.value) return false;

    // 清除 'v' 前缀后进行比较
    const cleanLatestVersion = latestVersion.value.startsWith('v')
      ? latestVersion.value.substring(1)
      : latestVersion.value;
    const cleanAppVersion = appVersion.value.startsWith('v')
      ? appVersion.value.substring(1)
      : appVersion.value;

    return cleanLatestVersion !== cleanAppVersion;
  });

  const loadAppVersion = async () => {
    try {
      const response = await axios.get('/VERSION');
      appVersion.value = response.data.trim();
    } catch (error) {
      console.error('加载应用版本失败:', error);
      appVersion.value = '未知版本';
    }
  };

  const checkLatestVersion = async () => {
    isCheckingVersion.value = true;
    versionCheckError.value = null;
    latestVersion.value = null;
    try {
      const response = await axios.get('https://raw.githubusercontent.com/Silentely/nexus-terminal/main/VERSION');
      if (response.data && response.data.trim()) {
        latestVersion.value = response.data.trim();
      } else {
        throw new Error('Empty VERSION');
      }
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          console.warn('暂无可用的发布版本');
          versionCheckError.value = t('settings.about.error.noReleases');
        } else {
          console.error('检查最新版本失败:', error);
          versionCheckError.value = t('settings.about.error.checkFailed');
        }
      } else {
        console.error('检查最新版本失败:', error);
        versionCheckError.value = t('settings.about.error.checkFailed');
      }
    } finally {
      isCheckingVersion.value = false;
    }
  };

  onMounted(async () => {
    await loadAppVersion();
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