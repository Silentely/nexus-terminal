<template>
  <div class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      Pollinations 自带账户（BYOP）
    </h2>
    <div class="p-6 space-y-6">
      <!-- 说明 -->
      <p class="text-sm text-muted-foreground">
        配置您自己的 Pollinations 账户后，AI 助手将优先使用您的 Pollen 额度进行自然语言生成命令。
        授权失败时会自动回退到默认 AI Provider。
      </p>

      <!-- 启用开关 -->
      <div>
        <div class="flex items-center">
          <input
            type="checkbox"
            id="enablePollinations"
            v-model="localEnabled"
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
          />
          <label
            for="enablePollinations"
            class="text-sm font-medium text-foreground cursor-pointer select-none"
          >
            启用 Pollinations（AI 助手优先使用我的账户）
          </label>
        </div>
      </div>

      <hr class="border-border/50" />

      <!-- App Key 配置 -->
      <div>
        <label class="text-sm font-medium text-foreground">App Key</label>
        <div class="relative mt-2">
          <input
            v-model="localAppKey"
            :type="showAppKey ? 'text' : 'password'"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground pr-10"
            placeholder="pk_..."
          />
          <button
            type="button"
            @click="showAppKey = !showAppKey"
            class="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <span v-if="showAppKey">🙈</span>
            <span v-else>👁️</span>
          </button>
        </div>
        <p class="text-xs text-muted-foreground mt-1">
          在
          <a
            href="https://enter.pollinations.ai"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary hover:underline"
            >enter.pollinations.ai</a
          >
          创建 App Key（以 pk_ 开头），将被安全加密存储。
        </p>
      </div>

      <!-- Models 配置 -->
      <div>
        <label class="text-sm font-medium text-foreground">允许的模型</label>
        <div class="mt-2 flex flex-wrap gap-3">
          <label
            v-for="model in availableModels"
            :key="model"
            class="inline-flex items-center cursor-pointer"
          >
            <input
              type="checkbox"
              :value="model"
              v-model="localModels"
              class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-1.5 cursor-pointer"
            />
            <span class="text-sm text-foreground">{{ model }}</span>
          </label>
        </div>
      </div>

      <!-- Budget 与 Expiry -->
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="text-sm font-medium text-foreground">预算上限（Pollen）</label>
          <input
            v-model.number="localBudget"
            type="number"
            min="0"
            step="1"
            class="w-full mt-2 px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label class="text-sm font-medium text-foreground">有效期（天）</label>
          <input
            v-model.number="localExpiryDays"
            type="number"
            min="1"
            step="1"
            class="w-full mt-2 px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <hr class="border-border/50" />

      <!-- 授权状态 -->
      <PollenAuthStatus :auth-status="store.authStatus" @authorize="handleAuthorize" />

      <!-- 错误提示 -->
      <div v-if="saveError" class="text-sm text-error">{{ saveError }}</div>

      <!-- 保存按钮 -->
      <div class="flex justify-end">
        <button
          type="button"
          @click="handleSave"
          :disabled="store.loading"
          class="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
        >
          {{ store.loading ? '保存中...' : '保存配置' }}
        </button>
      </div>
    </div>

    <!-- 授权流程模态框 -->
    <AuthFlowModal
      :visible="showAuthModal"
      :auth-config="authConfig"
      @close="showAuthModal = false"
      @success="handleAuthSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { usePollinationsStore } from '@/stores/pollinations.store';
import PollenAuthStatus from './PollenAuthStatus.vue';
import AuthFlowModal from './AuthFlowModal.vue';
import type { AuthStartRequest } from '@/types/pollinations.types';

const store = usePollinationsStore();

const availableModels = ['openai', 'claude', 'gemini', 'mistral', 'deepseek'];

const localAppKey = ref('');
const localModels = ref<string[]>(['openai', 'claude', 'gemini']);
const localBudget = ref(5);
const localExpiryDays = ref(7);
const localEnabled = ref(false);
const showAppKey = ref(false);
const showAuthModal = ref(false);
const saveError = ref<string | null>(null);

// 授权配置（传递给模态框）
const authConfig = computed<AuthStartRequest>(() => ({
  app_key: localAppKey.value,
  scope: 'usage,keys',
  models: localModels.value,
  budget: localBudget.value,
  expiry: localExpiryDays.value * 86400,
}));

// 加载配置
onMounted(async () => {
  await store.fetchSettings();
  // 如果已配置过 App Key，显示 masked 状态（用户无需重新输入）
  localAppKey.value = store.appKey;
  localModels.value = store.models.length ? store.models : ['openai', 'claude', 'gemini'];
  localBudget.value = store.budget;
  localExpiryDays.value = Math.ceil(store.expiry / 86400);
  localEnabled.value = store.isEnabled;
});

// 保存配置（如果 appKey 是 masked 格式（含 ...），说明未修改，不传给后端）
async function handleSave(): Promise<void> {
  saveError.value = null;
  // 仅当 appKey 未改动（masked 格式含 ...）时跳过校验
  const isNewAppKey = localAppKey.value && !localAppKey.value.includes('...');
  if (isNewAppKey) {
    if (!localAppKey.value.startsWith('pk_')) {
      saveError.value = 'App Key 格式无效，必须以 pk_ 开头';
      return;
    }
  } else if (!localAppKey.value && !store.appKey) {
    saveError.value = 'App Key 必填';
    return;
  }

  try {
    // 如果 appKey 是 masked 格式，说明未修改，不传给后端
    const isNewAppKey = localAppKey.value && !localAppKey.value.includes('...');
    await store.saveSettings({
      app_key: isNewAppKey ? localAppKey.value : undefined,
      scope: 'usage,keys',
      models: localModels.value,
      budget: localBudget.value,
      expiry: localExpiryDays.value * 86400,
      enabled: localEnabled.value,
    } as any); // app_key 可能为 undefined，表示保留现有值
  } catch {
    saveError.value = store.error;
  }
}

// 打开授权模态框（授权前强制保存配置）
async function handleAuthorize(): Promise<void> {
  saveError.value = null;
  // 授权时必须有真实 App Key（非 masked）
  if (!localAppKey.value || localAppKey.value.includes('...')) {
    saveError.value = '请先填写有效的 App Key（pk_ 开头）';
    return;
  }
  if (!localAppKey.value.startsWith('pk_')) {
    saveError.value = 'App Key 格式无效，必须以 pk_ 开头';
    return;
  }
  // 授权前先保存配置，确保数据库中的 App Key 是最新的
  await handleSave();
  if (store.error) {
    saveError.value = '保存配置失败，无法继续授权';
    return;
  }
  showAuthModal.value = true;
}

// 授权成功
async function handleAuthSuccess(): Promise<void> {
  showAuthModal.value = false;
  await store.fetchSettings();
  await store.refreshBalance().catch(() => {});
}
</script>
