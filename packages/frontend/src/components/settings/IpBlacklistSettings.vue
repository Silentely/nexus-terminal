<template>
  <div class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
    <div class="flex items-center justify-between px-6 py-4 border-b border-border bg-header/50">
      <h2 class="text-lg font-semibold text-foreground">{{ $t('settings.ipBlacklist.title') }}</h2>
      <!-- IP Blacklist Enable/Disable Switch -->
      <button
        type="button"
        @click="handleUpdateIpBlacklistEnabled"
        :class="[
          'relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
          ipBlacklistEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
        ]"
        role="switch"
        :aria-checked="ipBlacklistEnabled"
      >
        <span
          aria-hidden="true"
          :class="[
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200',
            ipBlacklistEnabled ? 'translate-x-5' : 'translate-x-0',
          ]"
        ></span>
      </button>
    </div>
    <div class="p-6 space-y-6">
      <!-- Existing Blacklist Content (Conditional Rendering) -->
      <div v-if="ipBlacklistEnabled" class="space-y-6 pt-4">
        <p class="text-sm text-text-secondary">{{ $t('settings.ipBlacklist.description') }}</p>
        <!-- Blacklist config form -->
        <form
          @submit.prevent="handleUpdateBlacklistSettings"
          class="flex flex-wrap items-end gap-4"
        >
          <div class="flex-grow min-w-[150px]">
            <label
              for="maxLoginAttempts"
              class="block text-sm font-medium text-text-secondary mb-1"
              >{{ $t('settings.ipBlacklist.maxAttemptsLabel') }}</label
            >
            <input
              type="number"
              id="maxLoginAttempts"
              v-model="blacklistSettingsForm.maxLoginAttempts"
              min="1"
              required
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
          <div class="flex-grow min-w-[150px]">
            <label
              for="loginBanDuration"
              class="block text-sm font-medium text-text-secondary mb-1"
              >{{ $t('settings.ipBlacklist.banDurationLabel') }}</label
            >
            <input
              type="number"
              id="loginBanDuration"
              v-model="blacklistSettingsForm.loginBanDuration"
              min="1"
              required
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
          <div class="flex-shrink-0">
            <button
              type="submit"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('settings.ipBlacklist.saveConfigButton') }}
            </button>
          </div>
          <p
            v-if="blacklistSettingsMessage"
            :class="[
              'w-full mt-2 text-sm',
              blacklistSettingsSuccess ? 'text-success' : 'text-error',
            ]"
          >
            {{ blacklistSettingsMessage }}
          </p>
        </form>
        <hr class="border-border/50" />
        <!-- Blacklist table -->
        <h3 class="text-base font-semibold text-foreground">
          {{ $t('settings.ipBlacklist.currentBannedTitle') }}
        </h3>
        <!-- Error state -->
        <div
          v-if="ipBlacklist.error"
          class="p-3 border-l-4 border-error bg-error/10 text-error text-sm rounded"
        >
          {{ ipBlacklist.error }}
        </div>
        <!-- Loading state (Only show if loading AND no entries are displayed yet) -->
        <div
          v-else-if="ipBlacklist.loading && ipBlacklist.entries.length === 0"
          class="p-4 text-center text-text-secondary italic"
        >
          {{ $t('settings.ipBlacklist.loadingList') }}
        </div>
        <!-- Empty state (Show only if not loading, no error, and entries empty) -->
        <p
          v-else-if="!ipBlacklist.loading && !ipBlacklist.error && ipBlacklist.entries.length === 0"
          class="p-4 text-center text-text-secondary italic"
        >
          {{ $t('settings.ipBlacklist.noBannedIps') }}
        </p>
        <!-- Table (Show if not loading, no error, and has entries) -->
        <div
          v-else-if="!ipBlacklist.loading && !ipBlacklist.error && ipBlacklist.entries.length > 0"
          class="overflow-x-auto border border-border rounded-lg shadow-sm bg-background"
        >
          <table class="min-w-full divide-y divide-border text-sm">
            <thead class="bg-header">
              <tr>
                <th
                  scope="col"
                  class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap"
                >
                  {{ $t('settings.ipBlacklist.table.ipAddress') }}
                </th>
                <th
                  scope="col"
                  class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap"
                >
                  {{ $t('settings.ipBlacklist.table.attempts') }}
                </th>
                <th
                  scope="col"
                  class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap"
                >
                  {{ $t('settings.ipBlacklist.table.lastAttempt') }}
                </th>
                <th
                  scope="col"
                  class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap"
                >
                  {{ $t('settings.ipBlacklist.table.bannedUntil') }}
                </th>
                <th
                  scope="col"
                  class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap"
                >
                  {{ $t('settings.ipBlacklist.table.actions') }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="entry in ipBlacklist.entries" :key="entry.ip" class="hover:bg-header/50">
                <td class="px-4 py-2 whitespace-nowrap">{{ entry.ip }}</td>
                <td class="px-4 py-2 whitespace-nowrap">{{ entry.attempts }}</td>
                <td class="px-4 py-2 whitespace-nowrap">
                  {{ new Date(entry.last_attempt_at * 1000).toLocaleString() }}
                </td>
                <td class="px-4 py-2 whitespace-nowrap">
                  {{
                    entry.blocked_until
                      ? new Date(entry.blocked_until * 1000).toLocaleString()
                      : $t('statusMonitor.notAvailable')
                  }}
                </td>
                <td class="px-4 py-2 whitespace-nowrap">
                  <button
                    @click="handleDeleteIp(entry.ip)"
                    :disabled="blacklistDeleteLoading && blacklistToDeleteIp === entry.ip"
                    class="px-2 py-1 bg-error text-error-text rounded text-xs font-medium hover:bg-error/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                  >
                    {{
                      blacklistDeleteLoading && blacklistToDeleteIp === entry.ip
                        ? $t('settings.ipBlacklist.table.deleting')
                        : $t('settings.ipBlacklist.table.removeButton')
                    }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- Delete Error (Show regardless of loading state if present) -->
        <p v-if="blacklistDeleteError" class="mt-3 text-sm text-error">
          {{ blacklistDeleteError }}
        </p>
      </div>
      <!-- End v-if="ipBlacklistEnabled" -->
      <!-- Message when disabled -->
      <div
        v-else
        class="p-4 text-center text-text-secondary italic border border-dashed border-border/50 rounded-md"
      >
        {{ $t('settings.ipBlacklist.disabledMessage', 'IP 黑名单功能当前已禁用。') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useIpBlacklist } from '../../composables/settings/useIpBlacklist';

// const { t } = useI18n(); // $t is globally available in template

const {
  ipBlacklistEnabled,
  handleUpdateIpBlacklistEnabled,
  blacklistSettingsForm,
  // blacklistSettingsLoading, // Not used directly in template, handled by form submit button state
  blacklistSettingsMessage,
  blacklistSettingsSuccess,
  handleUpdateBlacklistSettings,
  ipBlacklist,
  blacklistToDeleteIp,
  blacklistDeleteLoading,
  blacklistDeleteError,
  handleDeleteIp,
} = useIpBlacklist();
</script>

<style scoped>
/* Styles specific to IpBlacklistSettings if any */
</style>
