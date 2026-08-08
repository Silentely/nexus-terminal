<script setup lang="ts">
/**
 * 统一错误横幅组件
 * 用于替代各 View 中散落的错误提示写法（border-l-4 border-error bg-error/10 ...），
 * 提供一致的视觉与无障碍体验。
 */
interface Props {
  /** 错误文案 */
  message: string;
  /** 紧凑模式：小内边距 + 小字号（用于局部区块） */
  compact?: boolean;
  /** 是否显示警示图标（默认显示） */
  showIcon?: boolean;
}

withDefaults(defineProps<Props>(), {
  compact: false,
  showIcon: true,
});
</script>

<template>
  <div
    class="error-banner flex items-start gap-2 border-l-4 border-error bg-error/10 text-error rounded"
    :class="compact ? 'p-2 text-xs' : 'p-4 text-sm'"
    role="alert"
  >
    <i v-if="showIcon" class="fas fa-exclamation-circle mt-0.5" aria-hidden="true"></i>
    <p class="flex-grow break-words">{{ message }}</p>
  </div>
</template>
