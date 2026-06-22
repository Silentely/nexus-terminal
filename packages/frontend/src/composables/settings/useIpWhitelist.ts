import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../../stores/settings.store';
import { log } from '@/utils/log';

export function useIpWhitelist() {
  const settingsStore = useSettingsStore();
  const { t } = useI18n();
  const { settings } = storeToRefs(settingsStore);

  const ipWhitelistInput = ref('');
  const ipWhitelistLoading = ref(false);
  const ipWhitelistMessage = ref('');
  const ipWhitelistSuccess = ref(false);

  watch(
    () => settings.value.ipWhitelist,
    (newVal) => {
      ipWhitelistInput.value = newVal || '';
    },
    { immediate: true },
  );

  const handleUpdateIpWhitelist = async () => {
    ipWhitelistLoading.value = true;
    ipWhitelistMessage.value = '';
    ipWhitelistSuccess.value = false;
    try {
      await settingsStore.updateSetting('ipWhitelist', ipWhitelistInput.value.trim());
      ipWhitelistMessage.value = t('settings.ipWhitelist.success.saved');
      ipWhitelistSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新 IP 白名单失败:', error);
      const errorMessage = error instanceof Error ? error.message : '';
      ipWhitelistMessage.value = errorMessage || t('settings.ipWhitelist.error.saveFailed');
      ipWhitelistSuccess.value = false;
    } finally {
      ipWhitelistLoading.value = false;
    }
  };

  return {
    ipWhitelistInput,
    ipWhitelistLoading,
    ipWhitelistMessage,
    ipWhitelistSuccess,
    handleUpdateIpWhitelist,
  };
}
