<script setup lang="ts">
import { computed, PropType } from 'vue';
import { useI18n } from 'vue-i18n';

interface MenuItem {
  label: string;
  action: string;
  disabled?: boolean; // 可选：是否禁用
  isSeparator?: boolean; // 可选：是否是分隔线
  isDanger?: boolean; // 可选：是否是危险操作 (例如红色文本)
}

const props = defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
  position: {
    type: Object as PropType<{ x: number; y: number }>,
    required: true,
  },
  items: {
    type: Array as PropType<MenuItem[]>,
    required: true,
  },
  // + Add targetId prop
  targetId: {
    type: [String, Number, null] as PropType<string | number | null>,
    default: null,
  },
});

const emit = defineEmits<{
  // + Update signature to include targetId
  (e: 'menu-action', payload: { action: string; targetId: string | number | null }): void;
  (e: 'close'): void; // 请求关闭菜单
}>();

const { t } = useI18n();

const menuStyle = computed(() => ({
  top: `${props.position.y}px`,
  left: `${props.position.x}px`,
}));

const handleAction = (item: MenuItem) => {
  console.log(`[ContextMenu] handleAction called for item:`, JSON.stringify(item)); // + Log item
  if (!item.disabled && !item.isSeparator) {
    console.log(`[ContextMenu] Inside handleAction, props.targetId is:`, props.targetId); // ++ Log prop value before emit
    const payload = { action: item.action, targetId: props.targetId };
    console.log(`[ContextMenu] Emitting menu-action with payload:`, JSON.stringify(payload)); // + Log emit payload
    emit('menu-action', payload);
    emit('close'); // 点击后自动关闭
  }
};

// 点击菜单外部时，也应该关闭，这通常在父组件中处理 document click listener
// 但这里也添加一个遮罩层点击关闭
const handleOverlayClick = () => {
  emit('close');
};
</script>

<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-40"
    @click.self="handleOverlayClick"
    @contextmenu.prevent
  >
    <div
      class="fixed bg-background border border-border/50 shadow-xl rounded-lg py-1.5 z-50 min-w-[180px]"
      :style="menuStyle"
      @click.stop
    >
      <ul class="list-none p-0 m-0">
        <template v-for="(item, index) in items" :key="index">
          <li v-if="item.isSeparator" class="border-t border-border/50 my-1 mx-1"></li>
          <li
            v-else
            class="group px-4 py-1.5 flex items-center text-sm transition-colors duration-150 rounded-md mx-1"
            :class="[
              item.disabled
                ? 'text-text-secondary opacity-50 cursor-not-allowed'
                : item.isDanger
                  ? 'text-error hover:bg-error/10 cursor-pointer'
                  : 'text-foreground hover:bg-primary/10 hover:text-primary cursor-pointer',
            ]"
            @click="handleAction(item)"
          >
            <!-- 移除了图标 -->
            <span>{{ t(item.label, item.label) }}</span>
            <!-- 使用 i18n -->
          </li>
        </template>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* 可以添加一些额外的样式，如果需要的话 */
</style>
