/** * 连接右键菜单组件 * * 从 WorkspaceConnectionList.vue 中提取，通过 teleport 渲染到 body， *
提供连接的添加、编辑、克隆、删除操作。 */
<script setup lang="ts">
import { watch, onBeforeUnmount, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConnectionInfo } from '../stores/connections.store';

const { t } = useI18n();

const props = defineProps<{
  /** 菜单是否可见（v-model） */
  visible: boolean;
  /** 菜单位置 */
  position: { x: number; y: number };
  /** 右键点击的目标连接（null 时仅显示"添加"选项） */
  targetConnection: ConnectionInfo | null;
}>();

const emit = defineEmits<{
  /** 更新可见状态 */
  'update:visible': [value: boolean];
  /** 菜单操作 */
  action: [actionType: 'add' | 'edit' | 'delete' | 'clone'];
}>();

const handleAction = (actionType: 'add' | 'edit' | 'delete' | 'clone') => {
  emit('update:visible', false);
  emit('action', actionType);
};

// 键盘支持：Esc 关闭菜单；打开时聚焦菜单首个操作项，便于键盘用户操作
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    emit('update:visible', false);
  }
};

const focusFirstItem = async () => {
  await nextTick();
  const firstItem = document.querySelector<HTMLElement>('.context-menu li');
  if (firstItem) firstItem.focus();
};

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      document.addEventListener('keydown', handleKeydown);
      focusFirstItem();
    } else {
      document.removeEventListener('keydown', handleKeydown);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="fixed bg-background border border-border/50 shadow-xl rounded-lg py-1.5 z-[9999] min-w-[180px] context-menu"
      :style="{ top: `${position.y}px`, left: `${position.x}px` }"
      @click.stop
      role="menu"
    >
      <ul class="list-none p-0 m-0">
        <li
          class="group px-4 py-1.5 cursor-pointer flex items-center text-foreground hover:bg-primary/10 hover:text-primary text-sm transition-colors duration-150 rounded-md mx-1 focus:bg-primary/10 focus:outline-none"
          @click="handleAction('add')"
          role="menuitem"
          tabindex="0"
          @keydown.enter.prevent="handleAction('add')"
        >
          <i
            class="fas fa-plus mr-3 w-4 text-center text-text-secondary group-hover:text-primary"
          ></i>
          <span>{{ t('connections.addConnection') }}</span>
        </li>
        <li
          v-if="targetConnection"
          class="group px-4 py-1.5 cursor-pointer flex items-center text-foreground hover:bg-primary/10 hover:text-primary text-sm transition-colors duration-150 rounded-md mx-1 focus:bg-primary/10 focus:outline-none"
          @click="handleAction('edit')"
          role="menuitem"
          tabindex="0"
          @keydown.enter.prevent="handleAction('edit')"
        >
          <i
            class="fas fa-edit mr-3 w-4 text-center text-text-secondary group-hover:text-primary"
          ></i>
          <span>{{ t('connections.actions.edit') }}</span>
        </li>
        <li
          v-if="targetConnection"
          class="group px-4 py-1.5 cursor-pointer flex items-center text-foreground hover:bg-primary/10 hover:text-primary text-sm transition-colors duration-150 rounded-md mx-1 focus:bg-primary/10 focus:outline-none"
          @click="handleAction('clone')"
          role="menuitem"
          tabindex="0"
          @keydown.enter.prevent="handleAction('clone')"
        >
          <i
            class="fas fa-clone mr-3 w-4 text-center text-text-secondary group-hover:text-primary"
          ></i>
          <span>{{ t('connections.actions.clone') }}</span>
        </li>
        <li
          v-if="targetConnection"
          class="group px-4 py-1.5 cursor-pointer flex items-center text-error hover:bg-error/10 text-sm transition-colors duration-150 rounded-md mx-1 focus:bg-error/10 focus:outline-none"
          @click="handleAction('delete')"
          role="menuitem"
          tabindex="0"
          @keydown.enter.prevent="handleAction('delete')"
        >
          <i class="fas fa-trash-alt mr-3 w-4 text-center text-error/80 group-hover:text-error"></i>
          <span>{{ t('connections.actions.delete') }}</span>
        </li>
      </ul>
    </div>
  </teleport>
</template>
