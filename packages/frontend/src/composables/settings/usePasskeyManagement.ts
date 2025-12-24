import { ref, reactive, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { startRegistration } from '@simplewebauthn/browser';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../../stores/auth.store';

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
    } catch (error: any) {
      console.error('Passkey 注册失败:', error);
      if (
        error.name === 'InvalidStateError' ||
        error.message.includes('cancelled') ||
        error.message.includes('excludeCredentials')
      ) {
        passkeyMessage.value = t('settings.passkey.error.registrationCancelledOrExists'); // 您可能需要添加或修改此翻译
      } else {
        passkeyMessage.value =
          error.response?.data?.message ||
          error.message ||
          t('settings.passkey.error.registrationFailed');
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
    } catch (error: any) {
      console.error(`更新 Passkey ${credentialID} 名称失败:`, error);
      passkeyMessage.value =
        error.response?.data?.message ||
        error.message ||
        t('settings.passkey.error.nameUpdateFailed', '更新 Passkey 名称失败。');
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
      console.error(
        'Attempted to delete a passkey with an invalid or undefined credentialID:',
        credentialID
      );
      passkeyDeleteError.value = t(
        'settings.passkey.error.deleteFailedInvalidId',
        '删除失败：无效的凭证 ID。'
      );
      return;
    }
    // It's better to handle confirmation in the component itself if needed, or pass a confirm function
    // For now, assuming confirmation is handled or not strictly needed in the composable.
    // if (!confirm(t('settings.passkey.confirmDelete'))) return;

    passkeyDeleteLoadingStates[credentialID] = true;
    passkeyDeleteError.value = null;
    passkeyMessage.value = '';
    try {
      await authStore.deletePasskey(credentialID);
      passkeyMessage.value = t('settings.passkey.success.deleted');
      passkeySuccess.value = true;
      // authStore.fetchPasskeys() is usually called within deletePasskey in the store
    } catch (error: any) {
      console.error(`删除 Passkey ${credentialID} 失败:`, error);
      passkeyDeleteError.value =
        error.response?.data?.message ||
        error.message ||
        t('settings.passkey.error.deleteFailedGeneral');
      passkeySuccess.value = false;
    } finally {
      passkeyDeleteLoadingStates[credentialID] = false;
    }
  };

  const formatDate = (dateInput: string | number | Date | undefined): string => {
    if (!dateInput) return t('statusMonitor.notAvailable', 'N/A');
    try {
      const date = new Date(typeof dateInput === 'number' ? dateInput * 1000 : dateInput);
      return !Number.isNaN(date.getTime())
        ? date.toLocaleString()
        : t('statusMonitor.notAvailable', 'N/A');
    } catch (e) {
      console.error('Error formatting date:', e);
      return t('statusMonitor.notAvailable', 'N/A');
    }
  };

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
