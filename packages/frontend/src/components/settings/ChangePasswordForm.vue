<template>
  <div class="settings-section-content">
    <h3 class="text-base font-semibold text-foreground mb-3">
      {{ $t('settings.changePassword.title') }}
    </h3>
    <form @submit.prevent="handleChangePassword" class="space-y-4">
      <div>
        <label for="currentPassword" class="block text-sm font-medium text-text-secondary mb-1">{{
          $t('settings.changePassword.currentPassword')
        }}</label>
        <input
          type="password"
          id="currentPassword"
          v-model="currentPassword"
          required
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>
      <div>
        <label for="newPassword" class="block text-sm font-medium text-text-secondary mb-1">{{
          $t('settings.changePassword.newPassword')
        }}</label>
        <input
          type="password"
          id="newPassword"
          v-model="newPassword"
          required
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>
      <div>
        <label for="confirmPassword" class="block text-sm font-medium text-text-secondary mb-1">{{
          $t('settings.changePassword.confirmPassword')
        }}</label>
        <input
          type="password"
          id="confirmPassword"
          v-model="confirmPassword"
          required
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>
      <div class="flex items-center justify-between">
        <button
          type="submit"
          :disabled="changePasswordLoading"
          class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
        >
          {{ changePasswordLoading ? $t('common.loading') : $t('settings.changePassword.submit') }}
        </button>
        <p
          v-if="changePasswordMessage"
          :class="['text-sm', changePasswordSuccess ? 'text-success' : 'text-error']"
        >
          {{ changePasswordMessage }}
        </p>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useChangePassword } from '../../composables/settings/useChangePassword';

// useI18n 的 $t 在模板中是全局可用的，如果 script 中需要 t 函数，则解构: const { t } = useI18n();
// 当前模板直接使用 $t，所以这里可以不显式解构 t，除非 script 内部逻辑也需要。

const {
  currentPassword,
  newPassword,
  confirmPassword,
  changePasswordLoading,
  changePasswordMessage,
  changePasswordSuccess,
  handleChangePassword,
} = useChangePassword();
</script>

<style scoped>
/* 根据需要添加特定于此组件的样式，或者依赖全局 Tailwind CSS */
</style>
