import { ref, reactive, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../../stores/settings.store';
import { useAuthStore } from '../../stores/auth.store';
import { useConfirmDialog } from '../useConfirmDialog';

export function useIpBlacklist() {
  const settingsStore = useSettingsStore();
  const authStore = useAuthStore();
  const { t } = useI18n();
  const { showConfirmDialog } = useConfirmDialog();
  const { settings, ipBlacklistEnabledBoolean } = storeToRefs(settingsStore);

  // --- IP Blacklist Enabled State & Method ---
  const ipBlacklistEnabled = ref(true); // Local state for the switch

  watch(
    ipBlacklistEnabledBoolean,
    (newVal) => {
      ipBlacklistEnabled.value = newVal;
    },
    { immediate: true }
  );

  const handleUpdateIpBlacklistEnabled = async () => {
    const originalValue = ipBlacklistEnabled.value;
    // Toggle local state immediately for UI feedback if it's directly bound to the switch
    // If the switch v-model is ipBlacklistEnabled, this line is not strictly needed before API call,
    // but helps if we want to manage the state change explicitly.
    // ipBlacklistEnabled.value = !ipBlacklistEnabled.value; // This line might be redundant if v-model handles it

    try {
      // The value to save is the new state of the switch
      const valueToSave = ipBlacklistEnabled.value; // This should reflect the intended new state
      await settingsStore.updateSetting('ipBlacklistEnabled', valueToSave ? 'true' : 'false');
      // Success: ipBlacklistEnabledBoolean will update via store watcher, syncing ipBlacklistEnabled.value
    } catch (error: any) {
      console.error('更新 IP 黑名单启用状态失败:', error);
      ipBlacklistEnabled.value = originalValue; // Revert on failure
      // Optionally, show an error message to the user
    }
  };

  // --- IP Blacklist Configuration Form State & Method ---
  const blacklistSettingsForm = reactive({
    maxLoginAttempts: '5',
    loginBanDuration: '300',
  });
  const blacklistSettingsLoading = ref(false);
  const blacklistSettingsMessage = ref('');
  const blacklistSettingsSuccess = ref(false);

  watch(
    settings,
    (newSettings) => {
      blacklistSettingsForm.maxLoginAttempts = newSettings.maxLoginAttempts || '5';
      blacklistSettingsForm.loginBanDuration = newSettings.loginBanDuration || '300';
    },
    { deep: true, immediate: true }
  );

  const handleUpdateBlacklistSettings = async () => {
    blacklistSettingsLoading.value = true;
    blacklistSettingsMessage.value = '';
    blacklistSettingsSuccess.value = false;
    try {
      const maxAttempts = parseInt(blacklistSettingsForm.maxLoginAttempts, 10);
      const banDuration = parseInt(blacklistSettingsForm.loginBanDuration, 10);
      if (Number.isNaN(maxAttempts) || maxAttempts <= 0) {
        throw new Error(t('settings.ipBlacklist.error.invalidMaxAttempts'));
      }
      if (Number.isNaN(banDuration) || banDuration <= 0) {
        throw new Error(t('settings.ipBlacklist.error.invalidBanDuration'));
      }
      await settingsStore.updateMultipleSettings({
        maxLoginAttempts: blacklistSettingsForm.maxLoginAttempts,
        loginBanDuration: blacklistSettingsForm.loginBanDuration,
      });
      blacklistSettingsMessage.value = t('settings.ipBlacklist.success.configUpdated');
      blacklistSettingsSuccess.value = true;
    } catch (error: any) {
      console.error('更新黑名单配置失败:', error);
      blacklistSettingsMessage.value =
        error.message || t('settings.ipBlacklist.error.updateConfigFailed');
      blacklistSettingsSuccess.value = false;
    } finally {
      blacklistSettingsLoading.value = false;
    }
  };

  // --- IP Blacklist Table State & Methods ---
  const ipBlacklist = reactive({
    entries: [] as any[],
    total: 0,
    loading: false,
    error: null as string | null,
    currentPage: 1,
    limit: 10,
  });
  const blacklistToDeleteIp = ref<string | null>(null);
  const blacklistDeleteLoading = ref(false);
  const blacklistDeleteError = ref<string | null>(null);

  const fetchIpBlacklist = async (page = 1) => {
    ipBlacklist.loading = true;
    ipBlacklist.error = null;
    const offset = (page - 1) * ipBlacklist.limit;
    try {
      const data = await authStore.fetchIpBlacklist(ipBlacklist.limit, offset);
      ipBlacklist.entries = data.entries;
      ipBlacklist.total = data.total;
      ipBlacklist.currentPage = page;
    } catch (error: any) {
      ipBlacklist.error = error.message || t('settings.ipBlacklist.error.fetchFailed');
    } finally {
      ipBlacklist.loading = false;
    }
  };

  const handleDeleteIp = async (ip: string) => {
    blacklistToDeleteIp.value = ip;
    const confirmed = await showConfirmDialog({
      title: '',
      message: t('settings.ipBlacklist.confirmRemoveIp', { ip }),
    });
    if (confirmed) {
      blacklistDeleteLoading.value = true;
      blacklistDeleteError.value = null;
      try {
        await authStore.deleteIpFromBlacklist(ip);
        await fetchIpBlacklist(ipBlacklist.currentPage); // Refresh list
      } catch (error: any) {
        blacklistDeleteError.value = error.message || t('settings.ipBlacklist.error.deleteFailed');
      } finally {
        blacklistDeleteLoading.value = false;
        blacklistToDeleteIp.value = null;
      }
    } else {
      blacklistToDeleteIp.value = null;
    }
  };

  onMounted(() => {
    if (ipBlacklistEnabled.value) {
      // Only fetch if enabled, or always fetch and let template hide
      fetchIpBlacklist();
    }
  });

  watch(ipBlacklistEnabled, (newValue) => {
    if (newValue && ipBlacklist.entries.length === 0 && !ipBlacklist.loading) {
      fetchIpBlacklist();
    }
  });

  return {
    ipBlacklistEnabled,
    handleUpdateIpBlacklistEnabled,
    blacklistSettingsForm,
    blacklistSettingsLoading,
    blacklistSettingsMessage,
    blacklistSettingsSuccess,
    handleUpdateBlacklistSettings,
    ipBlacklist,
    blacklistToDeleteIp,
    blacklistDeleteLoading,
    blacklistDeleteError,
    fetchIpBlacklist, // Expose if pagination is handled in the template
    handleDeleteIp,
  };
}
