<template>
  <div
    v-if="settings"
    class="bg-background border border-border rounded-lg shadow-sm overflow-hidden"
  >
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      {{ $t('settings.category.appearance') }}
    </h2>
    <div class="p-6 space-y-6">
      <!-- Style Customizer -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ $t('settings.appearance.title') }}
        </h3>
        <p class="text-sm text-text-secondary mb-4">{{ $t('settings.appearance.description') }}</p>
        <button
          @click="openStyleCustomizer"
          class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
        >
          {{ t('settings.appearance.customizeButton') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings.store';
import { useAppearanceStore } from '../../stores/appearance.store';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useAppearanceSettings } from '../../composables/settings/useAppearanceSettings';

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);
const appearanceStore = useAppearanceStore();
const { t } = useI18n();

const { openStyleCustomizer } = useAppearanceSettings();
</script>
