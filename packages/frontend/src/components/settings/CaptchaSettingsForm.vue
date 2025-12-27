<template>
  <div class="settings-section-content">
    <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.captcha.title') }}</h3>
    <p class="text-sm text-text-secondary mb-4">{{ $t('settings.captcha.description') }}</p>
    <div
      v-if="captchaError"
      class="p-4 mb-4 border-l-4 border-error bg-error/10 text-error rounded flex items-start justify-between gap-4"
    >
      <div class="min-w-0 break-words">
        {{ captchaError }}
      </div>
      <button
        type="button"
        class="shrink-0 px-3 py-1.5 bg-error text-white rounded-md shadow-sm hover:bg-error/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error transition duration-150 ease-in-out text-sm font-medium"
        @click="retryLoadCaptchaSettings"
      >
        {{ $t('common.retry', '重试') }}
      </button>
    </div>
    <div v-else-if="!captchaSettings" class="p-4 text-center text-text-secondary italic">
      {{ $t('common.loading') }}
    </div>
    <form v-if="captchaSettings" @submit.prevent="handleUpdateCaptchaSettings" class="space-y-4">
      <!-- Enable Switch -->
      <div class="flex items-center">
        <input
          type="checkbox"
          id="captchaEnabled"
          v-model="captchaForm.enabled"
          class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
        />
        <label for="captchaEnabled" class="text-sm text-foreground cursor-pointer select-none">{{
          $t('settings.captcha.enableLabel')
        }}</label>
      </div>

      <!-- Provider Select (Only show if enabled) -->
      <div v-if="captchaForm.enabled">
        <label for="captchaProvider" class="block text-sm font-medium text-text-secondary mb-1">{{
          $t('settings.captcha.providerLabel')
        }}</label>
        <select
          id="captchaProvider"
          v-model="captchaForm.provider"
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
          style="
            background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
            background-position: right 0.75rem center;
            background-size: 16px 12px;
          "
        >
          <option value="none">{{ $t('settings.captcha.providerNone') }}</option>
          <option value="hcaptcha">hCaptcha</option>
          <option value="recaptcha">Google reCAPTCHA v2</option>
        </select>
      </div>

      <!-- hCaptcha Settings (Only show if enabled and provider is hcaptcha) -->
      <div
        v-if="captchaForm.enabled && captchaForm.provider === 'hcaptcha'"
        class="space-y-4 pl-4 border-l-2 border-border/50 ml-1 pt-2"
      >
        <p class="text-xs text-text-secondary">
          {{ $t('settings.captcha.hcaptchaHint') }}
          <a
            href="https://www.hcaptcha.com/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
            >hCaptcha.com</a
          >
        </p>
        <div>
          <label for="hcaptchaSiteKey" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.captcha.siteKeyLabel')
          }}</label>
          <input
            type="text"
            id="hcaptchaSiteKey"
            v-model="captchaForm.hcaptchaSiteKey"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label
            for="hcaptchaSecretKey"
            class="block text-sm font-medium text-text-secondary mb-1"
            >{{ $t('settings.captcha.secretKeyLabel') }}</label
          >
          <input
            type="password"
            id="hcaptchaSecretKey"
            v-model="captchaForm.hcaptchaSecretKey"
            placeholder="••••••••••••"
            autocomplete="new-password"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
          <small class="block mt-1 text-xs text-text-secondary">{{
            $t('settings.captcha.secretKeyHint')
          }}</small>
        </div>
      </div>

      <!-- reCAPTCHA Settings (Only show if enabled and provider is recaptcha) -->
      <div
        v-if="captchaForm.enabled && captchaForm.provider === 'recaptcha'"
        class="space-y-4 pl-4 border-l-2 border-border/50 ml-1 pt-2"
      >
        <p class="text-xs text-text-secondary">
          {{ $t('settings.captcha.recaptchaHint') }}
          <a
            href="https://www.google.com/recaptcha/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
            >Google reCAPTCHA</a
          >
        </p>
        <div>
          <label
            for="recaptchaSiteKey"
            class="block text-sm font-medium text-text-secondary mb-1"
            >{{ $t('settings.captcha.siteKeyLabel') }}</label
          >
          <input
            type="text"
            id="recaptchaSiteKey"
            v-model="captchaForm.recaptchaSiteKey"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div>
          <label
            for="recaptchaSecretKey"
            class="block text-sm font-medium text-text-secondary mb-1"
            >{{ $t('settings.captcha.secretKeyLabel') }}</label
          >
          <input
            type="password"
            id="recaptchaSecretKey"
            v-model="captchaForm.recaptchaSecretKey"
            placeholder="••••••••••••"
            autocomplete="new-password"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
          <small class="block mt-1 text-xs text-text-secondary">{{
            $t('settings.captcha.secretKeyHint')
          }}</small>
        </div>
      </div>

      <!-- Save Button & Message -->
      <div class="flex items-center justify-between pt-2">
        <button
          type="submit"
          :disabled="captchaLoading"
          class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
        >
          {{ $t('settings.captcha.saveButton') }}
        </button>
        <p
          v-if="captchaMessage"
          :class="['text-sm', captchaSuccess ? 'text-success' : 'text-error']"
        >
          {{ captchaMessage }}
        </p>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../../stores/settings.store';
import { useCaptchaSettings } from '../../composables/settings/useCaptchaSettings';

// const { t } = useI18n(); // $t is globally available in template
const settingsStore = useSettingsStore();
const { captchaSettings, captchaError } = storeToRefs(settingsStore); // To make v-if="!captchaSettings" reactive

const { captchaForm, captchaLoading, captchaMessage, captchaSuccess, handleUpdateCaptchaSettings } =
  useCaptchaSettings();

const retryLoadCaptchaSettings = async () => {
  await settingsStore.loadCaptchaSettings();
};

// onMounted in parent SettingsView.vue loads captchaSettings via settingsStore.loadCaptchaSettings()
</script>

<style scoped>
/* Styles specific to CaptchaSettingsForm if any */
</style>
