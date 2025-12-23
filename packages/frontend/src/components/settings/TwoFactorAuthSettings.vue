<template>
  <div class="settings-section-content">
    <h3 class="text-base font-semibold text-foreground mb-3">
      {{ $t('settings.twoFactor.title') }}
    </h3>
    <div v-if="twoFactorEnabled">
      <p class="p-3 mb-3 border-l-4 border-success bg-success/10 text-success text-sm rounded">
        {{ $t('settings.twoFactor.status.enabled') }}
      </p>
      <form @submit.prevent="handleDisable2FA" class="space-y-4">
        <div>
          <label for="disablePassword" class="block text-sm font-medium text-text-secondary mb-1">{{
            $t('settings.twoFactor.disable.passwordPrompt')
          }}</label>
          <input
            type="password"
            id="disablePassword"
            v-model="disablePassword"
            required
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        <div class="flex items-center justify-between">
          <button
            type="submit"
            :disabled="twoFactorLoading"
            class="px-4 py-2 bg-error text-error-text rounded-md shadow-sm hover:bg-error/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
          >
            {{ twoFactorLoading ? $t('common.loading') : $t('settings.twoFactor.disable.button') }}
          </button>
        </div>
      </form>
    </div>
    <div v-else>
      <p class="text-sm text-text-secondary mb-4">{{ $t('settings.twoFactor.status.disabled') }}</p>
      <button
        v-if="!isSettingUp2FA"
        @click="handleSetup2FA"
        :disabled="twoFactorLoading"
        class="px-4 py-2 bg-success text-success-text rounded-md shadow-sm hover:bg-success/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
      >
        {{ twoFactorLoading ? $t('common.loading') : $t('settings.twoFactor.enable.button') }}
      </button>
      <div
        v-if="isSettingUp2FA && setupData"
        class="mt-4 space-y-4 p-4 border border-border rounded-md bg-header/30"
      >
        <p class="text-sm text-text-secondary">{{ $t('settings.twoFactor.setup.scanQrCode') }}</p>
        <img
          :src="setupData.qrCodeUrl"
          alt="QR Code"
          class="block mx-auto max-w-[180px] border border-border p-1 bg-white rounded"
        />
        <p class="text-sm text-text-secondary">
          {{ $t('settings.twoFactor.setup.orEnterSecret') }}
          <code class="bg-header/50 p-1 px-2 border border-border/50 rounded font-mono text-sm">{{
            setupData.secret
          }}</code>
        </p>
        <form @submit.prevent="handleVerifyAndActivate2FA" class="space-y-4">
          <div>
            <label
              for="verificationCode"
              class="block text-sm font-medium text-text-secondary mb-1"
              >{{ $t('settings.twoFactor.setup.enterCode') }}</label
            >
            <input
              type="text"
              id="verificationCode"
              v-model="verificationCode"
              required
              pattern="\d{6}"
              title="请输入 6 位数字验证码"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
          <div class="flex items-center space-x-3">
            <button
              type="submit"
              :disabled="twoFactorLoading"
              class="px-4 py-2 bg-success text-success-text rounded-md shadow-sm hover:bg-success/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
            >
              {{
                twoFactorLoading
                  ? $t('common.loading')
                  : $t('settings.twoFactor.setup.verifyButton')
              }}
            </button>
            <button
              type="button"
              @click="cancelSetup"
              :disabled="twoFactorLoading"
              class="px-4 py-2 bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ $t('common.cancel') }}
            </button>
          </div>
        </form>
      </div>
    </div>
    <p
      v-if="twoFactorMessage"
      :class="['mt-3 text-sm', twoFactorSuccess ? 'text-success' : 'text-error']"
    >
      {{ twoFactorMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useTwoFactorAuth } from '../../composables/settings/useTwoFactorAuth';

// const { t } = useI18n(); // $t is globally available in template

const {
  twoFactorEnabled,
  twoFactorLoading,
  twoFactorMessage,
  twoFactorSuccess,
  setupData,
  verificationCode,
  disablePassword,
  isSettingUp2FA,
  handleSetup2FA,
  handleVerifyAndActivate2FA,
  handleDisable2FA,
  cancelSetup,
} = useTwoFactorAuth();

// onMounted hook to check status is handled within useTwoFactorAuth composable
</script>

<style scoped>
/* Styles specific to TwoFactorAuthSettings if any */
</style>
