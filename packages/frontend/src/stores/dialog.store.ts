import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

interface DialogState {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isLoading: boolean;
  resolvePromise?: (value: boolean) => void;
  rejectPromise?: (reason?: any) => void;
}

export const useDialogStore = defineStore('dialog', () => {
  const { t } = useI18n();

  const defaultState: DialogState = {
    visible: false,
    title: '',
    message: '',
    confirmText: t('common.confirm', '确认'),
    cancelText: t('common.cancel', '取消'),
    isLoading: false,
  };

  const state = ref<DialogState>({ ...defaultState });

  const showDialog = (options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
  }): Promise<boolean> => {
    state.value = {
      ...defaultState,
      ...options,
      visible: true,
      isLoading: false, // Reset loading state
    };
    return new Promise((resolve, reject) => {
      state.value.resolvePromise = resolve;
      state.value.rejectPromise = reject; // Though typically we resolve false for cancel
    });
  };

  const handleConfirm = async () => {
    if (state.value.resolvePromise) {
      state.value.resolvePromise(true);
    }
    state.value.visible = false;
    // No need to reset state here, showDialog will do it
  };

  const handleCancel = () => {
    if (state.value.resolvePromise) {
      // Resolve with false on cancel
      state.value.resolvePromise(false);
    }
    state.value.visible = false;
    // No need to reset state here, showDialog will do it
  };

  // For actions that might take time, to show a loading spinner on the confirm button
  const setLoading = (loading: boolean) => {
    state.value.isLoading = loading;
  };

  return {
    visible: ref(state.value.visible), // Expose refs for reactivity in component
    title: ref(state.value.title),
    message: ref(state.value.message),
    confirmText: ref(state.value.confirmText),
    cancelText: ref(state.value.cancelText),
    isLoading: ref(state.value.isLoading),
    // ---
    state, // Expose whole state for ConfirmDialog.vue to bind
    showDialog,
    handleConfirm,
    handleCancel,
    setLoading,
  };
});
