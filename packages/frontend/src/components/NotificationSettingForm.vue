<template>
  <form @submit.prevent="handleSubmit" class="space-y-6 text-foreground">
    <!-- Form container with spacing -->
    <h3 class="text-lg font-semibold mb-4 pb-2 border-b border-border">
      <!-- Title -->
      {{
        isEditing
          ? $t('settings.notifications.form.editTitle')
          : $t('settings.notifications.form.addTitle')
      }}
    </h3>

    <!-- General Settings -->
    <div class="space-y-4">
      <div>
        <label for="setting-name" class="block text-sm font-medium text-text-secondary mb-1">{{
          $t('settings.notifications.form.name')
        }}</label>
        <input
          type="text"
          id="setting-name"
          v-model="formData.name"
          required
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>

      <div class="flex items-center">
        <input
          type="checkbox"
          id="setting-enabled"
          v-model="formData.enabled"
          class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
        />
        <label for="setting-enabled" class="text-sm text-foreground cursor-pointer">{{
          $t('common.enabled')
        }}</label>
      </div>

      <div>
        <label
          for="setting-channel-type"
          class="block text-sm font-medium text-text-secondary mb-1"
          >{{ $t('settings.notifications.form.channelType') }}</label
        >
        <select
          id="setting-channel-type"
          v-model="formData.channel_type"
          required
          :disabled="isEditing"
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8 disabled:opacity-70 disabled:bg-header/50"
          style="
            background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
            background-position: right 0.75rem center;
            background-size: 16px 12px;
          "
        >
          <option value="webhook">{{ $t('settings.notifications.types.webhook') }}</option>
          <option value="email">{{ $t('settings.notifications.types.email') }}</option>
          <option value="telegram">{{ $t('settings.notifications.types.telegram') }}</option>
        </select>
        <small v-if="isEditing" class="block mt-1 text-xs text-text-secondary">{{
          $t('settings.notifications.form.channelTypeEditNote')
        }}</small>
      </div>
    </div>

    <!-- Channel Specific Config -->
    <div class="border border-border rounded-md p-4 mt-4 bg-header/30 space-y-4">
      <!-- Config section container -->
      <h4 class="text-base font-semibold mb-3 pb-2 border-b border-border/50">
        <!-- Config section title -->
        {{ $t(`settings.notifications.types.${formData.channel_type}`) }}
        {{ $t('common.settings') }}
      </h4>

      <!-- Webhook Config -->
      <div v-if="formData.channel_type === 'webhook'" class="space-y-4">
        <div>
          <label for="webhook-url" class="block text-sm font-medium text-text-secondary mb-1"
            >URL</label
          >
          <input
            type="url"
            id="webhook-url"
            v-model="webhookConfig.url"
            required
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label for="webhook-method" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.webhookMethod')
          }}</label>
          <select
            id="webhook-method"
            v-model="webhookConfig.method"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
            style="
              background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
              background-position: right 0.75rem center;
              background-size: 16px 12px;
            "
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
            <option value="PUT">PUT</option>
          </select>
        </div>
        <div>
          <label for="webhook-headers" class="block text-sm font-medium text-text-secondary mb-1"
            >{{ $t('settings.notifications.form.webhookHeaders') }} (JSON)</label
          >
          <textarea
            id="webhook-headers"
            v-model="webhookHeadersString"
            rows="3"
            placeholder='{"Content-Type": "application/json", "Authorization": "Bearer ..."}'
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary font-mono text-sm"
          ></textarea>
          <small v-if="headerError" class="block mt-1 text-xs text-error">{{ headerError }}</small>
          <!-- Use text-error -->
        </div>
        <div>
          <label for="webhook-body" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.webhookBodyTemplate')
          }}</label>
          <textarea
            id="webhook-body"
            v-model="webhookConfig.bodyTemplate"
            rows="3"
            :placeholder="`${$t('settings.notifications.form.webhookBodyPlaceholder')} {event}, {timestamp}, {details}`"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary font-mono text-sm"
          ></textarea>
          <small class="block mt-1 text-xs text-text-secondary"
            >{{ $t('settings.notifications.form.templateHelp') }} {event}, {timestamp}, {details}
            (JSON string)</small
          >
        </div>
      </div>

      <!-- Email Config -->
      <div v-if="formData.channel_type === 'email'" class="space-y-4">
        <div>
          <label for="email-to" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.emailTo')
          }}</label>
          <input
            type="email"
            id="email-to"
            v-model="emailConfig.to"
            required
            multiple
            placeholder="recipient1@example.com, recipient2@example.com"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
          <small class="block mt-1 text-xs text-text-secondary">{{
            $t('settings.notifications.form.emailToHelp')
          }}</small>
        </div>
        <div>
          <label for="email-body" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.emailBodyTemplate')
          }}</label>
          <!-- Changed key -->
          <textarea
            id="email-body"
            v-model="emailConfig.bodyTemplate"
            rows="3"
            :placeholder="`${$t('settings.notifications.form.emailBodyPlaceholder')} {event}, {timestamp}, {details}`"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary font-mono text-sm"
          ></textarea>
          <!-- Changed to textarea and v-model -->
          <small class="block mt-1 text-xs text-text-secondary"
            >{{ $t('settings.notifications.form.templateHelp') }} {event}, {timestamp},
            {details}</small
          >
          <!-- Added available placeholders -->
        </div>
        <!-- SMTP Settings -->
        <div>
          <label for="smtp-host" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.smtpHost')
          }}</label>
          <input
            type="text"
            id="smtp-host"
            v-model="emailConfig.smtpHost"
            required
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="smtp-port" class="block text-sm font-medium text-text-secondary mb-1">{{
              $t('settings.notifications.form.smtpPort')
            }}</label>
            <input
              type="number"
              id="smtp-port"
              v-model.number="emailConfig.smtpPort"
              required
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
          <div class="flex items-end pb-1">
            <!-- Align checkbox with bottom of port input -->
            <div class="flex items-center">
              <input
                type="checkbox"
                id="smtp-secure"
                v-model="emailConfig.smtpSecure"
                class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
              />
              <label for="smtp-secure" class="text-sm text-foreground cursor-pointer"
                >{{ $t('settings.notifications.form.smtpSecure') }} (TLS)</label
              >
            </div>
          </div>
        </div>
        <div>
          <label for="smtp-user" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.smtpUser')
          }}</label>
          <input
            type="text"
            id="smtp-user"
            v-model="emailConfig.smtpUser"
            autocomplete="off"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label for="smtp-pass" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.smtpPass')
          }}</label>
          <input
            type="password"
            id="smtp-pass"
            v-model="emailConfig.smtpPass"
            autocomplete="new-password"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label for="smtp-from" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.smtpFrom')
          }}</label>
          <input
            type="email"
            id="smtp-from"
            v-model="emailConfig.from"
            required
            placeholder="sender@example.com"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
          <small class="block mt-1 text-xs text-text-secondary">{{
            $t('settings.notifications.form.smtpFromHelp')
          }}</small>
        </div>
      </div>

      <!-- Telegram Config -->
      <div v-if="formData.channel_type === 'telegram'" class="space-y-4">
        <div>
          <label for="telegram-token" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.telegramToken')
          }}</label>
          <input
            type="password"
            id="telegram-token"
            v-model="telegramConfig.botToken"
            required
            autocomplete="new-password"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label for="telegram-chatid" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.notifications.form.telegramChatId')
          }}</label>
          <input
            type="text"
            id="telegram-chatid"
            v-model="telegramConfig.chatId"
            required
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label
            for="telegram-custom-domain"
            class="block text-sm font-medium text-text-secondary mb-1"
            >{{ $t('settings.notifications.form.telegramCustomDomain') }}</label
          >
          <input
            type="url"
            id="telegram-custom-domain"
            v-model="telegramConfig.customDomain"
            placeholder="https://api.example.com"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label
            for="telegram-message"
            class="block text-sm font-medium text-text-secondary mb-1"
            >{{ $t('settings.notifications.form.telegramMessageTemplate') }}</label
          >
          <textarea
            id="telegram-message"
            v-model="telegramConfig.messageTemplate"
            rows="3"
            :placeholder="`${$t('settings.notifications.form.telegramMessagePlaceholder')} {event}, {timestamp}, {details}.`"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary font-mono text-sm"
          ></textarea>
        </div>
      </div>

      <!-- Unified Test Button Area -->
      <div class="text-center pt-4 mt-4 border-t border-border/50">
        <!-- Test button container -->
        <button
          v-if="isEditing || canTestUnsaved"
          type="button"
          @click="handleTestNotification"
          :disabled="testingNotification"
          class="px-3 py-1.5 border border-border rounded-md text-sm font-medium text-text-secondary bg-background hover:bg-header focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
        >
          <svg
            v-if="testingNotification"
            class="animate-spin -ml-0.5 mr-2 h-4 w-4 text-text-secondary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          {{
            testingNotification
              ? $t('common.testing')
              : $t('settings.notifications.form.testButton')
          }}
        </button>
        <!-- Show hint if adding and required fields are NOT filled -->
        <small v-else class="block mt-2 text-xs text-text-secondary">
          {{ $t('settings.notifications.form.fillRequiredToTest') }}
        </small>
        <!-- Show test result message if available -->
        <small
          v-if="testResult"
          :class="['block mt-2 text-xs', testResult.success ? 'text-success' : 'text-error']"
        >
          <!-- Use text-success/text-error -->
          {{ testResult.message }}
        </small>
      </div>
    </div>

    <!-- Enabled Events -->
    <div>
      <label class="block text-sm font-medium text-text-secondary mb-2">{{
        $t('settings.notifications.form.enabledEvents')
      }}</label>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
        <!-- Responsive grid for events -->
        <div v-for="event in allNotificationEvents" :key="event">
          <div class="flex items-center">
            <input
              type="checkbox"
              :id="'event-' + event"
              :value="event"
              v-model="formData.enabled_events"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
            />
            <label
              :for="'event-' + event"
              class="text-sm text-foreground cursor-pointer select-none"
              >{{ getEventDisplayName(event) }}</label
            >
          </div>
        </div>
      </div>
    </div>

    <!-- Form Actions -->
    <div class="flex justify-end space-x-3 pt-5 mt-6 border-t border-border">
      <button
        type="button"
        @click="handleCancel"
        class="px-4 py-2 bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
      >
        {{ $t('common.cancel') }}
      </button>
      <button
        type="submit"
        :disabled="store.isLoading || !!headerError || testingNotification"
        class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
      >
        {{ store.isLoading ? $t('common.saving') : $t('common.save') }}
      </button>
    </div>
    <div
      v-if="formError"
      class="p-3 mt-3 border-l-4 border-error bg-error/10 text-error text-sm rounded"
    >
      {{ formError }}
    </div>
    <!-- Use error colors -->
    <div
      v-if="testError"
      class="p-3 mt-3 border-l-4 border-error bg-error/10 text-error text-sm rounded"
    >
      {{ testError }}
    </div>
    <!-- Use error colors -->
  </form>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, PropType, nextTick } from 'vue';
import { useNotificationsStore } from '../stores/notifications.store';
import {
  NotificationSetting,
  NotificationEvent,
  WebhookConfig,
  EmailConfig,
  TelegramConfig,
  NotificationChannelType,
} from '../types/server.types';
import { useI18n } from 'vue-i18n';

interface SmtpEmailConfig extends Omit<EmailConfig, 'subjectTemplate'> {
  bodyTemplate?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  from?: string; // Add 'from' address
}

const props = defineProps({
  initialData: {
    type: Object as PropType<NotificationSetting | null>,
    default: null,
  },
});

const emit = defineEmits(['save', 'cancel']);

const store = useNotificationsStore();
console.log('[NotificationSettingForm] Setup started.'); // Log setup start
const { t } = useI18n();
console.log('[NotificationSettingForm] useI18n initialized.'); // Log i18n init
const formError = ref<string | null>(null);
const headerError = ref<string | null>(null);
const testError = ref<string | null>(null);
const testingNotification = ref(false);
const testResult = ref<{ success: boolean; message: string } | null>(null);

const isEditing = computed(() => !!props.initialData?.id);

// Computed property to check if necessary fields for testing unsaved config are filled
const canTestUnsaved = computed(() => {
  if (isEditing.value) return true; // Always allow testing saved settings

  switch (formData.channel_type) {
    case 'webhook':
      return !!webhookConfig.value.url && !headerError.value;
    case 'email':
      return (
        !!emailConfig.value.to &&
        !!emailConfig.value.smtpHost &&
        !!emailConfig.value.smtpPort &&
        !!emailConfig.value.from
      );
    case 'telegram':
      return !!telegramConfig.value.botToken && !!telegramConfig.value.chatId;
    default:
      return false;
  }
});

// Define all possible events (aligned with AuditLogView's allActionTypes)
const allNotificationEvents: NotificationEvent[] = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGOUT',
  'PASSWORD_CHANGED',
  '2FA_ENABLED',
  '2FA_DISABLED',
  // Passkey Events
  // 'PASSKEY_AUTH_SUCCESS',
  // 'PASSKEY_AUTH_FAILURE',
  'CONNECTION_CREATED',
  'CONNECTION_UPDATED',
  'CONNECTION_DELETED',
  'PROXY_CREATED',
  'PROXY_UPDATED',
  'PROXY_DELETED',
  'TAG_CREATED',
  'TAG_UPDATED',
  'TAG_DELETED',
  'SETTINGS_UPDATED',
  'IP_WHITELIST_UPDATED',
  'IP_BLOCKED', // Added IP_BLOCKED as it's in backend types
  'NOTIFICATION_SETTING_CREATED',
  'NOTIFICATION_SETTING_UPDATED',
  'NOTIFICATION_SETTING_DELETED',
  'SSH_CONNECT_SUCCESS',
  'SSH_CONNECT_FAILURE',
  'SSH_SHELL_FAILURE',
  'DATABASE_MIGRATION',
  'ADMIN_SETUP_COMPLETE',
  // Removed IP_BLACKLISTED as it's not in the Audit Log list source, but IP_BLOCKED is present in backend types
];

// Reactive form data structure
const getDefaultFormData = (): Omit<
  NotificationSetting,
  'id' | 'created_at' | 'updated_at' | 'config'
> & { config: any } => ({
  name: '',
  enabled: true,
  channel_type: 'webhook',
  config: {}, // Will be populated based on channel_type
  enabled_events: ['LOGIN_FAILURE'], // Sensible defaults
});

const formData = reactive(getDefaultFormData());

// Specific config refs for easier v-model binding
const webhookConfig = ref<WebhookConfig>({
  url: '',
  method: 'POST',
  headers: {},
  bodyTemplate: '',
});
const emailConfig = ref<SmtpEmailConfig>({
  // Use extended type
  to: '',
  bodyTemplate: '', // Changed from subjectTemplate
  smtpHost: '',
  smtpPort: 587, // Default port
  smtpSecure: true, // Default to true (TLS)
  smtpUser: '',
  smtpPass: '',
  from: '',
});
const telegramConfig = ref<TelegramConfig>({
  botToken: '',
  chatId: '',
  messageTemplate: '',
  customDomain: '',
});
const webhookHeadersString = ref('{}'); // For textarea binding

// Watch for initialData changes (when editing)
watch(
  () => props.initialData,
  (newData) => {
    console.log('[NotificationSettingForm] Watch initialData triggered. New data:', newData); // Log initialData change
    if (newData) {
      Object.assign(formData, newData);
      // Populate specific config refs based on channel type
      if (newData.channel_type === 'webhook') {
        webhookConfig.value = { ...(newData.config as WebhookConfig) };
        webhookHeadersString.value = JSON.stringify(webhookConfig.value.headers || {}, null, 2);
      } else if (newData.channel_type === 'email') {
        // Ensure all fields are present, providing defaults if missing from saved config
        const savedConfig = newData.config as SmtpEmailConfig;
        emailConfig.value = {
          to: savedConfig.to || '',
          bodyTemplate: savedConfig.bodyTemplate || '', // Changed from subjectTemplate
          smtpHost: savedConfig.smtpHost || '',
          smtpPort: savedConfig.smtpPort || 587,
          smtpSecure: savedConfig.smtpSecure === undefined ? true : savedConfig.smtpSecure, // Default true if undefined
          smtpUser: savedConfig.smtpUser || '',
          smtpPass: savedConfig.smtpPass || '', // Password might not be sent back, handle appropriately
          from: savedConfig.from || '',
        };
      } else if (newData.channel_type === 'telegram') {
        const savedConfig = newData.config as TelegramConfig;
        telegramConfig.value = {
          botToken: savedConfig.botToken || '',
          chatId: savedConfig.chatId || '',
          messageTemplate: savedConfig.messageTemplate || '',
          customDomain: savedConfig.customDomain || '', // Add customDomain
        };
      }
    } else {
      // Reset form if initialData becomes null (e.g., switching from edit to add)
      Object.assign(formData, getDefaultFormData());
      webhookConfig.value = { url: '', method: 'POST', headers: {}, bodyTemplate: '' };
      // Reset email config with defaults
      emailConfig.value = {
        to: '',
        bodyTemplate: '',
        smtpHost: '',
        smtpPort: 587,
        smtpSecure: true,
        smtpUser: '',
        smtpPass: '',
        from: '', // Changed from subjectTemplate
      };
      telegramConfig.value = { botToken: '', chatId: '', messageTemplate: '', customDomain: '' }; // Add customDomain
      webhookHeadersString.value = '{}';
    }
    headerError.value = null; // Reset header error on data change
    testError.value = null; // Reset test error
    testResult.value = null; // Reset test result
    testingNotification.value = false; // Reset testing state
    console.log(
      '[NotificationSettingForm] Form data initialized/updated from initialData. Current channel_type:',
      formData.channel_type
    ); // Log after init/update
  },
  { immediate: true }
);

// Watch channel type change to reset specific config
watch(
  () => formData.channel_type,
  (newType, oldType) => {
    console.log(
      `[NotificationSettingForm] Watch channel_type changed from ${oldType} to ${newType}`
    ); // Log channel type change
    if (newType !== oldType && !isEditing.value) {
      // Only reset if not editing or type changes during add mode
      webhookConfig.value = { url: '', method: 'POST', headers: {}, bodyTemplate: '' };
      emailConfig.value = {
        to: '',
        bodyTemplate: '',
        smtpHost: '',
        smtpPort: 587,
        smtpSecure: true,
        smtpUser: '',
        smtpPass: '',
        from: '', // Changed from subjectTemplate
      };
      telegramConfig.value = { botToken: '', chatId: '', messageTemplate: '', customDomain: '' }; // Add customDomain
      webhookHeadersString.value = '{}';
      headerError.value = null;
      testError.value = null;
      testResult.value = null;
      testingNotification.value = false;
    }
    // Always reset test state when type changes
    testError.value = null;
    testResult.value = null;
    testingNotification.value = false;
  }
);

// Watch header string to validate JSON
watch(webhookHeadersString, (newVal) => {
  if (formData.channel_type !== 'webhook') return;
  try {
    const parsed = JSON.parse(newVal || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Headers must be a JSON object.');
    }
    webhookConfig.value.headers = parsed;
    headerError.value = null;
  } catch (e: any) {
    headerError.value = t('settings.notifications.form.invalidJson') + `: ${e.message}`;
  }
});

// Watch for changes in email config to clear previous test results
watch(
  emailConfig,
  () => {
    testResult.value = null;
    testError.value = null;
  },
  { deep: true }
);

const getEventDisplayName = (event: NotificationEvent): string => {
  // Use i18n key, fallback to formatted name if key not found
  const i18nKey = `settings.notifications.events.${event}`;
  console.log(`[NotificationSettingForm] Translating event display name for key: ${i18nKey}`); // Log event key translation attempt
  const translated = t(i18nKey);
  // If translation returns the key itself, it means translation is missing
  if (translated === i18nKey) {
    console.warn(`Missing translation for notification event: ${i18nKey}`);
    return event
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase()); // Fallback
  }
  return translated;
};

const handleSubmit = async () => {
  console.log('[NotificationSettingForm] handleSubmit called.'); // Log submit start
  formError.value = null;
  if (headerError.value) return; // Don't submit if headers are invalid

  // Assign the correct config based on channel type
  if (formData.channel_type === 'webhook') {
    formData.config = webhookConfig.value;
  } else if (formData.channel_type === 'email') {
    formData.config = emailConfig.value;
  } else if (formData.channel_type === 'telegram') {
    formData.config = telegramConfig.value;
  }

  let result: NotificationSetting | null = null;
  if (isEditing.value && props.initialData?.id) {
    result = await store.updateSetting(props.initialData.id, formData);
  } else {
    result = await store.addSetting(formData);
  }

  if (result) {
    emit('save', result);
  } else {
    formError.value = store.error || t('common.errorOccurred');
  }
};

const handleCancel = () => {
  emit('cancel');
};

const handleTestNotification = async () => {
  // Allow testing if editing OR if adding and required fields are filled
  if (!isEditing.value && !canTestUnsaved.value) return;

  testingNotification.value = true;
  testError.value = null;
  testResult.value = null;

  let testConfig: any = {};
  // Prepare the config based on the current channel type
  switch (formData.channel_type) {
    case 'webhook':
      testConfig = { ...webhookConfig.value };
      // Ensure headers are parsed correctly before sending
      try {
        testConfig.headers = JSON.parse(webhookHeadersString.value || '{}');
        if (
          typeof testConfig.headers !== 'object' ||
          testConfig.headers === null ||
          Array.isArray(testConfig.headers)
        ) {
          throw new Error('Headers must be a JSON object.');
        }
      } catch (e: any) {
        testResult.value = {
          success: false,
          message: t('settings.notifications.form.invalidJson') + `: ${e.message}`,
        };
        testingNotification.value = false;
        return;
      }
      break;
    case 'email':
      testConfig = { ...emailConfig.value };
      break;
    case 'telegram':
      testConfig = { ...telegramConfig.value };
      break;
    default:
      console.error('Unknown channel type for testing:', formData.channel_type);
      testResult.value = { success: false, message: '未知渠道类型无法测试' };
      testingNotification.value = false;
      return;
  }

  try {
    let result: { success: boolean; message: string };
    if (isEditing.value && props.initialData?.id) {
      // Test existing setting
      result = await store.testSetting(props.initialData.id, testConfig);
    } else {
      // Test unsaved setting
      result = await store.testUnsavedSetting(formData.channel_type, testConfig);
    }
    // Translate the message received from the backend using t()
    testResult.value = {
      success: true,
      message: t(result.message || 'settings.notifications.form.testSuccess'),
    };
  } catch (error: any) {
    console.error('Test notification error:', error);
    const message =
      error?.response?.data?.message ||
      error.message ||
      t('settings.notifications.form.testFailed');
    testResult.value = { success: false, message: message };
    // Optionally set testError if you want a separate display area for errors vs results
    // testError.value = message;
  } finally {
    testingNotification.value = false;
    // Automatically clear the result message after a few seconds
    await nextTick(); // Ensure DOM is updated before setting timeout
    setTimeout(() => {
      testResult.value = null;
    }, 5000); // Clear after 5 seconds
  }
};
</script>

<style scoped>
/* Remove all scoped styles as they are now handled by Tailwind utility classes */
</style>
