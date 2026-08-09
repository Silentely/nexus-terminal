<template>
  <li
    :data-command-id="command.id"
    role="button"
    tabindex="0"
    class="group flex justify-between items-center mb-1 cursor-pointer rounded-md hover:bg-primary/10 transition-colors duration-150"
    :style="{
      padding: isCompactMode
        ? `calc(0.1rem * var(--qc-row-size-multiplier)) calc(0.75rem * var(--qc-row-size-multiplier))`
        : `calc(0.625rem * var(--qc-row-size-multiplier)) calc(0.75rem * var(--qc-row-size-multiplier))`,
    }"
    :class="{ 'bg-primary/20 font-medium': isSelected }"
    @click="$emit('execute', command)"
    @contextmenu.prevent="$emit('contextmenu', $event, command)"
    @keydown.enter.space.prevent="$emit('execute', command)"
  >
    <!-- 命令信息 -->
    <div class="flex flex-col overflow-hidden mr-2 flex-grow">
      <span
        v-if="command.name"
        class="font-medium truncate text-foreground"
        :class="{ 'mb-0.5': !isCompactMode, 'leading-tight': isCompactMode }"
        :style="{
          fontSize: isCompactMode
            ? `calc(0.8em * max(0.8, var(--qc-row-size-multiplier) * 0.5 + 0.5))`
            : `calc(0.875em * max(0.85, var(--qc-row-size-multiplier) * 0.6 + 0.4))`,
        }"
        >{{ command.name }}</span
      >
      <span
        v-if="!isCompactMode && command.command"
        class="truncate font-mono"
        :class="{ 'text-sm': !command.name, 'text-text-secondary': true }"
        :style="{
          fontSize: `calc(0.75em * max(0.85, var(--qc-row-size-multiplier) * 0.6 + 0.4))`,
        }"
        >{{ command.command }}</span
      >
      <span
        v-else-if="isCompactMode && !command.name && command.command"
        class="truncate font-mono text-xs text-text-secondary/70 leading-tight"
        :style="{
          fontSize: `calc(0.65em * max(0.8, var(--qc-row-size-multiplier) * 0.5 + 0.5))`,
        }"
        >{{ command.command }}</span
      >
    </div>
    <!-- 操作按钮 -->
    <div
      class="flex items-center flex-shrink-0 transition-opacity duration-150"
      :class="{
        'opacity-0 group-hover:opacity-100 focus-within:opacity-100': isCompactMode,
        'opacity-100': !isCompactMode,
      }"
    >
      <button
        @click.stop="$emit('copy', command.command)"
        :class="isCompactMode ? 'p-1' : 'p-1.5'"
        class="rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors duration-150 text-text-secondary hover:text-primary"
        :title="$t('commandHistory.copy', '复制')"
        :aria-label="$t('commandHistory.copy', '复制')"
      >
        <i
          class="fas fa-copy"
          :style="{
            fontSize: isCompactMode
              ? `calc(0.8em * max(0.8, var(--qc-row-size-multiplier) * 0.5 + 0.5))`
              : `calc(0.875em * max(0.85, var(--qc-row-size-multiplier) * 0.6 + 0.4))`,
          }"
        ></i>
      </button>
      <button
        @click.stop="$emit('edit', command)"
        :class="isCompactMode ? 'p-1' : 'p-1.5'"
        class="rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors duration-150 text-text-secondary hover:text-primary"
        :title="$t('common.edit', '编辑')"
        :aria-label="$t('common.edit', '编辑')"
      >
        <i
          class="fas fa-edit"
          :style="{
            fontSize: isCompactMode
              ? `calc(0.8em * max(0.8, var(--qc-row-size-multiplier) * 0.5 + 0.5))`
              : `calc(0.875em * max(0.85, var(--qc-row-size-multiplier) * 0.6 + 0.4))`,
          }"
        ></i>
      </button>
      <button
        @click.stop="$emit('delete', command)"
        :class="isCompactMode ? 'p-1' : 'p-1.5'"
        class="rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors duration-150 text-text-secondary hover:text-error"
        :title="$t('common.delete', '删除')"
        :aria-label="$t('common.delete', '删除')"
      >
        <i
          class="fas fa-times"
          :style="{
            fontSize: isCompactMode
              ? `calc(0.8em * max(0.8, var(--qc-row-size-multiplier) * 0.5 + 0.5))`
              : `calc(0.875em * max(0.85, var(--qc-row-size-multiplier) * 0.6 + 0.4))`,
          }"
        ></i>
      </button>
    </div>
  </li>
</template>

<script setup lang="ts">
import type { QuickCommandFE } from '../stores/quickCommands.store';

defineProps<{
  /** 快捷指令数据 */
  command: QuickCommandFE;
  /** 是否为当前选中项 */
  isSelected: boolean;
  /** 是否为紧凑模式 */
  isCompactMode: boolean;
  /** 行大小倍率（用于 CSS 变量计算） */
  rowSizeMultiplier: number;
}>();

defineEmits<{
  /** 执行命令 */
  execute: [command: QuickCommandFE];
  /** 复制命令文本 */
  copy: [commandText: string];
  /** 编辑命令 */
  edit: [command: QuickCommandFE];
  /** 删除命令 */
  delete: [command: QuickCommandFE];
  /** 右键菜单 */
  contextmenu: [event: MouseEvent, command: QuickCommandFE];
}>();
</script>
