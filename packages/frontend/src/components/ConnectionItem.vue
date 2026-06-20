<script setup lang="ts">
/**
 * 单个连接项组件
 *
 * 从 WorkspaceConnectionList.vue 中提取，消除三种视图模式
 * （分组视图、虚拟列表、普通列表）中重复的 li 模板代码。
 * 渲染单个连接行：图标 + 名称。
 */
import { computed } from 'vue';
import type { ConnectionInfo } from '../stores/connections.store';

const props = withDefaults(
  defineProps<{
    /** 连接信息 */
    connection: ConnectionInfo;
    /** 是否处于键盘导航高亮状态 */
    highlighted?: boolean;
    /** 是否为虚拟列表模式（影响图标差异） */
    isVirtual?: boolean;
  }>(),
  {
    highlighted: false,
    isVirtual: false,
  },
);

const emit = defineEmits<{
  /** 左键点击连接 */
  connect: [connectionId: number];
  /** 右键菜单事件 */
  contextmenu: [event: MouseEvent, connection: ConnectionInfo];
}>();

/** 连接类型对应的图标 class */
const iconClass = computed(() => {
  const type = props.connection.type;
  if (type === 'RDP') return 'fa-desktop';
  // 虚拟列表模式下 VNC 使用 fa-chalkboard，分组模式使用 fa-plug
  if (type === 'VNC') return props.isVirtual ? 'fa-chalkboard' : 'fa-plug';
  return 'fa-server';
});

/** 显示名称：优先使用 name，回退到 host */
const displayName = computed(() => props.connection.name || props.connection.host);

const handleClick = () => {
  emit('connect', props.connection.id);
};

const handleContextMenu = (event: MouseEvent) => {
  event.preventDefault();
  emit('contextmenu', event, props.connection);
};
</script>

<template>
  <li
    class="group my-0.5 py-2 pr-3 pl-4 cursor-pointer flex items-center rounded-md whitespace-nowrap overflow-hidden text-ellipsis text-foreground hover:bg-primary/10 transition-colors duration-150"
    :class="{ 'bg-primary/20 font-medium': highlighted }"
    :data-conn-id="connection.id"
    @click.left="handleClick"
    @contextmenu.prevent="handleContextMenu"
  >
    <i
      :class="[
        'fas',
        iconClass,
        'mr-2.5 w-4 text-center text-text-secondary group-hover:text-primary',
        { 'text-white': highlighted },
      ]"
    ></i>
    <span
      class="overflow-hidden text-ellipsis whitespace-nowrap flex-grow text-sm"
      :title="displayName"
    >
      {{ displayName }}
    </span>
  </li>
</template>
