import { ref, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../../stores/settings.store';
import { availableLocales } from '../../i18n';
import apiClient from '../../utils/apiClient';

export function useSystemSettings() {
  const settingsStore = useSettingsStore();
  const { t } = useI18n();
  const {
    settings,
    language: storeLanguage,
    statusMonitorIntervalSecondsNumber,
    dockerDefaultExpandBoolean, // Assuming this comes from settings store
  } = storeToRefs(settingsStore);

  // --- Language ---
  const selectedLanguage = ref<string>(storeLanguage.value);
  const languageLoading = ref(false);
  const languageMessage = ref('');
  const languageSuccess = ref(false);
  const languageNames: Record<string, string> = {
    'en-US': 'English',
    'zh-CN': '中文',
    'ja-JP': '日本語',
  };

  const handleUpdateLanguage = async () => {
    languageLoading.value = true;
    languageMessage.value = '';
    languageSuccess.value = false;
    try {
      await settingsStore.updateSetting('language', selectedLanguage.value);
      languageMessage.value = t('settings.language.success.saved');
      languageSuccess.value = true;
      // The language change will be reflected globally by the i18n instance
      // when settingsStore.language updates.
    } catch (error: any) {
      console.error('更新语言设置失败:', error);
      languageMessage.value = error.message || t('settings.language.error.saveFailed');
      languageSuccess.value = false;
    } finally {
      languageLoading.value = false;
    }
  };

  // --- Timezone ---
  const selectedTimezone = ref('UTC');
  const timezoneLoading = ref(false);
  const timezoneMessage = ref('');
  const timezoneSuccess = ref(false);
  const commonTimezones = ref([
    'UTC',
    'Etc/GMT+12',
    'Pacific/Midway',
    'Pacific/Honolulu',
    'America/Anchorage',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Caracas',
    'America/Halifax',
    'America/Sao_Paulo',
    'Atlantic/Azores',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Karachi',
    'Asia/Dhaka',
    'Asia/Bangkok',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
    'Etc/GMT-14',
  ]);

  const handleUpdateTimezone = async () => {
    timezoneLoading.value = true;
    timezoneMessage.value = '';
    timezoneSuccess.value = false;
    try {
      await settingsStore.updateSetting('timezone', selectedTimezone.value);
      timezoneMessage.value = t('settings.timezone.success.saved');
      timezoneSuccess.value = true;
    } catch (error: any) {
      console.error('更新时区设置失败:', error);
      timezoneMessage.value = error.message || t('settings.timezone.error.saveFailed');
      timezoneSuccess.value = false;
    } finally {
      timezoneLoading.value = false;
    }
  };

  // --- Status Monitor ---
  const statusMonitorIntervalLocal = ref(3);
  const statusMonitorLoading = ref(false);
  const statusMonitorMessage = ref('');
  const statusMonitorSuccess = ref(false);

  const handleUpdateStatusMonitorInterval = async () => {
    statusMonitorLoading.value = true;
    statusMonitorMessage.value = '';
    statusMonitorSuccess.value = false;
    try {
      const intervalValue = statusMonitorIntervalLocal.value;
      if (isNaN(intervalValue) || intervalValue < 1 || !Number.isInteger(intervalValue)) {
        throw new Error(t('settings.statusMonitor.error.invalidInterval'));
      }
      await settingsStore.updateSetting('statusMonitorIntervalSeconds', String(intervalValue));
      statusMonitorMessage.value = t('settings.statusMonitor.success.saved');
      statusMonitorSuccess.value = true;
    } catch (error: any) {
      console.error('更新状态监控间隔失败:', error);
      statusMonitorMessage.value = error.message || t('settings.statusMonitor.error.saveFailed');
      statusMonitorSuccess.value = false;
    } finally {
      statusMonitorLoading.value = false;
    }
  };

  // --- Docker Settings ---
  const dockerInterval = ref(2);
  const dockerExpandDefault = ref(false);
  const dockerSettingsLoading = ref(false);
  const dockerSettingsMessage = ref('');
  const dockerSettingsSuccess = ref(false);

  const handleUpdateDockerSettings = async () => {
    dockerSettingsLoading.value = true;
    dockerSettingsMessage.value = '';
    dockerSettingsSuccess.value = false;
    try {
      const intervalValue = dockerInterval.value;
      if (isNaN(intervalValue) || intervalValue < 1) {
        throw new Error(t('settings.docker.error.invalidInterval'));
      }
      await settingsStore.updateMultipleSettings({
        dockerStatusIntervalSeconds: String(intervalValue),
        dockerDefaultExpand: dockerExpandDefault.value ? 'true' : 'false',
      });
      dockerSettingsMessage.value = t('settings.docker.success.saved');
      dockerSettingsSuccess.value = true;
    } catch (error: any) {
      console.error('更新 Docker 设置失败:', error);
      dockerSettingsMessage.value = error.message || t('settings.docker.error.saveFailed');
      dockerSettingsSuccess.value = false;
    } finally {
      dockerSettingsLoading.value = false;
    }
  };

  // Watch for changes in settings from the store and update local refs
  watch(
    settings,
    (newSettings) => {
      if (newSettings) {
        selectedLanguage.value = newSettings.language || 'en-US'; // Default to en-US
        selectedTimezone.value = newSettings.timezone || 'UTC';
        statusMonitorIntervalLocal.value = parseInt(
          newSettings.statusMonitorIntervalSeconds || '3',
          10
        );
        dockerInterval.value = parseInt(newSettings.dockerStatusIntervalSeconds || '2', 10);
        // dockerExpandDefault.value is already reactive from storeToRefs (dockerDefaultExpandBoolean)
        // but we keep a local ref for the form v-model and sync it.
        dockerExpandDefault.value = newSettings.dockerDefaultExpand === 'true';
      }
    },
    { deep: true, immediate: true }
  );

  // Sync local dockerExpandDefault with the store's boolean getter
  watch(
    dockerDefaultExpandBoolean,
    (newValue) => {
      dockerExpandDefault.value = newValue;
    },
    { immediate: true }
  );

  // Sync local statusMonitorIntervalLocal with the store's number getter
  watch(
    statusMonitorIntervalSecondsNumber,
    (newValue) => {
      statusMonitorIntervalLocal.value = newValue;
    },
    { immediate: true }
  );

  // Sync local selectedLanguage with the store's language getter
  watch(
    storeLanguage,
    (newVal) => {
      selectedLanguage.value = newVal;
    },
    { immediate: true }
  );

  // --- Log Level ---
  type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
  const logLevelOptions: { value: LogLevel; label: string }[] = [
    { value: 'debug', label: 'Debug' },
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Warn' },
    { value: 'error', label: 'Error' },
    { value: 'silent', label: 'Silent' },
  ];
  const selectedLogLevel = ref<LogLevel>('info');
  const logLevelLoading = ref(false);
  const logLevelMessage = ref('');
  const logLevelSuccess = ref(false);

  const fetchLogLevel = async () => {
    try {
      const response = await apiClient.get('/settings/log-level');
      selectedLogLevel.value = response.data.level || 'info';
    } catch (error) {
      console.error('获取日志等级失败:', error);
    }
  };

  const handleUpdateLogLevel = async () => {
    logLevelLoading.value = true;
    logLevelMessage.value = '';
    logLevelSuccess.value = false;
    try {
      await apiClient.put('/settings/log-level', { level: selectedLogLevel.value });
      logLevelMessage.value = t('settings.logLevel.success.saved', '日志等级已保存');
      logLevelSuccess.value = true;
    } catch (error: any) {
      console.error('更新日志等级失败:', error);
      logLevelMessage.value =
        error.response?.data?.message ||
        t('settings.logLevel.error.saveFailed', '保存日志等级失败');
      logLevelSuccess.value = false;
    } finally {
      logLevelLoading.value = false;
    }
  };

  // Fetch log level on mount
  onMounted(() => {
    fetchLogLevel();
  });

  return {
    // Language
    selectedLanguage,
    languageLoading,
    languageMessage,
    languageSuccess,
    languageNames,
    availableLocales, // Export for template
    handleUpdateLanguage,

    // Timezone
    selectedTimezone,
    timezoneLoading,
    timezoneMessage,
    timezoneSuccess,
    commonTimezones,
    handleUpdateTimezone,

    // Status Monitor
    statusMonitorIntervalLocal,
    statusMonitorLoading,
    statusMonitorMessage,
    statusMonitorSuccess,
    handleUpdateStatusMonitorInterval,

    // Docker Settings
    dockerInterval,
    dockerExpandDefault,
    dockerSettingsLoading,
    dockerSettingsMessage,
    dockerSettingsSuccess,
    handleUpdateDockerSettings,

    // Log Level
    logLevelOptions,
    selectedLogLevel,
    logLevelLoading,
    logLevelMessage,
    logLevelSuccess,
    handleUpdateLogLevel,
  };
}
