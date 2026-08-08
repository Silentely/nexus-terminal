<script setup lang="ts">
import { useUiNotificationsStore, type UINotificationType } from '../stores/uiNotifications.store';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const notificationsStore = useUiNotificationsStore();
const { notifications } = storeToRefs(notificationsStore);

const ICON_CLASSES: Record<UINotificationType, string> = {
  success: 'fas fa-check-circle',
  error: 'fas fa-times-circle',
  info: 'fas fa-info-circle',
  warning: 'fas fa-exclamation-triangle',
};

const getIconClass = (type: UINotificationType): string => ICON_CLASSES[type];
</script>

<template>
  <div
    class="fixed top-4 right-4 z-[1100] flex flex-col items-end"
    role="status"
    aria-live="polite"
    aria-atomic="false"
  >
    <transition-group
      tag="div"
      enter-active-class="transition duration-500 ease-out"
      enter-from-class="transform translate-x-[30px] opacity-0"
      enter-to-class="transform translate-x-0 opacity-95"
      leave-active-class="transition duration-500 ease-in"
      leave-from-class="transform translate-x-0 opacity-95"
      leave-to-class="transform translate-x-[30px] opacity-0"
    >
      <div
        v-for="notification in notifications"
        :key="notification.id"
        :class="[
          'flex items-center p-3 mb-2 rounded shadow-md min-w-[250px] max-w-[400px] opacity-95 text-white',
          {
            'bg-success': notification.type === 'success',
            'bg-error': notification.type === 'error',
            'bg-primary': notification.type === 'info',
            'bg-warning text-warning-text': notification.type === 'warning',
          },
        ]"
      >
        <i
          :class="['mr-3 text-lg relative top-px text-white', getIconClass(notification.type)]"
        ></i>
        <span class="flex-grow break-words text-sm">{{ notification.message }}</span>
        <button
          class="ml-4 p-1 bg-transparent border-none text-white opacity-70 hover:opacity-100 cursor-pointer text-lg leading-none"
          :aria-label="t('common.close')"
          @click="notificationsStore.removeNotification(notification.id)"
        >
          &times;
        </button>
      </div>
    </transition-group>
  </div>
</template>
