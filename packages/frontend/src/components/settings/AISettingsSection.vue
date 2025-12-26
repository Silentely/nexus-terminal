<template>
  <div class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      AI 助手配置
    </h2>
    <div class="p-6 space-y-6">
      <!-- 启用开关 -->
      <div>
        <div class="flex items-center">
          <input
            type="checkbox"
            id="enableAI"
            v-model="localSettings.enabled"
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
          />
          <label
            for="enableAI"
            class="text-sm font-medium text-foreground cursor-pointer select-none"
          >
            启用 AI 助手
          </label>
        </div>
        <p class="text-xs text-muted-foreground mt-1 ml-6">
          启用后可在终端使用 Ctrl+I 快捷键调用 AI 生成命令
        </p>
      </div>

      <hr class="border-border/50" />

      <!-- Provider 选择 -->
      <div>
        <label class="text-sm font-medium text-foreground">AI Provider</label>
        <div class="relative mt-2">
          <select
            v-model="localSettings.provider"
            @change="handleProviderChange"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
            style="
              background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
              background-position: right 0.75rem center;
              background-size: 16px 12px;
            "
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
            <option value="claude">Anthropic Claude</option>
          </select>
        </div>
      </div>

      <!-- OpenAI Endpoint 选择（仅 OpenAI 可见） -->
      <div v-if="localSettings.provider === 'openai'">
        <label class="text-sm font-medium text-foreground">OpenAI API Endpoint</label>
        <div class="relative mt-2">
          <select
            v-model="localSettings.openaiEndpoint"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
            style="
              background-image: url(&quot;data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%236c757d' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e&quot;);
              background-position: right 0.75rem center;
              background-size: 16px 12px;
            "
          >
            <option value="chat/completions">Chat Completions (/v1/chat/completions)</option>
            <option value="responses">Responses (/v1/responses)</option>
          </select>
        </div>
        <p class="text-xs text-muted-foreground mt-1">选择使用的 OpenAI API 端点类型</p>
      </div>

      <!-- Base URL -->
      <div>
        <label class="text-sm font-medium text-foreground">Base URL</label>
        <input
          v-model="localSettings.baseUrl"
          class="w-full mt-2 px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground"
          placeholder="https://api.openai.com"
        />
        <p class="text-xs text-muted-foreground mt-1">
          {{ getBaseUrlPlaceholder() }}
        </p>
      </div>

      <!-- API Key -->
      <div>
        <label class="text-sm font-medium text-foreground">API Key</label>
        <div class="relative mt-2">
          <input
            v-model="localSettings.apiKey"
            :type="showPassword ? 'text' : 'password'"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground pr-10"
            placeholder="sk-..."
          />
          <button
            type="button"
            @click="showPassword = !showPassword"
            class="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <span v-if="showPassword">🙈</span>
            <span v-else>👁️</span>
          </button>
        </div>
        <p
          v-if="localSettings.apiKey && localSettings.apiKey.includes('...')"
          class="text-xs text-warning mt-1"
        >
          为确保安全，已保存的 Key 仅显示部分内容。如需修改请直接输入新 Key。
        </p>
        <p v-else class="text-xs text-muted-foreground mt-1">您的 API Key 将被安全加密存储</p>
      </div>

      <!-- Model -->
      <div>
        <label class="text-sm font-medium text-foreground">模型</label>
        <input
          v-model="localSettings.model"
          class="w-full mt-2 px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground"
          :placeholder="getModelPlaceholder()"
        />
        <p class="text-xs text-muted-foreground mt-1">
          {{ getModelHint() }}
        </p>
      </div>

      <hr class="border-border/50" />

      <!-- 速率限制开关 -->
      <div>
        <div class="flex items-center">
          <input
            type="checkbox"
            id="rateLimit"
            v-model="localSettings.rateLimitEnabled"
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
          />
          <label
            for="rateLimit"
            class="text-sm font-medium text-foreground cursor-pointer select-none"
          >
            启用速率限制
          </label>
        </div>
        <p class="text-xs text-muted-foreground mt-1 ml-6">
          限制每分钟最多 10 次请求，防止 API 配额快速耗尽
        </p>
      </div>

      <!-- 操作按钮 -->
      <div class="flex items-center justify-between pt-4">
        <div class="flex items-center space-x-3">
          <button
            type="button"
            @click="handleSave"
            :disabled="aiSettingsStore.isLoading"
            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ aiSettingsStore.isLoading ? '保存中...' : '保存配置' }}
          </button>

          <button
            type="button"
            @click="handleTest"
            :disabled="aiSettingsStore.isTesting"
            class="px-4 py-2 bg-background border border-border text-foreground rounded-md shadow-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ aiSettingsStore.isTesting ? '测试中...' : '测试连接' }}
          </button>

          <button
            type="button"
            @click="handleReset"
            :disabled="aiSettingsStore.isLoading"
            class="px-4 py-2 bg-background border border-border text-foreground rounded-md shadow-sm hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            重置
          </button>
        </div>

        <!-- 消息提示 -->
        <p
          v-if="statusMessage"
          :class="[
            'text-sm transition-opacity duration-300',
            statusSuccess ? 'text-success' : 'text-error',
          ]"
        >
          {{ statusMessage }}
        </p>
      </div>

      <!-- 提示信息 -->
      <div class="mt-4 p-4 bg-info/10 border border-info/30 rounded-md">
        <p class="text-sm text-foreground">
          <strong>使用说明：</strong>
        </p>
        <ul class="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
          <li>
            配置完成后，在终端界面按 <code class="px-1 py-0.5 bg-muted rounded">Ctrl+I</code> 唤起
            AI 助手
          </li>
          <li>输入自然语言描述（如"查找大于100M的文件"），AI 将生成对应命令</li>
          <li>生成的命令会自动填入终端输入行，您可以审核后再执行</li>
          <li>危险命令会有警告提示，请务必仔细检查后再执行</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useAISettingsStore } from '../../stores/aiSettings.store';
import type { AISettings } from '../../types/nl2cmd.types';

const aiSettingsStore = useAISettingsStore();

// 本地设置（用于编辑）
const localSettings = ref<AISettings>({
  enabled: false,
  provider: 'openai',
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-4o-mini',
  openaiEndpoint: 'chat/completions',
  rateLimitEnabled: true,
});

const showPassword = ref(false);
const statusMessage = ref('');
const statusSuccess = ref(false);

// 设置状态消息并自动清除
function setStatus(message: string, isSuccess: boolean) {
  statusMessage.value = message;
  statusSuccess.value = isSuccess;
  setTimeout(() => {
    statusMessage.value = '';
  }, 5000);
}

// 初始化：加载配置
onMounted(async () => {
  try {
    await aiSettingsStore.loadSettings();
    localSettings.value = { ...aiSettingsStore.settings };
  } catch (error) {
    setStatus('加载 AI 配置失败', false);
  }
});

// 监听 store 变化，同步到本地
watch(
  () => aiSettingsStore.settings,
  (newSettings) => {
    localSettings.value = { ...newSettings };
  },
  { deep: true }
);

// Provider 切换时更新默认值
function handleProviderChange() {
  switch (localSettings.value.provider) {
    case 'openai':
      localSettings.value.baseUrl = 'https://api.openai.com';
      localSettings.value.model = 'gpt-4o-mini';
      localSettings.value.openaiEndpoint = 'chat/completions';
      break;
    case 'gemini':
      localSettings.value.baseUrl = 'https://generativelanguage.googleapis.com';
      localSettings.value.model = 'gemini-2.0-flash';
      delete localSettings.value.openaiEndpoint;
      break;
    case 'claude':
      localSettings.value.baseUrl = 'https://api.anthropic.com';
      localSettings.value.model = 'claude-3-5-haiku-20241022';
      delete localSettings.value.openaiEndpoint;
      break;
  }
}

// 获取 Base URL 占位符
function getBaseUrlPlaceholder(): string {
  switch (localSettings.value.provider) {
    case 'openai':
      return 'OpenAI API 地址，默认为 https://api.openai.com';
    case 'gemini':
      return 'Gemini API 地址，默认为 https://generativelanguage.googleapis.com';
    case 'claude':
      return 'Claude API 地址，默认为 https://api.anthropic.com';
    default:
      return '';
  }
}

// 获取模型占位符
function getModelPlaceholder(): string {
  switch (localSettings.value.provider) {
    case 'openai':
      return 'gpt-4o-mini, gpt-4o, gpt-4-turbo 等';
    case 'gemini':
      return 'gemini-2.0-flash, gemini-1.5-pro 等';
    case 'claude':
      return 'claude-sonnet-4, claude-3-5-haiku-20241022 等';
    default:
      return '';
  }
}

// 获取模型提示
function getModelHint(): string {
  switch (localSettings.value.provider) {
    case 'openai':
      return '推荐使用 gpt-4o-mini（经济高效）或 gpt-4o';
    case 'gemini':
      return '推荐使用 gemini-2.0-flash';
    case 'claude':
      return '推荐使用 claude-3-5-haiku-20241022（速度快且经济）';
    default:
      return '';
  }
}

// 保存配置
async function handleSave() {
  try {
    // 验证必填项
    if (!localSettings.value.baseUrl || !localSettings.value.model) {
      setStatus('请填写完整的配置信息', false);
      return;
    }

    if (localSettings.value.enabled && !localSettings.value.apiKey) {
      setStatus('启用 AI 助手需要填写 API Key', false);
      return;
    }

    await aiSettingsStore.saveSettings(localSettings.value);
    setStatus('AI 配置已保存', true);
  } catch (error) {
    setStatus('保存 AI 配置失败', false);
  }
}

// 测试连接
async function handleTest() {
  try {
    // 验证必填项
    if (!localSettings.value.baseUrl || !localSettings.value.apiKey || !localSettings.value.model) {
      setStatus('请填写完整的配置信息', false);
      return;
    }

    const success = await aiSettingsStore.testConnection(localSettings.value);
    if (success) {
      setStatus('连接测试成功！AI 服务可用', true);
    } else {
      setStatus('连接测试失败，请检查配置', false);
    }
  } catch (error) {
    setStatus('测试连接时发生错误', false);
  }
}

// 重置配置
function handleReset() {
  localSettings.value = { ...aiSettingsStore.settings };
  setStatus('已恢复为上次保存的配置', true);
}
</script>

<style scoped>
code {
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}
</style>
