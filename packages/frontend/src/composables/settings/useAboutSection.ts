import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import { useI18n } from 'vue-i18n';

export function useAboutSection() {
  const { t } = useI18n();
  const appVersion = ref<string>('');

  // --- Version Check State ---
  const latestVersion = ref<string | null>(null);
  const isCheckingVersion = ref(false);
  const versionCheckError = ref<string | null>(null);

  const isUpdateAvailable = computed(() => {
    // 简单的字符串比较，假设 tag 格式为 vX.Y.Z 或 X.Y.Z
    // 后端返回的 tag_name 可能包含 'v' 前缀，也可能不包含
    // appVersion.value 通常不包含 'v'
    if (!latestVersion.value) return false;

    const cleanLatestVersion = latestVersion.value.startsWith('v')
      ? latestVersion.value.substring(1)
      : latestVersion.value;
    const cleanAppVersion = appVersion.value.startsWith('v')
      ? appVersion.value.substring(1)
      : appVersion.value;

    // 进行版本比较，更健壮的比较可能需要拆分版本号进行数字比较
    // 此处简单比较字符串，对于 "1.0.10" > "1.0.9" 是有效的
    // 但对于 "1.0.9" > "1.0.10" 可能会出错，如果需要更精确，可以引入 semver 库或手动比较
    return cleanLatestVersion !== cleanAppVersion && cleanLatestVersion > cleanAppVersion;
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
    latestVersion.value = null; // Reset before check
    try {
      const response = await axios.get(
        'https://api.github.com/repos/Silentely/nexus-terminal/releases/latest',
        {
          // 移除 headers 以尝试解决潜在的CORS或请求问题，GitHub API 通常不需要特定 headers 进行公共读取
        }
      );
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
          versionCheckError.value = t('settings.about.error.noReleases', '没有找到发布版本。');
        } else if (error.response?.status === 403) {
          console.error('GitHub API 访问频率受限:', error);
          versionCheckError.value = t(
            'settings.about.error.rateLimit',
            'API 访问频率受限，请稍后再试。'
          );
        } else {
          console.error('检查最新版本失败:', error);
          versionCheckError.value = t(
            'settings.about.error.checkFailed',
            '检查更新失败，请检查网络连接或稍后再试。'
          );
        }
      } else {
        console.error('检查最新版本失败:', error);
        versionCheckError.value = t(
          'settings.about.error.checkFailed',
          '检查更新失败，请检查网络连接或稍后再试。'
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
    checkLatestVersion, // Expose if manual refresh is needed
  };
}
