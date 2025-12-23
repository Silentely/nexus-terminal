import { useI18n } from 'vue-i18n';
import { useDialogStore } from '../stores/dialog.store';

interface ConfirmDialogOptions {
  title?: string; // 将 title 设为可选
  message: string;
  confirmText?: string;
  cancelText?: string;
}

export function useConfirmDialog() {
  const dialogStore = useDialogStore();
  const { t } = useI18n(); // For potential default texts if needed

  const showConfirmDialog = (options: ConfirmDialogOptions): Promise<boolean> => {
    // Provide default title if not specified, though usually it's better to be explicit
    const finalOptions = {
      title: options.title || t('common.confirmationTitle', '请确认'),
      message: options.message,
      confirmText: options.confirmText,
      cancelText: options.cancelText,
    };
    return dialogStore.showDialog(finalOptions);
  };

  // Optional: A simpler version if you often use a generic title
  const confirmAction = (message: string, title?: string): Promise<boolean> => {
    return showConfirmDialog({
      title: title || t('common.confirmationTitle', '请确认'),
      message,
    });
  };

  // Expose setLoading if needed directly from composable
  const setLoading = (isLoading: boolean) => {
    dialogStore.setLoading(isLoading);
  };

  return {
    showConfirmDialog,
    confirmAction, // Export the simpler version as well
    setDialogLoading: setLoading, // Expose setLoading with a more specific name
  };
}
