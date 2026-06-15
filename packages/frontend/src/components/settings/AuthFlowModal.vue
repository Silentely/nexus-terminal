<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @click.self="handleClose"
  >
    <div
      class="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
    >
      <!-- 标题栏 -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-border">
        <h3 class="text-lg font-semibold text-foreground">授权 Pollinations</h3>
        <button
          type="button"
          @click="handleClose"
          class="text-muted-foreground hover:text-foreground cursor-pointer"
        >
          ✕
        </button>
      </div>

      <div class="p-6 space-y-4">
        <!-- 授权方式选择 -->
        <div v-if="step === 'selecting'">
          <p class="text-sm text-muted-foreground mb-4">请选择授权方式：</p>
          <div class="space-y-3">
            <button
              type="button"
              @click="handleWebAuth"
              class="w-full px-4 py-3 text-left border border-border rounded-md hover:bg-header/50 transition-colors cursor-pointer"
            >
              <div class="font-medium text-foreground">🌐 Web 授权（推荐）</div>
              <div class="text-xs text-muted-foreground mt-1">
                跳转到 Pollinations 授权页面，完成后自动返回
              </div>
            </button>
            <button
              type="button"
              @click="handleDeviceAuth"
              class="w-full px-4 py-3 text-left border border-border rounded-md hover:bg-header/50 transition-colors cursor-pointer"
            >
              <div class="font-medium text-foreground">📟 设备码授权</div>
              <div class="text-xs text-muted-foreground mt-1">
                适合无头/远程环境，手动输入设备码完成授权
              </div>
            </button>
          </div>
        </div>

        <!-- Web Redirect 流程 -->
        <div v-else-if="step === 'web_redirect'" class="space-y-4">
          <p class="text-sm text-foreground">点击下方按钮跳转到 Pollinations 完成授权：</p>
          <a
            :href="authUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="block w-full px-4 py-2.5 text-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            前往授权页面
          </a>
          <p class="text-xs text-muted-foreground">
            授权完成后，将返回的 api_key 粘贴到下方输入框：
          </p>
          <input
            v-model="callbackKey"
            type="text"
            placeholder="sk_..."
            class="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            @click="handleCallbackSubmit"
            :disabled="!callbackKey || submitting"
            class="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
          >
            {{ submitting ? '验证中...' : '完成授权' }}
          </button>
        </div>

        <!-- Device Code 流程 -->
        <div v-else-if="step === 'device_code'" class="space-y-4">
          <p class="text-sm text-foreground">请在浏览器中访问以下地址并输入设备码：</p>
          <div class="p-4 bg-header/50 rounded-md space-y-3">
            <div>
              <div class="text-xs text-muted-foreground mb-1">验证地址</div>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-sm text-foreground break-all">{{ verificationUri }}</code>
                <button
                  type="button"
                  @click="copyText(verificationUri)"
                  class="text-xs px-2 py-1 rounded border border-border hover:bg-background cursor-pointer"
                >
                  复制
                </button>
              </div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground mb-1">设备码</div>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xl font-mono font-bold text-primary tracking-wider">{{
                  userCode
                }}</code>
                <button
                  type="button"
                  @click="copyText(userCode)"
                  class="text-xs px-2 py-1 rounded border border-border hover:bg-background cursor-pointer"
                >
                  复制
                </button>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <span class="inline-block w-2 h-2 rounded-full bg-warning animate-pulse"></span>
            等待授权中...（自动检测）
          </div>
        </div>

        <!-- 授权成功 -->
        <div v-else-if="step === 'success'" class="text-center py-4">
          <div class="text-4xl mb-2">✅</div>
          <p class="text-foreground font-medium">授权成功！</p>
          <p class="text-sm text-muted-foreground mt-1">现在可以使用您的 Pollinations 账户了</p>
        </div>

        <!-- 授权失败 -->
        <div v-else-if="step === 'error'" class="text-center py-4">
          <div class="text-4xl mb-2">⚠️</div>
          <p class="text-error font-medium">授权失败</p>
          <p class="text-sm text-muted-foreground mt-1">{{ errorMessage }}</p>
          <button
            type="button"
            @click="step = 'selecting'"
            class="mt-3 px-4 py-2 rounded-md border border-border hover:bg-header/50 cursor-pointer"
          >
            重新授权
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { usePollinationsStore } from '@/stores/pollinations.store';
import type { AuthStartRequest } from '@/types/pollinations.types';

type AuthStep = 'selecting' | 'web_redirect' | 'device_code' | 'success' | 'error';

const props = defineProps<{
  visible: boolean;
  authConfig: AuthStartRequest;
}>();

const emit = defineEmits<{
  close: [];
  success: [];
}>();

const store = usePollinationsStore();

const step = ref<AuthStep>('selecting');
const authUrl = ref('');
const callbackKey = ref('');
const submitting = ref(false);
const verificationUri = ref('');
const userCode = ref('');
const errorMessage = ref('');

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollStartTime: number | null = null;
const MAX_POLL_DURATION = 15 * 60 * 1000; // 15 分钟（与 Device Code 过期时间对齐）

// 启动 Web Redirect 授权
async function handleWebAuth(): Promise<void> {
  try {
    const config: AuthStartRequest = {
      ...props.authConfig,
      redirect_uri: window.location.origin,
    };
    authUrl.value = await store.startWebAuth(config);
    step.value = 'web_redirect';
  } catch {
    errorMessage.value = store.error || '启动授权失败';
    step.value = 'error';
  }
}

// 提交 Web Redirect 回调的 api_key
async function handleCallbackSubmit(): Promise<void> {
  if (!callbackKey.value) return;
  submitting.value = true;
  try {
    await store.handleCallback(callbackKey.value);
    step.value = 'success';
    setTimeout(() => emit('success'), 1500);
  } catch {
    errorMessage.value = store.error || '授权失败';
    step.value = 'error';
  } finally {
    submitting.value = false;
  }
}

// 启动 Device Code 授权
async function handleDeviceAuth(): Promise<void> {
  try {
    const response = await store.startDeviceAuth(props.authConfig);
    verificationUri.value = response.verification_uri;
    userCode.value = response.user_code;
    step.value = 'device_code';
    startPolling(response.device_code, response.interval || 5);
  } catch {
    errorMessage.value = store.error || '启动设备授权失败';
    step.value = 'error';
  }
}

// 轮询授权状态
function startPolling(deviceCode: string, interval: number): void {
  stopPolling();
  pollStartTime = Date.now();
  pollTimer = setInterval(async () => {
    // 检查是否超时
    if (pollStartTime && Date.now() - pollStartTime > MAX_POLL_DURATION) {
      stopPolling();
      errorMessage.value = '授权超时（15 分钟），请重新发起授权流程';
      step.value = 'error';
      return;
    }
    try {
      const result = await store.pollDeviceAuth(deviceCode);
      if (result.status === 'authorized') {
        stopPolling();
        step.value = 'success';
        setTimeout(() => emit('success'), 1500);
      } else if (result.status === 'denied' || result.status === 'expired') {
        stopPolling();
        errorMessage.value = result.status === 'denied' ? '用户拒绝授权' : '授权码已过期';
        step.value = 'error';
      }
    } catch {
      stopPolling();
      errorMessage.value = '轮询授权状态失败';
      step.value = 'error';
    }
  }, interval * 1000);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pollStartTime = null;
}

// 复制文本到剪贴板
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 剪贴板 API 不可用时静默失败
  }
}

// 关闭模态框
function handleClose(): void {
  stopPolling();
  step.value = 'selecting';
  callbackKey.value = '';
  emit('close');
}

onUnmounted(() => {
  stopPolling();
});
</script>
