<template>
  <div class="settings-section-content">
    <h3 class="text-base font-semibold text-foreground mb-3">
      {{ $t('settings.ipWhitelist.title') }}
    </h3>
    <p class="text-sm text-text-secondary mb-4">{{ $t('settings.ipWhitelist.description') }}</p>
    <form @submit.prevent="handleUpdateIpWhitelist" class="space-y-4">
      <div>
        <label for="ipWhitelist" class="block text-sm font-medium text-text-secondary mb-1">{{
          $t('settings.ipWhitelist.label')
        }}</label>
        <textarea
          id="ipWhitelist"
          v-model="ipWhitelistInput"
          rows="4"
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary font-mono text-sm"
        ></textarea>
        <small class="block mt-1 text-xs text-text-secondary">{{
          $t('settings.ipWhitelist.hint')
        }}</small>
      </div>
      <div class="flex items-center justify-between">
        <button
          type="submit"
          :disabled="ipWhitelistLoading"
          class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
        >
          {{ ipWhitelistLoading ? $t('common.loading') : $t('settings.ipWhitelist.saveButton') }}
        </button>
        <p
          v-if="ipWhitelistMessage"
          :class="['text-sm', ipWhitelistSuccess ? 'text-success' : 'text-error']"
        >
          {{ ipWhitelistMessage }}
        </p>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useIpWhitelist } from '../../composables/settings/useIpWhitelist';

// const { t } = useI18n(); // $t is globally available in template

const {
  ipWhitelistInput,
  ipWhitelistLoading,
  ipWhitelistMessage,
  ipWhitelistSuccess,
  handleUpdateIpWhitelist,
} = useIpWhitelist();
</script>

<style scoped>
/* Styles specific to IpWhitelistSettings if any */
</style>
