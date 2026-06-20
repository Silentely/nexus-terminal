<script setup lang="ts">
/**
 * FileManagerFileList - 文件管理器文件列表子组件
 *
 * 包含列头（排序与列宽拖拽）、虚拟滚动文件行
 * （图标、名称、大小、权限、修改时间）以及拖拽交互。
 * 仅负责 UI 渲染与事件转发，所有业务逻辑由父组件 FileManager 管理。
 */
import { ref, computed, watch, nextTick } from 'vue';
import { useVirtualListSetup } from '../composables/useVirtualListSetup';
import { useI18n } from 'vue-i18n';
import {
  formatSize,
  formatMode,
  getFileIconClassBase,
} from '../composables/file-manager/fileManagerDisplayUtils';
import type { FileListItem } from '../types/sftp.types';

const props = defineProps({
  /** 排序并过滤后的文件列表 */
  files: { type: Array as () => FileListItem[], required: true },
  /** 是否显示父目录链接 (..) */
  hasParentLink: { type: Boolean, default: false },
  /** 当前排序字段 */
  sortKey: { type: String, default: 'filename' },
  /** 当前排序方向 */
  sortDirection: { type: String as () => 'asc' | 'desc', default: 'asc' },
  /** 已选中的文件名集合 */
  selectedItems: { type: Object as () => Set<string>, required: true },
  /** 键盘导航选中的索引 */
  selectedIndex: { type: Number, default: -1 },
  isMobile: { type: Boolean, default: false },
  /** 各列宽度 (type, name, size, permissions, modified) */
  colWidths: {
    type: Object as () => Record<string, number>,
    required: true,
  },
  /** 行大小乘数（用于字体/行高缩放） */
  rowSizeMultiplier: { type: Number, default: 1.0 },
  /** SFTP 管理器是否正在加载 */
  isLoading: { type: Boolean, default: false },
  /** 搜索关键词（用于空状态文案判断） */
  searchQuery: { type: String, default: '' },
  /** 移动端多选模式是否激活 */
  isMultiSelectMode: { type: Boolean, default: false },
  /** 是否显示外部文件拖拽蒙版 */
  showExternalDropOverlay: { type: Boolean, default: false },
  /** 拖拽悬停的目标文件名 */
  dragOverTarget: { type: String as () => string | null, default: null },
});

const emit = defineEmits<{
  sort: [key: string];
  'item-click': [event: MouseEvent, item: FileListItem, forceMultiSelect: boolean];
  'item-double-click': [event: MouseEvent, item: FileListItem];
  'item-long-press': [event: TouchEvent, item: FileListItem];
  'context-menu': [event: MouseEvent, item?: FileListItem];
  'start-resize': [event: MouseEvent, index: number];
  'drag-enter': [event: DragEvent];
  'drag-over': [event: DragEvent];
  'drag-leave': [event: DragEvent];
  drop: [event: DragEvent];
  'overlay-drop': [event: DragEvent];
  'drag-start': [item: FileListItem];
  'drag-end': [];
  'drag-over-row': [item: FileListItem, event: DragEvent];
  'drag-leave-row': [item: FileListItem];
  'drop-on-row': [item: FileListItem, event: DragEvent];
  wheel: [event: WheelEvent];
  keydown: [event: KeyboardEvent];
}>();

const { t } = useI18n();

// --- 父目录条目常量 ---
const PARENT_DIR_ITEM: FileListItem = {
  filename: '..',
  longname: '..',
  attrs: {
    isDirectory: true,
    isFile: false,
    isSymbolicLink: false,
    size: 0,
    uid: 0,
    gid: 0,
    mode: 0,
    atime: 0,
    mtime: 0,
  },
};

// --- 移动端长按手势检测 ---
const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const longPressTriggered = ref(false);
const LONG_PRESS_DURATION = 500;

const handleTouchStart = (event: TouchEvent, item: FileListItem) => {
  if (!props.isMobile || item.filename === '..') return;
  longPressTriggered.value = false;
  longPressTimer.value = setTimeout(() => {
    longPressTriggered.value = true;
    emit('item-long-press', event, item);
  }, LONG_PRESS_DURATION);
};

const handleTouchEnd = () => {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
};

const handleTouchMove = () => {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
};

// --- 虚拟列表数据源（含可选的父目录条目）---
const virtualListSource = computed(() => {
  return props.hasParentLink ? [PARENT_DIR_ITEM, ...props.files] : props.files;
});

// --- 移动端默认列宽（隐藏权限列，缩小其他列）---
const MOBILE_COL_WIDTHS = { type: 36, name: 160, size: 64, modified: 72 } as const;

// --- CSS Grid 样式 ---
const gridStyle = computed(() => {
  if (props.isMobile) {
    return {
      display: 'grid',
      gridTemplateColumns: `${MOBILE_COL_WIDTHS.type}px ${MOBILE_COL_WIDTHS.name}px ${MOBILE_COL_WIDTHS.size}px ${MOBILE_COL_WIDTHS.modified}px`,
    };
  }
  return {
    display: 'grid',
    gridTemplateColumns: `${props.colWidths.type}px ${props.colWidths.name}px ${props.colWidths.size}px ${props.colWidths.permissions}px ${props.colWidths.modified}px`,
  };
});

// --- 单行高度（受 rowSizeMultiplier 影响）---
const itemHeight = computed(() => Math.round(36 * props.rowSizeMultiplier));

// --- 虚拟列表 ---
const {
  list: virtualList,
  containerProps,
  wrapperProps,
  scrollTo: virtualScrollTo,
} = useVirtualListSetup(virtualListSource, {
  itemHeight: () => itemHeight.value,
  overscan: 15,
});

// --- Drop Overlay DOM 引用 ---
const dropOverlayRef = ref<HTMLDivElement | null>(null);

// --- 拖拽蒙版高度自适应 ---
watch(
  () => props.showExternalDropOverlay,
  (isVisible) => {
    if (isVisible) {
      nextTick(() => {
        if (dropOverlayRef.value && containerProps.ref.value) {
          const scrollHeight = containerProps.ref.value.scrollHeight;
          dropOverlayRef.value.style.height = `${scrollHeight}px`;
        }
      });
    } else {
      if (dropOverlayRef.value) {
        dropOverlayRef.value.style.height = '';
      }
    }
  },
);

// --- 行高变化时重新计算虚拟列表可视区域 ---
watch(itemHeight, async () => {
  await nextTick();
  containerProps.onScroll();
});

/** 暴露给父组件：容器 DOM 元素与滚动方法 */
defineExpose({
  containerElement: computed(() => containerProps.ref.value),
  scrollTo: virtualScrollTo,
});
</script>

<template>
  <!-- 文件列表容器 -->
  <div
    v-bind="containerProps"
    class="flex-grow overflow-auto relative outline-none"
    @dragenter.prevent="emit('drag-enter', $event)"
    @dragover.prevent="emit('drag-over', $event)"
    @dragleave.prevent="emit('drag-leave', $event)"
    @drop.prevent="emit('drop', $event)"
    @click="containerProps.ref.value?.focus()"
    @keydown="emit('keydown', $event)"
    @wheel="emit('wheel', $event)"
    @contextmenu.prevent="emit('context-menu', $event)"
    tabindex="0"
    role="grid"
    :style="{ '--row-size-multiplier': rowSizeMultiplier }"
  >
    <!-- 外部文件拖拽蒙版 -->
    <div
      v-if="showExternalDropOverlay"
      ref="dropOverlayRef"
      class="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-xl font-semibold rounded z-50 pointer-events-auto"
      @dragover.prevent
      @dragleave.prevent="emit('drag-leave', $event)"
      @drop.prevent="emit('overlay-drop', $event)"
    >
      {{ t('fileManager.dropFilesHere', 'Drop files here to upload') }}
    </div>

    <!-- 列头（固定定位） -->
    <div
      class="sticky top-0 z-10 bg-header border-b border-border font-medium text-text-secondary uppercase tracking-wider text-xs select-none"
      :style="gridStyle"
    >
      <!-- 类型 -->
      <div
        @click="emit('sort', 'type')"
        role="columnheader"
        :aria-sort="
          sortKey === 'type' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
        "
        class="relative border-r border-border/10 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer flex items-center truncate"
        :style="{
          paddingLeft: `calc(1rem * var(--row-size-multiplier))`,
          paddingRight: `calc(0.5rem * var(--row-size-multiplier))`,
          paddingTop: '0.25rem',
          paddingBottom: '0.25rem',
        }"
      >
        {{ t('fileManager.headers.type') }}
        <span v-if="sortKey === 'type'" class="ml-1">{{
          sortDirection === 'asc' ? '\u25B2' : '\u25BC'
        }}</span>
        <span
          class="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-20 hover:bg-primary/20"
          @mousedown.prevent="emit('start-resize', $event, 0)"
          @click.stop
        ></span>
      </div>
      <!-- 名称 -->
      <div
        @click="emit('sort', 'filename')"
        role="columnheader"
        :aria-sort="
          sortKey === 'filename' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
        "
        class="relative border-r border-border/10 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer flex items-center truncate"
        :style="{
          padding: `calc(0.4rem * var(--row-size-multiplier)) calc(0.8rem * var(--row-size-multiplier))`,
        }"
      >
        {{ t('fileManager.headers.name') }}
        <span v-if="sortKey === 'filename'" class="ml-1">{{
          sortDirection === 'asc' ? '\u25B2' : '\u25BC'
        }}</span>
        <span
          class="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-20 hover:bg-primary/20"
          @mousedown.prevent="emit('start-resize', $event, 1)"
          @click.stop
        ></span>
      </div>
      <!-- 大小 -->
      <div
        @click="emit('sort', 'size')"
        role="columnheader"
        :aria-sort="
          sortKey === 'size' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
        "
        class="relative border-r border-border/10 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer flex items-center truncate"
        :style="{
          padding: `calc(0.4rem * var(--row-size-multiplier)) calc(0.8rem * var(--row-size-multiplier))`,
        }"
      >
        {{ t('fileManager.headers.size') }}
        <span v-if="sortKey === 'size'" class="ml-1">{{
          sortDirection === 'asc' ? '\u25B2' : '\u25BC'
        }}</span>
        <span
          class="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-20 hover:bg-primary/20"
          @mousedown.prevent="emit('start-resize', $event, 2)"
          @click.stop
        ></span>
      </div>
      <!-- 权限（移动端隐藏） -->
      <div
        v-if="!isMobile"
        class="relative border-r border-border/10 flex items-center truncate"
        :style="{
          padding: `calc(0.4rem * var(--row-size-multiplier)) calc(0.8rem * var(--row-size-multiplier))`,
        }"
      >
        {{ t('fileManager.headers.permissions') }}
        <span
          class="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-20 hover:bg-primary/20"
          @mousedown.prevent="emit('start-resize', $event, 3)"
          @click.stop
        ></span>
      </div>
      <!-- 修改时间 -->
      <div
        @click="emit('sort', 'mtime')"
        role="columnheader"
        :aria-sort="
          sortKey === 'mtime' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
        "
        class="relative hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer flex items-center truncate"
        :style="{
          padding: `calc(0.4rem * var(--row-size-multiplier)) calc(0.8rem * var(--row-size-multiplier))`,
        }"
      >
        {{ t('fileManager.headers.modified') }}
        <span v-if="sortKey === 'mtime'" class="ml-1">{{
          sortDirection === 'asc' ? '\u25B2' : '\u25BC'
        }}</span>
      </div>
    </div>

    <!-- 列表包装器 -->
    <div v-bind="wrapperProps">
      <!-- 加载状态 -->
      <div v-if="isLoading" class="px-4 py-6 text-center text-text-secondary italic">
        {{ t('fileManager.loading') }}
      </div>

      <div v-else>
        <!-- 文件行 -->
        <div
          v-for="{ data: item, index } in virtualList"
          :key="item.filename"
          class="border-b border-border transition-colors duration-150 select-none items-center file-row"
          :style="gridStyle"
          :draggable="item.filename !== '..'"
          @dragstart="emit('drag-start', item)"
          @dragend="emit('drag-end')"
          @click="emit('item-click', $event, item, isMobile && isMultiSelectMode)"
          @dblclick="emit('item-double-click', $event, item)"
          @touchstart.passive="handleTouchStart($event, item)"
          @touchend.passive="handleTouchEnd"
          @touchmove.passive="handleTouchMove"
          @touchcancel.passive="handleTouchEnd"
          :class="[
            { 'cursor-pointer': item.attrs.isDirectory || item.attrs.isFile },
            {
              'bg-primary text-white': selectedItems.has(item.filename) || index === selectedIndex,
            },
            {
              'hover:bg-header/50': !(selectedItems.has(item.filename) || index === selectedIndex),
            },
            {
              'outline-dashed outline-2 outline-offset-[-1px] outline-primary':
                item.attrs.isDirectory && dragOverTarget === item.filename,
            },
          ]"
          :data-filename="item.filename"
          @contextmenu.prevent.stop="emit('context-menu', $event, item)"
          @dragover.prevent="emit('drag-over-row', item, $event)"
          @dragleave="emit('drag-leave-row', item)"
          @drop.prevent="emit('drop-on-row', item, $event)"
        >
          <!-- 类型图标 -->
          <div
            class="text-center truncate flex items-center justify-center min-w-0"
            :style="{
              paddingLeft: `calc(1rem * var(--row-size-multiplier))`,
              paddingRight: `calc(0.5rem * var(--row-size-multiplier))`,
            }"
          >
            <i
              v-if="item.filename === '..'"
              class="fas fa-level-up-alt text-primary"
              :style="{
                fontSize: `calc(1.1em * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))`,
              }"
            ></i>
            <i
              v-else
              :class="[
                'transition-colors duration-150',
                item.attrs.isDirectory
                  ? 'fas fa-folder text-primary'
                  : item.attrs.isSymbolicLink
                    ? 'fas fa-link text-primary'
                    : `${getFileIconClassBase(item.filename)} text-text-secondary`,
                {
                  'text-white': selectedItems.has(item.filename) || index === selectedIndex,
                },
              ]"
              :style="{
                fontSize: `calc(1.1em * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))`,
              }"
            ></i>
          </div>

          <!-- 名称 -->
          <div
            class="truncate flex items-center min-w-0"
            :class="{ 'font-medium': item.attrs.isDirectory }"
            :style="{
              padding: `calc(0.4rem * var(--row-size-multiplier)) calc(0.8rem * var(--row-size-multiplier))`,
              fontSize: `calc(0.8rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))`,
            }"
          >
            {{ item.filename }}
          </div>

          <!-- 大小 -->
          <div
            class="truncate flex items-center min-w-0"
            :class="[
              selectedItems.has(item.filename) || index === selectedIndex
                ? 'text-white'
                : 'text-text-secondary',
            ]"
            :style="{
              padding: `calc(0.4rem * var(--row-size-multiplier)) calc(0.8rem * var(--row-size-multiplier))`,
              fontSize: `calc(0.72rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))`,
            }"
          >
            {{ item.attrs.isFile ? formatSize(item.attrs.size) : '' }}
          </div>

          <!-- 权限（移动端隐藏） -->
          <div
            v-if="!isMobile"
            class="truncate font-mono flex items-center min-w-0"
            :class="[
              selectedItems.has(item.filename) || index === selectedIndex
                ? 'text-white'
                : 'text-text-secondary',
            ]"
            :style="{
              padding: `calc(0.4rem * var(--row-size-multiplier)) calc(0.8rem * var(--row-size-multiplier))`,
              fontSize: `calc(0.72rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))`,
            }"
          >
            {{ item.filename !== '..' ? formatMode(item.attrs.mode) : '' }}
          </div>

          <!-- 修改时间 -->
          <div
            class="truncate flex items-center min-w-0"
            :class="[
              selectedItems.has(item.filename) || index === selectedIndex
                ? 'text-white'
                : 'text-text-secondary',
            ]"
            :style="{
              padding: `calc(0.4rem * var(--row-size-multiplier)) calc(0.8rem * var(--row-size-multiplier))`,
              fontSize: `calc(0.72rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))`,
            }"
          >
            {{ item.filename !== '..' ? new Date(item.attrs.mtime).toLocaleString() : '' }}
          </div>
        </div>

        <!-- 空目录 / 搜索无结果状态 -->
        <div v-if="files.length === 0" class="px-4 py-6 text-center text-text-secondary italic">
          {{ searchQuery ? t('fileManager.noSearchResults') : t('fileManager.emptyDirectory') }}
        </div>
      </div>
    </div>
  </div>
</template>
