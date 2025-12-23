<template>
  <div
    v-if="settings"
    class="bg-background border border-border rounded-lg shadow-sm overflow-hidden"
  >
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      {{ $t('settings.category.system') }}
    </h2>
    <div class="p-6 space-y-6">
      <!-- Language -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.language.title') }}
        </h3>
        <form @submit.prevent="handleUpdateLanguage" class="space-y-4">
          <div>
            <label
              for="languageSelect"
              class="block text-sm font-medium text-text-secondary mb-1"
              >{{ $t('settings.language.selectLabel') }}</label
            >
            <select
              id="languageSelect"
              v-model="selectedLanguage"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
              style="
                background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
                background-position: right 0.75rem center;
                background-size: 16px 12px;
              "
            >
              <option v-for="locale in availableLocales" :key="locale" :value="locale">
                {{ languageNames[locale] || locale }}
                <!-- Display mapped name or locale code -->
              </option>
            </select>
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('settings.language.saveButton') }}
            </button>
            <p
              v-if="languageMessage"
              :class="['text-sm', languageSuccess ? 'text-success' : 'text-error']"
            >
              {{ languageMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Separator -->
      <!-- Timezone Setting -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.timezone.title') }}
        </h3>
        <form @submit.prevent="handleUpdateTimezone" class="space-y-4">
          <div>
            <label
              for="timezoneSelect"
              class="block text-sm font-medium text-text-secondary mb-1"
              >{{ $t('settings.timezone.selectLabel') }}</label
            >
            <select
              id="timezoneSelect"
              v-model="selectedTimezone"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
              style="
                background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
                background-position: right 0.75rem center;
                background-size: 16px 12px;
              "
            >
              <option v-for="tz in commonTimezones" :key="tz" :value="tz">
                {{ tz }}
              </option>
            </select>
            <small class="block mt-1 text-xs text-text-secondary">{{
              $t('settings.timezone.description')
            }}</small>
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.save') }}
            </button>
            <p
              v-if="timezoneMessage"
              :class="['text-sm', timezoneSuccess ? 'text-success' : 'text-error']"
            >
              {{ timezoneMessage }}
            </p>
          </div>
        </form>
      </div>
      <hr class="border-border/50" />
      <!-- Log Level Setting -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.logLevel.title', '容器日志等级') }}
        </h3>
        <form @submit.prevent="handleUpdateLogLevel" class="space-y-4">
          <div>
            <label
              for="logLevelSelect"
              class="block text-sm font-medium text-text-secondary mb-1"
              >{{ $t('settings.logLevel.selectLabel', '选择日志等级') }}</label
            >
            <select
              id="logLevelSelect"
              v-model="selectedLogLevel"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
              style="
                background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
                background-position: right 0.75rem center;
                background-size: 16px 12px;
              "
            >
              <option v-for="opt in logLevelOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
            <small class="block mt-1 text-xs text-text-secondary">{{
              $t(
                'settings.logLevel.description',
                '控制后端容器日志输出的详细程度。Debug 最详细，Silent 不输出。'
              )
            }}</small>
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              :disabled="logLevelLoading"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:opacity-50"
            >
              {{ logLevelLoading ? $t('common.saving', '保存中...') : $t('common.save') }}
            </button>
            <p
              v-if="logLevelMessage"
              :class="['text-sm', logLevelSuccess ? 'text-success' : 'text-error']"
            >
              {{ logLevelMessage }}
            </p>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings.store';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSystemSettings } from '../../composables/settings/useSystemSettings';

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);
const { t } = useI18n();

const {
  selectedLanguage,
  languageMessage,
  languageSuccess,
  languageNames,
  availableLocales,
  handleUpdateLanguage,
  selectedTimezone,
  timezoneMessage,
  timezoneSuccess,
  commonTimezones,
  handleUpdateTimezone,
  // Log Level
  logLevelOptions,
  selectedLogLevel,
  logLevelLoading,
  logLevelMessage,
  logLevelSuccess,
  handleUpdateLogLevel,
} = useSystemSettings();
</script>
