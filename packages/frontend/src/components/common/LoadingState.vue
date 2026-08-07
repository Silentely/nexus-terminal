<script setup lang="ts">
/**
 * 统一加载状态组件
 * 用于替代各 View 中散落的加载态写法（纯文本 / 手写 spinner / italic），
 * 提供一致的视觉与无障碍体验。
 */
import { useI18n } from 'vue-i18n';

interface Props {
  /** 加载提示文案，缺省使用 common.loading */
  text?: string;
  /** 紧凑模式：仅小号 spinner + 文本（用于局部区块） */
  compact?: boolean;
  /** 垂直居中整页模式 */
  full?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  text: '',
  compact: false,
  full: false,
});

const { t } = useI18n();

const displayText = computed(() => props.text || t('common.loading'));
</script>

<template>
  <div
    class="loading-state flex flex-col items-center justify-center text-text-secondary"
    :class="[compact ? 'p-3 text-xs' : 'p-6 text-sm', full ? 'h-full' : '']"
    role="status"
    aria-live="polite"
  >
    <i
      class="fas fa-spinner fa-spin"
      :class="compact ? 'text-base mb-1.5' : 'text-xl mb-2'"
      aria-hidden="true"
    ></i>
    <p>{{ displayText }}</p>
    <span class="sr-only">{{ displayText }}</span>
  </div>
</template>
