<script setup lang="ts">
/**
 * FileManagerToolbar - 文件管理器工具栏子组件
 *
 * 包含路径导航按钮、搜索框、收藏路径、路径历史下拉、
 * 以及上传/新建文件等操作按钮。
 * 仅负责 UI 渲染与事件转发，所有业务逻辑由父组件 FileManager 管理。
 */
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import PathHistoryDropdown from './PathHistoryDropdown.vue';
import FavoritePathsModal from './FavoritePathsModal.vue';

const props = defineProps({
  currentPath: { type: String, required: true },
  isEditingPath: { type: Boolean, required: true },
  editablePath: { type: String, required: true },
  searchQuery: { type: String, required: true },
  isSearchActive: { type: Boolean, required: true },
  isMobile: { type: Boolean, default: false },
  /** WebSocket 是否已连接 */
  isConnected: { type: Boolean, default: false },
  /** SFTP 是否已就绪 */
  isSftpReady: { type: Boolean, default: false },
  /** SFTP 管理器是否正在加载 */
  isLoading: { type: Boolean, default: false },
  /** 是否正在从终端同步路径 */
  isSyncingFromTerminal: { type: Boolean, default: false },
  /** 当前是否处于根目录 */
  isAtRoot: { type: Boolean, default: true },
  /** 是否显示弹窗编辑器按钮 */
  showPopupEditor: { type: Boolean, default: false },
  /** 移动端多选模式是否激活 */
  isMultiSelectMode: { type: Boolean, default: false },
  /** 路径历史下拉框是否展开 */
  showPathHistoryDropdown: { type: Boolean, default: false },
  /** 路径历史下拉框中选中的索引 */
  pathSelectedIndex: { type: Number, default: -1 },
  /** 过滤后的路径历史列表 */
  filteredPathHistory: {
    type: Array as () => Array<{ id: number; path: string }>,
    default: () => [],
  },
});

const emit = defineEmits<{
  'cd-to-terminal': [];
  'sync-from-terminal': [];
  refresh: [];
  'go-to-parent': [];
  'activate-search': [];
  'deactivate-search': [];
  'cancel-search': [];
  'update:search-query': [value: string];
  'update:editable-path': [value: string];
  'start-path-edit': [];
  'path-input-focus': [];
  'path-input-keydown': [event: KeyboardEvent];
  'path-selected': [path: string];
  'close-path-history': [];
  'navigate-to-favorite': [path: string];
  'open-popup-editor': [];
  'trigger-file-upload': [];
  'trigger-folder-upload': [];
  'new-folder': [];
  'new-file': [];
  'toggle-multi-select': [];
  /** 搜索框中的键盘事件（用于文件列表导航） */
  'search-keydown': [event: KeyboardEvent];
}>();

const { t } = useI18n();

// --- 浏览器能力检测：webkitdirectory 是否可用 ---
const isFolderUploadSupported = computed(() => {
  const input = document.createElement('input');
  input.type = 'file';
  return 'webkitdirectory' in input;
});

// --- 统一禁用条件：上传/新建操作需要 isConnected && isSftpReady ---
const isActionDisabled = computed(() => !props.isConnected || !props.isSftpReady);

// --- 文件夹上传按钮禁用条件（额外检查浏览器能力） ---
const isFolderUploadDisabled = computed(
  () => isActionDisabled.value || !isFolderUploadSupported.value,
);

// --- DOM 引用 ---
const searchInputRef = ref<HTMLInputElement | null>(null);
const pathInputRef = ref<HTMLInputElement | null>(null);
const pathInputWrapperRef = ref<HTMLDivElement | null>(null);
const pathHistoryDropdownRef = ref<InstanceType<typeof PathHistoryDropdown> | null>(null);
const favoritePathsButtonRef = ref<HTMLButtonElement | null>(null);
const showFavoritePathsModal = ref(false);

/** 暴露引用给父组件（用于外部聚焦等操作） */
defineExpose({
  searchInputRef,
  pathInputRef,
  pathInputWrapperRef,
});

// --- 搜索框激活时自动聚焦 ---
watch(
  () => props.isSearchActive,
  (active) => {
    if (active) {
      nextTick(() => {
        searchInputRef.value?.focus();
      });
    }
  },
);

// --- 收藏路径模态框 ---
const toggleFavoritePathsModal = () => {
  showFavoritePathsModal.value = !showFavoritePathsModal.value;
};

const handleNavigateToPathFromFavorites = (path: string) => {
  emit('navigate-to-favorite', path);
  showFavoritePathsModal.value = false;
};

// --- 路径输入框失焦处理 ---
const handlePathInputBlur = () => {
  setTimeout(() => {
    const activeEl = document.activeElement;
    const dropdownEl = pathHistoryDropdownRef.value?.$el;
    if (dropdownEl && dropdownEl.contains(activeEl)) {
      return;
    }
    if (pathInputRef.value !== activeEl) {
      emit('close-path-history');
    }
  }, 150);
};

// --- 点击路径输入框外部关闭 ---
const handleClickOutside = (event: MouseEvent) => {
  if (pathInputWrapperRef.value && !pathInputWrapperRef.value.contains(event.target as Node)) {
    if (props.isEditingPath || props.showPathHistoryDropdown) {
      emit('close-path-history');
    }
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div
    class="flex items-center justify-between flex-wrap p-2 bg-header flex-shrink-0"
    :class="isMobile ? 'gap-1' : 'gap-2'"
  >
    <!-- 左侧：路径操作按钮 + 路径栏 -->
    <div class="flex items-center flex-grow min-w-0" :class="isMobile ? 'gap-1' : 'gap-2'">
      <!-- 路径操作按钮组 -->
      <div class="flex items-center flex-shrink-0" :class="isMobile ? 'gap-0.5' : 'gap-0'">
        <!-- CD 到终端按钮 -->
        <button
          class="flex items-center justify-center text-text-secondary rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-black/10 dark:hover:enabled:bg-white/10 hover:enabled:text-foreground"
          :class="isMobile ? 'w-6 h-6' : 'w-7 h-7'"
          @click.stop="emit('cd-to-terminal')"
          :disabled="!isConnected || isEditingPath"
          :title="t('fileManager.actions.cdToTerminal', '将终端路径切换到文件管理器当前路径')"
          :aria-label="t('fileManager.actions.cdToTerminal', '将终端路径切换到文件管理器当前路径')"
        >
          <i class="fas fa-terminal leading-none" :class="isMobile ? 'text-sm' : 'text-base'"></i>
        </button>
        <!-- 从终端同步路径按钮 -->
        <button
          class="flex items-center justify-center text-text-secondary rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-black/10 dark:hover:enabled:bg-white/10 hover:enabled:text-foreground"
          :class="isMobile ? 'w-6 h-6' : 'w-7 h-7'"
          @click.stop="emit('sync-from-terminal')"
          :disabled="!isConnected || isEditingPath || isSyncingFromTerminal"
          :title="
            t('fileManager.actions.syncFromTerminalPath', '将文件管理器路径切换到终端当前路径')
          "
          :aria-label="
            t('fileManager.actions.syncFromTerminalPath', '将文件管理器路径切换到终端当前路径')
          "
        >
          <i
            :class="[
              'fas',
              isSyncingFromTerminal ? 'fa-spinner fa-spin' : 'fa-folder-open',
              'leading-none',
              isMobile ? 'text-sm' : 'text-base',
            ]"
          ></i>
        </button>
        <!-- 刷新按钮 -->
        <button
          class="flex items-center justify-center text-text-secondary rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-black/10 dark:hover:enabled:bg-white/10 hover:enabled:text-foreground"
          :class="isMobile ? 'w-6 h-6' : 'w-7 h-7'"
          @click.stop="emit('refresh')"
          :disabled="!isConnected || isEditingPath"
          :title="t('fileManager.actions.refresh')"
          :aria-label="t('fileManager.actions.refresh')"
        >
          <i class="fas fa-sync-alt leading-none" :class="isMobile ? 'text-sm' : 'text-base'"></i>
        </button>
        <!-- 返回上级目录按钮 -->
        <button
          class="flex items-center justify-center text-text-secondary rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-black/10 dark:hover:enabled:bg-white/10 hover:enabled:text-foreground"
          :class="isMobile ? 'w-6 h-6' : 'w-7 h-7'"
          @click.stop="emit('go-to-parent')"
          :disabled="!isConnected || isAtRoot || isEditingPath"
          :title="t('fileManager.actions.parentDirectory')"
          :aria-label="t('fileManager.actions.parentDirectory')"
        >
          <i class="fas fa-arrow-up leading-none" :class="isMobile ? 'text-sm' : 'text-base'"></i>
        </button>
        <!-- 搜索区域 -->
        <div class="flex items-center flex-shrink-0">
          <button
            v-if="!isSearchActive"
            class="flex items-center justify-center text-text-secondary rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-black/10 dark:hover:enabled:bg-white/10 hover:enabled:text-foreground"
            :class="isMobile ? 'w-6 h-6' : 'w-7 h-7'"
            @click.stop="emit('activate-search')"
            :disabled="!isConnected"
            :title="t('fileManager.searchPlaceholder')"
            :aria-label="t('fileManager.searchPlaceholder')"
          >
            <i class="fas fa-search leading-none" :class="isMobile ? 'text-sm' : 'text-base'"></i>
          </button>
          <div v-else class="relative flex items-center min-w-[150px] flex-shrink">
            <i
              class="fas fa-search absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
            ></i>
            <input
              ref="searchInputRef"
              type="text"
              aria-label="搜索文件"
              :value="searchQuery"
              @input="emit('update:search-query', ($event.target as HTMLInputElement).value)"
              :placeholder="t('fileManager.searchPlaceholder')"
              class="flex-grow bg-background border border-border rounded pl-7 pr-2 py-1 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary min-w-[10px] transition-colors duration-200"
              data-focus-id="fileManagerSearch"
              @blur="emit('deactivate-search')"
              @keyup.esc="emit('cancel-search')"
              @keydown.up.prevent="emit('search-keydown', $event)"
              @keydown.down.prevent="emit('search-keydown', $event)"
              @keydown.enter.prevent="emit('search-keydown', $event)"
            />
          </div>
        </div>
        <!-- 收藏路径按钮 -->
        <div class="relative flex-shrink-0">
          <button
            ref="favoritePathsButtonRef"
            class="flex items-center justify-center text-text-secondary rounded transition-colors duration-200 hover:enabled:bg-black/10 dark:hover:enabled:bg-white/10 hover:enabled:text-foreground"
            :class="isMobile ? 'w-6 h-6' : 'w-7 h-7'"
            @click="toggleFavoritePathsModal"
            :title="t('favoritePaths.title', '收藏路径')"
            :aria-label="t('favoritePaths.title', '收藏路径')"
            :aria-expanded="showFavoritePathsModal"
          >
            <i class="fas fa-star leading-none" :class="isMobile ? 'text-sm' : 'text-base'"></i>
          </button>
          <FavoritePathsModal
            :is-visible="showFavoritePathsModal"
            :trigger-element="favoritePathsButtonRef"
            @close="showFavoritePathsModal = false"
            @navigate-to-path="handleNavigateToPathFromFavorites"
          />
        </div>
      </div>

      <!-- 路径输入框（含历史下拉） -->
      <div
        ref="pathInputWrapperRef"
        class="relative flex items-center bg-background border border-border rounded px-1.5 py-0.5"
        :class="{
          'flex-grow min-w-0': isEditingPath || showPathHistoryDropdown,
          'w-fit max-w-full': !isEditingPath && !showPathHistoryDropdown,
        }"
      >
        <span
          v-show="!isEditingPath && !showPathHistoryDropdown"
          @click="emit('start-path-edit')"
          class="text-text-secondary pr-2 cursor-text truncate"
        >
          <strong
            :title="t('fileManager.editPathTooltip')"
            class="font-medium text-link px-1 rounded transition-colors duration-200"
            :class="{
              'hover:bg-black/5 dark:hover:bg-white/5': isConnected,
              'opacity-60 cursor-not-allowed': !isConnected,
            }"
          >
            {{ currentPath }}
          </strong>
        </span>
        <input
          v-show="isEditingPath || showPathHistoryDropdown"
          ref="pathInputRef"
          type="text"
          aria-label="编辑路径"
          :value="editablePath"
          @input="emit('update:editable-path', ($event.target as HTMLInputElement).value)"
          class="flex-grow bg-transparent text-foreground p-0.5 outline-none min-w-[100px]"
          data-focus-id="fileManagerPathInput"
          @focus="emit('path-input-focus')"
          @keydown="emit('path-input-keydown', $event)"
          @blur="handlePathInputBlur"
        />
        <PathHistoryDropdown
          v-if="showPathHistoryDropdown"
          ref="pathHistoryDropdownRef"
          @pathSelected="emit('path-selected', $event)"
          @closeDropdown="emit('close-path-history')"
          class="left-0 right-0 top-full mt-1"
        />
      </div>
    </div>
    <!-- 右侧：操作按钮组 -->
    <div class="flex items-center flex-shrink-0" :class="isMobile ? 'gap-1' : 'gap-2'">
      <!-- 打开编辑器按钮 -->
      <button
        v-if="showPopupEditor"
        @click="emit('open-popup-editor')"
        :disabled="!isConnected"
        :title="t('fileManager.actions.openEditor', 'Open Popup Editor')"
        class="flex items-center justify-center gap-1 px-2.5 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
        :class="{ 'px-1.5': isMobile }"
      >
        <i class="far fa-edit text-sm leading-none"></i>
        <span v-if="!isMobile">{{ t('fileManager.actions.openEditor', 'Open Editor') }}</span>
      </button>
      <!-- 上传文件按钮 -->
      <button
        @click="emit('trigger-file-upload')"
        :disabled="isActionDisabled"
        :title="t('fileManager.actions.uploadFile')"
        class="flex items-center justify-center gap-1 px-2.5 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
        :class="{ 'px-1.5': isMobile }"
      >
        <i class="fas fa-upload text-sm leading-none"></i>
        <span v-if="!isMobile">{{ t('fileManager.actions.uploadFile') }}</span>
      </button>
      <!-- 上传文件夹按钮 -->
      <button
        @click="emit('trigger-folder-upload')"
        :disabled="isFolderUploadDisabled"
        :title="
          isFolderUploadSupported
            ? t('fileManager.actions.uploadFolder')
            : t('fileManager.actions.uploadFolderUnsupported', '当前浏览器不支持文件夹上传')
        "
        class="flex items-center justify-center gap-1 px-2.5 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
        :class="{ 'px-1.5': isMobile }"
      >
        <i class="fas fa-cloud-arrow-up text-sm leading-none"></i>
        <span v-if="!isMobile">{{ t('fileManager.actions.uploadFolder') }}</span>
      </button>
      <!-- 新建文件夹按钮 -->
      <button
        @click="emit('new-folder')"
        :disabled="isActionDisabled"
        :title="t('fileManager.actions.newFolder')"
        class="flex items-center justify-center gap-1 px-2.5 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
        :class="{ 'px-1.5': isMobile }"
      >
        <i class="fas fa-folder-plus text-sm leading-none"></i>
        <span v-if="!isMobile">{{ t('fileManager.actions.newFolder') }}</span>
      </button>
      <!-- 新建文件按钮 -->
      <button
        @click="emit('new-file')"
        :disabled="isActionDisabled"
        :title="t('fileManager.actions.newFile')"
        class="flex items-center justify-center gap-1 px-2.5 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
        :class="{ 'px-1.5': isMobile }"
      >
        <i class="far fa-file-alt text-sm leading-none"></i>
        <span v-if="!isMobile">{{ t('fileManager.actions.newFile') }}</span>
      </button>
      <!-- 多选模式切换按钮 (仅移动端) -->
      <button
        v-if="isMobile"
        @click="emit('toggle-multi-select')"
        :title="
          isMultiSelectMode
            ? t('fileManager.actions.exitMultiSelect', 'Exit Multi-Select Mode')
            : t('fileManager.actions.multiSelect', 'Enter Multi-Select Mode')
        "
        :aria-label="
          isMultiSelectMode
            ? t('fileManager.actions.exitMultiSelect', 'Exit Multi-Select Mode')
            : t('fileManager.actions.multiSelect', 'Enter Multi-Select Mode')
        "
        class="flex items-center justify-center gap-1 px-1.5 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        :class="{
          'hover:bg-header hover:border-primary hover:text-primary': !isMultiSelectMode,
          'bg-primary text-white border-primary': isMultiSelectMode,
        }"
      >
        <i class="fas fa-check-square text-sm leading-none"></i>
      </button>
    </div>
  </div>
</template>
