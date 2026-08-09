/** * 标签分组右键菜单组件 * * 从 WorkspaceConnectionList.vue 中提取，通过 teleport 渲染到 body， *
提供标签分组的连接全部、管理标签、删除组内所有连接操作。 */
<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConnectionInfo } from '../stores/connections.store';

/** 分组数据类型（与 WorkspaceConnectionList 中一致） */
export interface TagGroupData {
  groupName: string;
  connections: ConnectionInfo[];
  tagId: number | null;
}

const { t } = useI18n();

const props = defineProps<{
  /** 菜单是否可见（v-model） */
  visible: boolean;
  /** 菜单位置 */
  position: { x: number; y: number };
  /** 右键点击的目标分组 */
  targetGroup: TagGroupData | null;
}>();

const emit = defineEmits<{
  /** 更新可见状态 */
  'update:visible': [value: boolean];
  /** 菜单操作 */
  action: [actionType: 'connectAll' | 'manageTag' | 'deleteAllConnections'];
}>();

const handleAction = (actionType: 'connectAll' | 'manageTag' | 'deleteAllConnections') => {
  emit('update:visible', false);
  emit('action', actionType);
};

/** 判断分组内是否有 SSH 连接 */
const hasSshConnections = (group: TagGroupData | null): boolean => {
  return group?.connections.some((c: ConnectionInfo) => c.type === 'SSH') ?? false;
};

// 键盘支持：Esc 关闭菜单
const closeMenuOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.visible) {
    emit('update:visible', false);
  }
};
watch(
  () => props.visible,
  (visible) => {
    if (visible) document.addEventListener('keydown', closeMenuOnEscape);
    else document.removeEventListener('keydown', closeMenuOnEscape);
  },
  { immediate: true },
);
onBeforeUnmount(() => document.removeEventListener('keydown', closeMenuOnEscape));
</script>

<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="fixed bg-background border border-border/50 shadow-xl rounded-lg py-1.5 z-[9999] min-w-[200px] tag-context-menu"
      :style="{ top: `${position.y}px`, left: `${position.x}px` }"
      @click.stop
    >
      <ul class="list-none p-0 m-0">
        <!-- 全部连接 SSH -->
        <li
          v-if="targetGroup && hasSshConnections(targetGroup)"
          class="group px-4 py-1.5 cursor-pointer flex items-center text-foreground hover:bg-primary/10 hover:text-primary text-sm transition-colors duration-150 rounded-md mx-1"
          @click="handleAction('connectAll')"
        >
          <i
            class="fas fa-network-wired mr-3 w-4 text-center text-text-secondary group-hover:text-primary"
          ></i>
          <span>{{ t('workspaceConnectionList.connectAllSshInGroupMenu') }}</span>
        </li>
        <li
          v-else-if="targetGroup"
          class="group px-4 py-1.5 flex items-center text-text-disabled text-sm rounded-md mx-1 cursor-not-allowed"
        >
          <i class="fas fa-ban mr-3 w-4 text-center text-text-disabled"></i>
          <span>{{ t('workspaceConnectionList.noSshConnectionsToConnectMenu') }}</span>
        </li>

        <!-- 分隔线 + 管理标签（仅已标记分组） -->
        <li
          class="my-1 border-t border-border/50"
          v-if="targetGroup && targetGroup.tagId !== null"
        ></li>
        <li
          v-if="targetGroup && targetGroup.tagId !== null"
          class="group px-4 py-1.5 cursor-pointer flex items-center text-foreground hover:bg-primary/10 hover:text-primary text-sm transition-colors duration-150 rounded-md mx-1"
          @click="handleAction('manageTag')"
        >
          <i
            class="fas fa-tags mr-3 w-4 text-center text-text-secondary group-hover:text-primary"
          ></i>
          <span>{{ t('workspaceConnectionList.manageTags.menuItem') }}</span>
        </li>

        <!-- 分隔线 + 删除组内所有连接（仅已标记且有连接的分组） -->
        <li
          class="my-1 border-t border-border/50"
          v-if="targetGroup && targetGroup.tagId !== null && targetGroup.connections.length > 0"
        ></li>
        <li
          v-if="targetGroup && targetGroup.tagId !== null && targetGroup.connections.length > 0"
          class="group px-4 py-1.5 cursor-pointer flex items-center text-error hover:bg-error/10 text-sm transition-colors duration-150 rounded-md mx-1"
          @click="handleAction('deleteAllConnections')"
        >
          <i class="fas fa-trash-alt mr-3 w-4 text-center text-error/80 group-hover:text-error"></i>
          <span>{{ t('workspaceConnectionList.deleteAllConnectionsInGroupMenu') }}</span>
        </li>
      </ul>
    </div>
  </teleport>
</template>
