<script setup lang="ts">
/**
 * 统一空状态组件
 * 用于替代各 View 中散落的空状态写法，提供一致的图标 + 文案 + 可选操作按钮。
 */
interface Props {
  /** 空状态主文案 */
  text: string;
  /** 展示的 FontAwesome 图标类名，如 'fa-folder-open' */
  icon?: string;
  /** 操作按钮文案（可选） */
  actionText?: string;
  /** 是否显示为整页居中（默认局部区块） */
  full?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  icon: 'fa-inbox',
  actionText: '',
  full: false,
});

const emit = defineEmits(['action']);

const handleAction = () => {
  emit('action');
};
</script>

<template>
  <div
    class="empty-state flex flex-col items-center justify-center text-text-secondary"
    :class="[full ? 'h-full p-8' : 'p-6']"
  >
    <i class="fas text-2xl mb-3 opacity-70" :class="props.icon" aria-hidden="true"></i>
    <p class="text-sm text-center">{{ text }}</p>
    <button
      v-if="actionText"
      type="button"
      class="mt-4 px-4 py-2 bg-primary text-white border-none rounded-lg text-sm font-medium cursor-pointer shadow-md transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
      @click="handleAction"
    >
      {{ actionText }}
    </button>
  </div>
</template>
