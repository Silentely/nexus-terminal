<template>
  <!-- Page Container with Subtle Dot Background -->
  <div
    class="flex items-center justify-center min-h-screen bg-background p-4 bg-[radial-gradient(theme(colors.border)_1px,transparent_1px)] bg-[size:16px_16px]"
  >
    <!-- Setup Card -->
    <div
      class="flex w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden bg-background border border-border/20"
    >
      <!-- Left Panel (Brand) - Hidden on small screens -->
      <div
        class="hidden md:flex w-2/5 bg-gradient-to-br from-primary to-primary-dark flex-col items-center justify-center p-10 text-white relative"
      >
        <!-- Subtle pattern or overlay could go here -->
        <div class="z-10 text-center">
          <img src="../assets/logo.png" alt="Project Logo" class="h-20 w-auto mb-5 mx-auto" />
          <h1 class="text-3xl font-bold mb-2">{{ $t('projectName') }}</h1>
          <p class="text-base opacity-80">{{ $t('setup.description') }}</p>
          <!-- Moved description here -->
        </div>
      </div>

      <!-- Right Panel (Setup Form) -->
      <div class="w-full md:w-3/5 flex flex-col justify-center p-8 sm:p-12">
        <!-- Mobile Logo & Title (optional) -->
        <div class="flex flex-col items-center mb-6 md:hidden">
          <img src="../assets/logo.png" alt="Project Logo" class="h-16 w-auto mb-3" />
          <h2 class="text-xl font-semibold text-foreground">{{ $t('setup.title') }}</h2>
          <p class="text-sm text-text-secondary mt-1">{{ $t('setup.description') }}</p>
        </div>
        <!-- Desktop Title (Subtle) -->
        <h2 class="text-2xl font-semibold mb-6 text-center text-foreground hidden md:block">
          {{ $t('setup.title') }}
        </h2>

        <form @submit.prevent="handleSetup" class="space-y-5">
          <!-- Reduced space slightly -->
          <div>
            <label for="username" class="block text-sm font-medium text-text-secondary mb-1">{{
              $t('setup.username')
            }}</label>
            <input
              id="username"
              v-model="username"
              name="username"
              type="text"
              required
              :disabled="isLoading"
              :placeholder="$t('setup.usernamePlaceholder')"
              class="w-full px-4 py-3 border border-border/50 rounded-lg bg-input text-foreground text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition duration-150 ease-in-out disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label for="password" class="block text-sm font-medium text-text-secondary mb-1">{{
              $t('setup.password')
            }}</label>
            <input
              id="password"
              v-model="password"
              name="password"
              type="password"
              required
              :disabled="isLoading"
              :placeholder="$t('setup.passwordPlaceholder')"
              class="w-full px-4 py-3 border border-border/50 rounded-lg bg-input text-foreground text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition duration-150 ease-in-out disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label
              for="confirmPassword"
              class="block text-sm font-medium text-text-secondary mb-1"
              >{{ $t('setup.confirmPassword') }}</label
            >
            <input
              id="confirmPassword"
              v-model="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              :disabled="isLoading"
              :placeholder="$t('setup.confirmPasswordPlaceholder')"
              class="w-full px-4 py-3 border border-border/50 rounded-lg bg-input text-foreground text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition duration-150 ease-in-out disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
          </div>

          <div
            v-if="error"
            class="text-error bg-error/10 border border-error/20 px-4 py-2 rounded text-center text-sm"
          >
            <!-- Adjusted padding -->
            {{ error }}
          </div>
          <div
            v-if="successMessage"
            class="text-success bg-success/10 border border-success/20 px-4 py-2 rounded text-center text-sm"
          >
            <!-- Adjusted padding -->
            {{ successMessage }}
          </div>

          <button
            type="submit"
            :disabled="isLoading"
            class="w-full py-3 px-4 bg-primary text-white border-none rounded-lg text-base font-semibold cursor-pointer shadow-md transition-colors duration-200 ease-in-out hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:bg-gray-400 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <span v-if="isLoading">{{ $t('setup.settingUp') }}</span>
            <span v-else>{{ $t('setup.submitButton') }}</span>
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import apiClient from '../utils/apiClient'; // 使用统一的 apiClient
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth.store'; // *** 导入 Auth Store ***

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore(); // *** 获取 Auth Store 实例 ***

const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const isLoading = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const handleSetup = async () => {
  error.value = null;
  successMessage.value = null;

  if (password.value !== confirmPassword.value) {
    error.value = t('setup.error.passwordsDoNotMatch');
    return;
  }

  if (!username.value || !password.value) {
    error.value = t('setup.error.fieldsRequired');
    return;
  }

  isLoading.value = true;

  try {
    // 确保调用正确的后端 API 端点
    await apiClient.post('/auth/setup', {
      // 使用 apiClient 并移除 base URL
      username: username.value,
      password: password.value,
      confirmPassword: confirmPassword.value,
    });
    successMessage.value = t('setup.success');
    // *** 手动更新 needsSetup 状态 ***
    authStore.needsSetup = false;
    // *** 重置认证状态，因为设置完成后需要重新登录 ***
    authStore.isAuthenticated = false;
    authStore.user = null;
    // 禁用表单或按钮，防止重复提交
    isLoading.value = true; // Keep loading state to disable button
    // Redirect to login immediately after showing success message (removed setTimeout)
    // The success message will be briefly visible before navigation.
    router.push('/login');
  } catch (err: any) {
    console.error('Setup failed:', err);
    if (err.response?.data?.message) {
      // 尝试从后端响应中获取更具体的错误信息
      error.value = err.response.data.message;
    } else if (err.message) {
      error.value = err.message;
    } else {
      error.value = t('setup.error.generic');
    }
    isLoading.value = false; // Re-enable button on error
  }
  // Removed finally block setting isLoading to false on success to keep button disabled
};
</script>

<!-- Copied styles from LoginView.vue -->
