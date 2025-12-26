<template>
  <div class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      AI 助手配置
    </h2>
    <div class="p-6 space-y-6">
      <!-- 启用开关 -->
      <div class="flex items-center justify-between">
        <div>
          <label class="text-sm font-medium text-foreground">启用 AI 助手</label>
          <p class="text-xs text-muted-foreground mt-1">
            启用后可在终端使用 Ctrl+I 快捷键调用 AI 生成命令
          </p>
        </div>
        <el-switch v-model="localSettings.enabled" />
      </div>

      <hr class="border-border/50" />

      <!-- Provider 选择 -->
      <div>
        <label class="text-sm font-medium text-foreground">AI Provider</label>
        <el-select
          v-model="localSettings.provider"
          class="w-full mt-2"
          @change="handleProviderChange"
        >
          <el-option label="OpenAI" value="openai" />
          <el-option label="Google Gemini" value="gemini" />
          <el-option label="Anthropic Claude" value="claude" />
        </el-select>
      </div>

      <!-- OpenAI Endpoint 选择（仅 OpenAI 可见） -->
      <div v-if="localSettings.provider === 'openai'">
        <label class="text-sm font-medium text-foreground">OpenAI API Endpoint</label>
        <el-select v-model="localSettings.openaiEndpoint" class="w-full mt-2">
          <el-option label="Chat Completions (/v1/chat/completions)" value="chat/completions" />
          <el-option label="Responses (/v1/responses)" value="responses" />
        </el-select>
        <p class="text-xs text-muted-foreground mt-1">选择使用的 OpenAI API 端点类型</p>
      </div>

      <!-- Base URL -->
      <div>
        <label class="text-sm font-medium text-foreground">Base URL</label>
        <el-input
          v-model="localSettings.baseUrl"
          class="mt-2"
          placeholder="https://api.openai.com"
        />
        <p class="text-xs text-muted-foreground mt-1">
          {{ getBaseUrlPlaceholder() }}
        </p>
      </div>

      <!-- API Key -->
      <div>
        <label class="text-sm font-medium text-foreground">API Key</label>
        <el-input
          v-model="localSettings.apiKey"
          type="password"
          class="mt-2"
          placeholder="sk-..."
          show-password
        />
        <p class="text-xs text-muted-foreground mt-1">您的 API Key 将被安全加密存储</p>
      </div>

      <!-- Model -->
      <div>
        <label class="text-sm font-medium text-foreground">模型</label>
        <el-input v-model="localSettings.model" class="mt-2" :placeholder="getModelPlaceholder()" />
        <p class="text-xs text-muted-foreground mt-1">
          {{ getModelHint() }}
        </p>
      </div>

      <hr class="border-border/50" />

      <!-- 速率限制开关 -->
      <div class="flex items-center justify-between">
        <div>
          <label class="text-sm font-medium text-foreground">启用速率限制</label>
          <p class="text-xs text-muted-foreground mt-1">
            限制每分钟最多 10 次请求，防止 API 配额快速耗尽
          </p>
        </div>
        <el-switch v-model="localSettings.rateLimitEnabled" />
      </div>

      <!-- 操作按钮 -->
      <div class="flex items-center space-x-3 pt-4">
        <el-button type="primary" @click="handleSave" :loading="aiSettingsStore.isLoading">
          保存配置
        </el-button>
        <el-button @click="handleTest" :loading="aiSettingsStore.isTesting"> 测试连接 </el-button>
        <el-button @click="handleReset" :disabled="aiSettingsStore.isLoading"> 重置 </el-button>
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
import { ElMessage } from 'element-plus';
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

// 初始化：加载配置
onMounted(async () => {
  try {
    await aiSettingsStore.loadSettings();
    localSettings.value = { ...aiSettingsStore.settings };
  } catch (error) {
    ElMessage.error('加载 AI 配置失败');
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
      ElMessage.warning('请填写完整的配置信息');
      return;
    }

    if (localSettings.value.enabled && !localSettings.value.apiKey) {
      ElMessage.warning('启用 AI 助手需要填写 API Key');
      return;
    }

    await aiSettingsStore.saveSettings(localSettings.value);
    ElMessage.success('AI 配置已保存');
  } catch (error) {
    ElMessage.error('保存 AI 配置失败');
  }
}

// 测试连接
async function handleTest() {
  try {
    // 验证必填项
    if (!localSettings.value.baseUrl || !localSettings.value.apiKey || !localSettings.value.model) {
      ElMessage.warning('请填写完整的配置信息');
      return;
    }

    const success = await aiSettingsStore.testConnection(localSettings.value);
    if (success) {
      ElMessage.success('连接测试成功！AI 服务可用');
    } else {
      ElMessage.error('连接测试失败，请检查配置');
    }
  } catch (error) {
    ElMessage.error('测试连接时发生错误');
  }
}

// 重置配置
function handleReset() {
  localSettings.value = { ...aiSettingsStore.settings };
  ElMessage.info('已恢复为上次保存的配置');
}
</script>

<style scoped>
code {
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}
</style>
