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
    // 简单的字符串比较，假设 tag 格式为 vX.Y.Z
    return latestVersion.value && latestVersion.value !== `v${appVersion.value}`;
  });

  const loadAppVersion = async () => {
    try {
      const response = await axios.get('/VERSION');
      let version = response.data.trim();

      // 如果版本号为空或为 "latest"，则显示 "dev"
      if (!version || version === 'latest' || version === 'dev') {
        appVersion.value = 'dev';
      } else {
        appVersion.value = version;
      }
    } catch (error) {
      console.error('加载应用版本失败:', error);
      appVersion.value = 'dev';
    }
  };

  const checkLatestVersion = async () => {
    isCheckingVersion.value = true;
    versionCheckError.value = null;
    latestVersion.value = null;
    try {
      const response = await axios.get('https://api.github.com/repos/Silentely/nexus-terminal/releases/latest');
      if (response.data && response.data.tag_name) {
        latestVersion.value = response.data.tag_name;
      } else {
        throw new Error('Invalid API response format');
      }
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          // 404 是正常情况（仓库还没有 release），使用 warn 级别
          console.warn('暂无可用的发布版本');
          versionCheckError.value = t('settings.about.error.noReleases');
        } else if (error.response?.status === 403) {
          console.error('GitHub API 访问频率受限:', error);
          versionCheckError.value = t('settings.about.error.rateLimit');
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