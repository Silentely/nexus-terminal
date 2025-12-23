import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../../stores/auth.store';

export function useChangePassword() {
  const authStore = useAuthStore();
  const { t } = useI18n();

  const currentPassword = ref('');
  const newPassword = ref('');
  const confirmPassword = ref('');
  const changePasswordLoading = ref(false);
  const changePasswordMessage = ref('');
  const changePasswordSuccess = ref(false);

  const handleChangePassword = async () => {
    changePasswordMessage.value = '';
    changePasswordSuccess.value = false;

    if (newPassword.value !== confirmPassword.value) {
      changePasswordMessage.value = t('settings.changePassword.error.passwordsDoNotMatch');
      return;
    }

    if (!currentPassword.value || !newPassword.value) {
      changePasswordMessage.value = t('settings.changePassword.error.fieldsRequired'); // 您可能需要添加此翻译
      return;
    }

    changePasswordLoading.value = true;
    try {
      await authStore.changePassword(currentPassword.value, newPassword.value);
      changePasswordMessage.value = t('settings.changePassword.success');
      changePasswordSuccess.value = true;
      currentPassword.value = '';
      newPassword.value = '';
      confirmPassword.value = '';
    } catch (error: any) {
      console.error('修改密码失败:', error);
      changePasswordMessage.value = error.message || t('settings.changePassword.error.generic');
      changePasswordSuccess.value = false;
    } finally {
      changePasswordLoading.value = false;
    }
  };

  return {
    currentPassword,
    newPassword,
    confirmPassword,
    changePasswordLoading,
    changePasswordMessage,
    changePasswordSuccess,
    handleChangePassword,
  };
}
