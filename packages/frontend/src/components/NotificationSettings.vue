<template>
  <div class="p-0">
    <h2 class="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-border">
      <!-- Title styling -->
      {{ $t('settings.notifications.title') }}
    </h2>

    <!-- Error state (Show first if error exists) -->
    <div v-if="store.error" class="p-4 mb-4 border-l-4 border-error bg-error/10 text-error rounded">
      {{ store.error }}
    </div>

    <!-- Add Button (Show if no error) -->
    <button
      v-if="!store.error"
      @click="showAddForm = true"
      class="px-4 py-2 bg-button text-button-text rounded hover:bg-button-hover mb-4 inline-flex items-center text-sm font-medium"
    >
      {{ $t('settings.notifications.addChannel') }}
    </button>

    <!-- Loading state (Show only if loading AND settings empty AND no error) -->
    <div
      v-if="store.isLoading && settings.length === 0 && !store.error"
      class="p-4 text-center text-text-secondary italic"
    >
      {{ $t('common.loading') }}
    </div>

    <!-- Empty state (Show only if not loading, no error, and settings empty) -->
    <div
      v-else-if="!store.isLoading && !store.error && settings.length === 0"
      class="p-4 mb-4 border-l-4 border-blue-400 bg-blue-100 text-blue-700 rounded"
    >
      {{ $t('settings.notifications.noChannels') }}
    </div>

    <!-- Notification List (Show if not loading, no error, and has settings) -->
    <div
      v-else-if="!store.isLoading && !store.error && settings.length > 0"
      class="grid gap-4 mt-4"
    >
      <div
        v-for="setting in settings"
        :key="setting.id"
        class="bg-background border border-border rounded-lg p-4 flex justify-between items-start gap-4 shadow-sm hover:shadow-md transition-shadow duration-200"
      >
        <!-- List item card -->
        <div class="flex-grow">
          <!-- Details section -->
          <strong class="block font-semibold text-base mb-1 text-foreground">{{
            setting.name
          }}</strong>
          <div class="flex items-center space-x-2 mb-2">
            <!-- Badges section -->
            <span
              class="px-2 py-0.5 rounded-full text-xs font-semibold bg-header border border-border text-text-secondary uppercase tracking-wider"
            >
              <!-- Channel type badge -->
              {{ getChannelTypeName(setting.channel_type) }}
            </span>
            <span
              :class="[
                'px-2 py-0.5 rounded-full text-xs font-semibold border uppercase tracking-wider',
                setting.enabled
                  ? 'bg-success/10 text-success border-success/30'
                  : 'bg-warning/10 text-warning border-warning/30',
              ]"
            >
              <!-- Status badge using success/warning colors -->
              {{ setting.enabled ? $t('common.enabled') : $t('common.disabled') }}
            </span>
          </div>
          <small class="block text-sm text-text-secondary mt-1">{{
            getEventNames(setting.enabled_events)
          }}</small>
          <!-- Events text -->
        </div>
        <div class="flex items-center flex-shrink-0 space-x-3">
          <!-- Actions section -->
          <button
            @click="editSetting(setting)"
            class="text-link hover:text-link-hover text-sm font-medium hover:underline"
          >
            <!-- Edit button (link style) -->
            <i class="fas fa-pencil-alt mr-1 text-xs"></i>{{ $t('common.edit') }}
          </button>
          <button
            @click="confirmDelete(setting)"
            class="text-error hover:text-error/80 text-sm font-medium hover:underline"
          >
            <!-- Delete button (error color) -->
            <i class="fas fa-trash-alt mr-1 text-xs"></i>{{ $t('common.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Add/Edit Form Section -->
    <div
      v-if="showAddForm || editingSetting"
      class="mt-6 p-6 border border-border bg-background rounded-lg shadow-sm"
    >
      <!-- Form container -->
      <NotificationSettingForm
        v-if="showAddForm || editingSetting"
        :initial-data="editingSetting"
        @save="handleSave"
        @cancel="closeForm"
        class="mt-0"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useNotificationsStore } from '../stores/notifications.store';
import {
  NotificationSetting,
  NotificationChannelType,
  NotificationEvent,
} from '../types/server.types';
import NotificationSettingForm from './NotificationSettingForm.vue';
import { useI18n } from 'vue-i18n';
import { useConfirmDialog } from '../composables/useConfirmDialog';

const store = useNotificationsStore();
const { showConfirmDialog } = useConfirmDialog();
const { t } = useI18n();

const showAddForm = ref(false);
const editingSetting = ref<NotificationSetting | null>(null);

const settings = computed(() => store.settings);

onMounted(() => {
  store.fetchSettings();
});

const getChannelTypeName = (type: NotificationChannelType): string => {
  switch (type) {
    case 'webhook':
      return t('settings.notifications.types.webhook');
    case 'email':
      return t('settings.notifications.types.email');
    case 'telegram':
      return t('settings.notifications.types.telegram');
    default:
      return type;
  }
};

// Helper function to translate a single event name
const getSingleEventDisplayName = (event: NotificationEvent): string => {
  const i18nKey = `settings.notifications.events.${event}`;
  const translated = t(i18nKey);
  // Fallback if translation is missing
  if (translated === i18nKey) {
    console.warn(`Missing translation for notification event: ${i18nKey}`);
    return event
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }
  return translated;
};

const getEventNames = (events: NotificationEvent[]): string => {
  if (!events || events.length === 0) return t('settings.notifications.noEventsEnabled');
  // Translate each event name
  const translatedNames = events.map((event) => getSingleEventDisplayName(event));
  return t('settings.notifications.triggers') + ': ' + translatedNames.join(', ');
};

const editSetting = (setting: NotificationSetting) => {
  editingSetting.value = { ...setting }; // Clone to avoid modifying store directly
  showAddForm.value = false; // Ensure add form is hidden
};

const confirmDelete = async (setting: NotificationSetting) => {
  if (setting.id) {
    const confirmed = await showConfirmDialog({
      message: t('settings.notifications.confirmDelete', { name: setting.name }),
    });
    if (confirmed) {
      store.deleteSetting(setting.id);
    }
  }
};

const closeForm = () => {
  showAddForm.value = false;
  editingSetting.value = null;
};

// TODO: Implement save logic when form component is ready
const handleSave = (savedSetting: NotificationSetting) => {
  console.log('Setting saved:', savedSetting);
  closeForm();
  // The store should have updated the list automatically after add/update
  // Optionally, you could force a refresh if needed: store.fetchSettings();
};
</script>

<style scoped>
/* Remove all scoped styles as they are now handled by Tailwind utility classes */
</style>
