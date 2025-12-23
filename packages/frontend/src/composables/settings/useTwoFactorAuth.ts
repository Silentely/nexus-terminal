import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../../stores/auth.store';
import apiClient from '../../utils/apiClient';

export function useTwoFactorAuth() {
  const authStore = useAuthStore();
  const { t } = useI18n();

  const twoFactorEnabled = ref(false);
  const twoFactorLoading = ref(false);
  const twoFactorMessage = ref('');
  const twoFactorSuccess = ref(false);
  const setupData = ref<{ secret: string; qrCodeUrl: string } | null>(null);
  const verificationCode = ref('');
  const disablePassword = ref('');

  const isSettingUp2FA = computed(() => setupData.value !== null);

  const checkTwoFactorStatus = async () => {
    // Ensure user is loaded before checking 2FA status
    if (!authStore.user) {
      await authStore.checkAuthStatus(); // Attempt to load user if not already
    }
    twoFactorEnabled.value = authStore.user?.isTwoFactorEnabled ?? false;
  };

  const handleSetup2FA = async () => {
    twoFactorMessage.value = '';
    twoFactorSuccess.value = false;
    twoFactorLoading.value = true;
    setupData.value = null;
    verificationCode.value = '';
    try {
      const response = await apiClient.post<{ secret: string; qrCodeUrl: string }>(
        '/auth/2fa/setup'
      );
      setupData.value = response.data;
    } catch (error: any) {
      console.error('开始设置 2FA 失败:', error);
      twoFactorMessage.value =
        error.response?.data?.message || t('settings.twoFactor.error.setupFailed');
    } finally {
      twoFactorLoading.value = false;
    }
  };

  const handleVerifyAndActivate2FA = async () => {
    if (!setupData.value || !verificationCode.value) {
      twoFactorMessage.value = t('settings.twoFactor.error.codeRequired');
      return;
    }
    twoFactorMessage.value = '';
    twoFactorSuccess.value = false;
    twoFactorLoading.value = true;
    try {
      await apiClient.post('/auth/2fa/verify', { token: verificationCode.value });
      twoFactorMessage.value = t('settings.twoFactor.success.activated');
      twoFactorSuccess.value = true;
      twoFactorEnabled.value = true;
      setupData.value = null;
      verificationCode.value = '';
      await authStore.checkAuthStatus(); // Refresh user data
    } catch (error: any) {
      console.error('验证并激活 2FA 失败:', error);
      twoFactorMessage.value =
        error.response?.data?.message || t('settings.twoFactor.error.verificationFailed');
    } finally {
      twoFactorLoading.value = false;
    }
  };

  const handleDisable2FA = async () => {
    if (!disablePassword.value) {
      twoFactorMessage.value = t('settings.twoFactor.error.passwordRequiredForDisable');
      return;
    }
    twoFactorMessage.value = '';
    twoFactorSuccess.value = false;
    twoFactorLoading.value = true;
    try {
      await apiClient.delete('/auth/2fa', { data: { password: disablePassword.value } });
      twoFactorMessage.value = t('settings.twoFactor.success.disabled');
      twoFactorSuccess.value = true;
      twoFactorEnabled.value = false;
      disablePassword.value = '';
      await authStore.checkAuthStatus(); // Refresh user data
    } catch (error: any) {
      console.error('禁用 2FA 失败:', error);
      twoFactorMessage.value =
        error.response?.data?.message || t('settings.twoFactor.error.disableFailed');
    } finally {
      twoFactorLoading.value = false;
    }
  };

  const cancelSetup = () => {
    setupData.value = null;
    verificationCode.value = '';
    twoFactorMessage.value = '';
  };

  onMounted(async () => {
    await checkTwoFactorStatus();
  });

  return {
    twoFactorEnabled,
    twoFactorLoading,
    twoFactorMessage,
    twoFactorSuccess,
    setupData,
    verificationCode,
    disablePassword,
    isSettingUp2FA,
    checkTwoFactorStatus, // Expose if needed externally, though onMounted handles initial check
    handleSetup2FA,
    handleVerifyAndActivate2FA,
    handleDisable2FA,
    cancelSetup,
  };
}
