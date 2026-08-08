import { ref, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { startRegistration } from '@simplewebauthn/browser';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../../stores/auth.store';
import { extractErrorMessage } from '../../utils/errorExtractor';
import { log } from '@/utils/log';
import { formatDateTime } from '../../utils/dateFormat';

export function usePasskeyManagement() {
  const authStore = useAuthStore();
  const { t } = useI18n();
  const { user, passkeys, passkeysLoading } = storeToRefs(authStore);

  // --- Passkey State ---
  const passkeyRegistrationLoading = ref(false); // Renamed for clarity
  const passkeyMessage = ref('');
  const passkeySuccess = ref(false);
  const passkeyDeleteLoadingStates = reactive<Record<string, boolean>>({});
  const passkeyDeleteError = ref<string | null>(null);

  // State for editing passkey name
  const editingPasskeyId = ref<string | null>(null);
  const editingPasskeyName = ref('');
  const passkeyEditLoadingStates = reactive<Record<string, boolean>>({});

  const handleRegisterNewPasskey = async () => {
    passkeyRegistrationLoading.value = true;
    passkeyMessage.value = '';
    passkeySuccess.value = false;

    const username = user.value?.username;
    if (!username) {
      passkeyMessage.value = t('settings.passkey.error.userNotLoggedIn');
      passkeyRegistrationLoading.value = false;
      return;
    }

    try {
      const registrationOptions = await authStore.getPasskeyRegistrationOptions(username);
      const registrationResult = await startRegistration(registrationOptions);
      await authStore.registerPasskey(username, registrationResult);

      passkeyMessage.value = t('settings.passkey.success.registered');
      passkeySuccess.value = true;
      await authStore.fetchPasskeys();
    } catch (error: unknown) {
      log.error('Passkey 注册失败:', error);
      const maybeError = error as { name?: string; message?: string };
      if (
        maybeError.name === 'InvalidStateError' ||
        maybeError.message?.includes('cancelled') ||
        maybeError.message?.includes('excludeCredentials')
      ) {
        passkeyMessage.value = t('settings.passkey.error.registrationCancelledOrExists'); // 您可能需要添加或修改此翻译
      } else {
        passkeyMessage.value = extractErrorMessage(
          error,
          t('settings.passkey.error.registrationFailed'),
        );
      }
      passkeySuccess.value = false;
    } finally {
      passkeyRegistrationLoading.value = false;
    }
  };

  const startEditPasskeyName = (credentialID: string, currentName: string) => {
    editingPasskeyId.value = credentialID;
    editingPasskeyName.value = currentName || ''; // Ensure it's a string
    passkeyMessage.value = '';
    passkeySuccess.value = false;
  };

  const cancelEditPasskeyName = () => {
    editingPasskeyId.value = null;
    editingPasskeyName.value = '';
  };

  const savePasskeyName = async (credentialID: string) => {
    if (!editingPasskeyName.value.trim()) {
      passkeyMessage.value = t('settings.passkey.error.nameRequired', 'Passkey 名称不能为空。');
      passkeySuccess.value = false;
      return;
    }
    passkeyEditLoadingStates[credentialID] = true;
    passkeyMessage.value = '';
    passkeySuccess.value = false;
    try {
      await authStore.updatePasskeyName(credentialID, editingPasskeyName.value.trim());
      passkeyMessage.value = t('settings.passkey.success.nameUpdated');
      passkeySuccess.value = true;
      await authStore.fetchPasskeys();
      cancelEditPasskeyName();
    } catch (error: unknown) {
      log.error(`更新 Passkey ${credentialID} 名称失败:`, error);
      passkeyMessage.value = extractErrorMessage(
        error,
        t('settings.passkey.error.nameUpdateFailed', '更新 Passkey 名称失败。'),
      );
      passkeySuccess.value = false;
    } finally {
      passkeyEditLoadingStates[credentialID] = false;
    }
  };

  const handleDeletePasskey = async (credentialID: string) => {
    if (editingPasskeyId.value === credentialID) {
      cancelEditPasskeyName();
    }
    if (!credentialID || typeof credentialID !== 'string') {
      log.error(
        'Attempted to delete a passkey with an invalid or undefined credentialID:',
        credentialID,
      );
      passkeyDeleteError.value = t(
        'settings.passkey.error.deleteFailedInvalidId',
        '删除失败：无效的凭证 ID。',
      );
      return;
    }
    // 需要确认时更适合在组件内处理，或传入确认函数
    // 目前假定确认已在组件内处理或非必需。
    // if (!confirm(t('settings.passkey.confirmDelete'))) return;

    passkeyDeleteLoadingStates[credentialID] = true;
    passkeyDeleteError.value = null;
    passkeyMessage.value = '';
    try {
      await authStore.deletePasskey(credentialID);
      passkeyMessage.value = t('settings.passkey.success.deleted');
      passkeySuccess.value = true;
      passkeyDeleteError.value = null;
      // authStore.fetchPasskeys() is usually called within deletePasskey in the store
    } catch (error: unknown) {
      log.error(`删除 Passkey ${credentialID} 失败:`, error);
      passkeyDeleteError.value = extractErrorMessage(
        error,
        t('settings.passkey.error.deleteFailedGeneral'),
      );
      passkeySuccess.value = false;
    } finally {
      passkeyDeleteLoadingStates[credentialID] = false;
    }
  };

  // 格式化日期（统一走 utils/dateFormat 公共工具；数字视为秒级时间戳，空值显示 N/A）
  const formatDate = (dateInput: string | number | Date | undefined): string =>
    dateInput
      ? formatDateTime(dateInput, { fallback: t('statusMonitor.notAvailable', 'N/A') })
      : t('statusMonitor.notAvailable', 'N/A');

  // Fetch passkeys on composable initialization if user is authenticated
  if (authStore.isAuthenticated) {
    authStore.fetchPasskeys();
  }

  return {
    passkeys, // from store
    passkeysLoading, // from store
    passkeyRegistrationLoading,
    passkeyMessage,
    passkeySuccess,
    passkeyDeleteLoadingStates,
    passkeyDeleteError,
    editingPasskeyId,
    editingPasskeyName,
    passkeyEditLoadingStates,
    handleRegisterNewPasskey,
    startEditPasskeyName,
    cancelEditPasskeyName,
    savePasskeyName,
    handleDeletePasskey,
    formatDate,
  };
}
