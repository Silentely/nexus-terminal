<template>
  <div
    v-if="visible"
    ref="menuRef"
    class="fixed bg-background border border-border/50 shadow-xl rounded-lg py-1.5 z-50 min-w-[180px]"
    :style="{
      top: `${adjustedPosition.y}px`,
      left: `${adjustedPosition.x}px`,
    }"
    @click.stop
  >
    <ul class="list-none p-0 m-0">
      <li
        v-if="command"
        class="group px-4 py-1.5 cursor-pointer flex items-center text-foreground hover:bg-primary/10 hover:text-primary text-sm transition-colors duration-150 rounded-md mx-1"
        @click="$emit('action', 'sendToAllSessions', command!)"
      >
        <span>{{ t('quickCommands.actions.sendToAllSessions', '发送到全部会话') }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import type { QuickCommandFE } from '../stores/quickCommands.store';

const props = defineProps<{
  /** 是否显示菜单（v-model） */
  visible: boolean;
  /** 菜单位置 */
  position: { x: number; y: number };
  /** 右键点击的目标命令 */
  command: QuickCommandFE | null;
}>();

const emit = defineEmits<{
  /** 更新可见状态（v-model） */
  'update:visible': [value: boolean];
  /** 菜单动作 */
  action: [actionName: 'sendToAllSessions', command: QuickCommandFE];
}>();

const { t } = useI18n();
const menuRef = ref<HTMLDivElement | null>(null);

/** 边界检测后的位置 */
const adjustedPosition = ref({ x: 0, y: 0 });

/**
 * 计算菜单位置，确保不超出屏幕边界
 */
const adjustPosition = () => {
  const pos = props.position;
  let finalX = pos.x;
  let finalY = pos.y;

  if (menuRef.value) {
    const menuRect = menuRef.value.getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;

    // 调整水平位置
    if (finalX + menuWidth > window.innerWidth) {
      finalX = window.innerWidth - menuWidth - 5;
    }

    // 调整垂直位置
    if (finalY + menuHeight > window.innerHeight) {
      finalY = window.innerHeight - menuHeight - 5;
    }

    // 确保菜单不超出屏幕左上角
    finalX = Math.max(5, finalX);
    finalY = Math.max(5, finalY);
  }

  adjustedPosition.value = { x: finalX, y: finalY };
};

/** 全局点击关闭处理器 */
const handleGlobalClick = () => {
  close();
};

/** 关闭菜单 */
const close = () => {
  emit('update:visible', false);
  document.removeEventListener('click', handleGlobalClick);
};

// 监听可见状态变化，注册/注销全局点击关闭事件
watch(
  () => props.visible,
  async (newVisible) => {
    if (newVisible) {
      // 先设置初始位置
      adjustedPosition.value = { ...props.position };
      // 等待 DOM 渲染后进行边界检测
      await nextTick();
      adjustPosition();
      // 注册全局点击关闭（延迟注册避免当前右键事件立即触发关闭）
      await nextTick();
      document.addEventListener('click', handleGlobalClick, { once: true });
    } else {
      document.removeEventListener('click', handleGlobalClick);
    }
  },
);

// 监听位置变化，在菜单已显示时重新调整
watch(
  () => props.position,
  () => {
    if (props.visible) {
      adjustedPosition.value = { ...props.position };
      nextTick(() => adjustPosition());
    }
  },
  { deep: true },
);

// 组件卸载时清理事件监听
onBeforeUnmount(() => {
  document.removeEventListener('click', handleGlobalClick);
});
</script>
