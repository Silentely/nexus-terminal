<script setup lang="ts">
import {
  ref,
  watch,
  nextTick,
  onMounted,
  onBeforeUnmount,
  defineExpose,
  computed,
  defineOptions,
} from 'vue'; // Import defineOptions
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '../stores/session.store';
import { useFocusSwitcherStore } from '../stores/focusSwitcher.store';
import { useSettingsStore } from '../stores/settings.store';
import { useQuickCommandsStore } from '../stores/quickCommands.store';
import { useCommandHistoryStore } from '../stores/commandHistory.store';
import QuickCommandsModal from './QuickCommandsModal.vue';
import SuspendedSshSessionsModal from './SuspendedSshSessionsModal.vue';
import { useFileEditorStore } from '../stores/fileEditor.store';
import { useWorkspaceEventEmitter } from '../composables/workspaceEvents';
import { useNL2CMD } from '../composables/terminal/useNL2CMD'; // +++ Import NL2CMD +++

defineOptions({ inheritAttrs: false });

const emitWorkspaceEvent = useWorkspaceEventEmitter(); // +++ 获取事件发射器 +++
const emit = defineEmits(['toggle-virtual-keyboard']);

const { t } = useI18n();
const focusSwitcherStore = useFocusSwitcherStore();
const settingsStore = useSettingsStore();
const quickCommandsStore = useQuickCommandsStore();
const commandHistoryStore = useCommandHistoryStore();
const sessionStore = useSessionStore(); // +++ 初始化 Session Store +++
const fileEditorStore = useFileEditorStore(); // +++ Initialize File Editor Store +++

// Get reactive setting from store
const { commandInputSyncTarget, showPopupFileManagerBoolean, showPopupFileEditorBoolean } =
  storeToRefs(settingsStore); // +++ Import showPopupFileEditorBoolean +++
// Get reactive state and actions from quick commands store
const { selectedIndex: quickCommandsSelectedIndex, flatVisibleCommands: quickCommandsFiltered } =
  storeToRefs(quickCommandsStore);
const { resetSelection: resetQuickCommandsSelection } = quickCommandsStore;
// Get reactive state and actions from command history store
const { selectedIndex: historySelectedIndex, filteredHistory: historyFiltered } =
  storeToRefs(commandHistoryStore);
const { resetSelection: resetHistorySelection } = commandHistoryStore;
// +++ Get active session ID from session store +++
const { activeSessionId } = storeToRefs(sessionStore);
const { updateSessionCommandInput } = sessionStore;

// Props definition is now empty as search results are no longer handled here
const props = defineProps<{
  // No props defined here currently
  isMobile?: boolean;
  isVirtualKeyboardVisible?: boolean; // +++ Add prop to receive state +++
}>();
// --- 移除本地 commandInput ref ---
// const commandInput = ref('');
const isSearching = ref(false);
const searchTerm = ref('');
const showQuickCommands = ref(false); // +++ Add state for modal visibility +++
const showSuspendedSshSessionsModal = ref(false); // +++ Add state for suspended SSH sessions modal +++
// *** 移除本地的搜索结果 ref ***
// const searchResultCount = ref(0);
// const currentSearchResultIndex = ref(0);

// +++ NL2CMD Setup +++
const nl2cmd = useNL2CMD();
const {
  isVisible: nl2cmdVisible,
  query: nl2cmdQuery,
  isLoading: nl2cmdLoading,
  isAIEnabled: isNL2CMDEnabled,
  show: showNL2CMD,
  hide: hideNL2CMD,
  generateCommand: generateNL2CMD,
} = nl2cmd;
const nl2cmdInputRef = ref<HTMLTextAreaElement | null>(null);

const openNL2CMDPanel = () => {
  showNL2CMD();
  nextTick(() => {
    nl2cmdInputRef.value?.focus();
  });
};

const closeNL2CMDPanel = () => {
  hideNL2CMD();
};

const submitNL2CMD = async () => {
  const command = await generateNL2CMD();
  if (command && activeSessionId.value) {
    // Populate the command input bar instead of executing immediately
    updateSessionCommandInput(activeSessionId.value, command);
    // Optionally focus the input bar
    nextTick(() => {
      commandInputRef.value?.focus();
    });
  }
};

const handleNL2CMDTextareaKeydown = async (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    await submitNL2CMD();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeNL2CMDPanel();
  }
};

// +++ 计算属性，用于获取和设置当前活动会话的命令输入 +++
const currentSessionCommandInput = computed({
  get: () => {
    if (!activeSessionId.value) return '';
    const session = sessionStore.sessions.get(activeSessionId.value);
    return session ? session.commandInputContent.value : '';
  },
  set: (newValue) => {
    if (activeSessionId.value) {
      updateSessionCommandInput(activeSessionId.value, newValue);
    }
  },
});

const sendCommand = () => {
  const command = currentSessionCommandInput.value; // 使用计算属性获取值
  console.log(`[CommandInputBar] Sending command: ${command || '<Enter>'} `);
  emitWorkspaceEvent('terminal:sendCommand', { command });

  // 如果是空回车，并且有活动会话，则请求滚动到底部
  if (command.trim() === '' && activeSessionId.value) {
    console.log(
      `[CommandInputBar] Empty Enter detected. Requesting scroll to bottom for session: ${activeSessionId.value}`
    );
    emitWorkspaceEvent('terminal:scrollToBottomRequest', { sessionId: activeSessionId.value });
  }

  // 清空 store 中的值
  if (activeSessionId.value) {
    updateSessionCommandInput(activeSessionId.value, '');
  }
};

const toggleSearch = () => {
  isSearching.value = !isSearching.value;
  if (!isSearching.value) {
    searchTerm.value = ''; // 关闭搜索时清空
    emitWorkspaceEvent('search:close'); // 通知父组件关闭搜索
  } else {
    // 可以在这里聚焦搜索输入框
    // nextTick(() => searchInputRef.value?.focus());
  }
};

const performSearch = () => {
  emitWorkspaceEvent('search:start', { term: searchTerm.value });
  // 实际的计数更新逻辑应该由父组件通过 props 或事件传递回来
};

const findNext = () => {
  emitWorkspaceEvent('search:findNext');
};

const findPrevious = () => {
  emitWorkspaceEvent('search:findPrevious');
};

// 监听搜索词变化，执行搜索
watch(searchTerm, (newValue) => {
  if (isSearching.value) {
    performSearch();
  }
});

//  Watch currentSessionCommandInput and sync searchTerm based on settings
watch(currentSessionCommandInput, (newValue) => {
  // 监听计算属性
  const target = commandInputSyncTarget.value;
  if (target === 'quickCommands') {
    quickCommandsStore.setSearchTerm(newValue);
  } else if (target === 'commandHistory') {
    commandHistoryStore.setSearchTerm(newValue);
  }
  // If target is 'none', do nothing
});

// 可以在这里添加一个 ref 用于聚焦搜索框
const searchInputRef = ref<HTMLInputElement | null>(null);
const commandInputRef = ref<HTMLInputElement | null>(null); // Ref for command input

// Removed debug computed property

const handleCommandInputKeydown = (event: KeyboardEvent) => {
  // --- 移动到外部：优先处理 Enter 键执行选中项 ---
  if (!event.altKey && event.key === 'Enter') {
    const target = commandInputSyncTarget.value;
    let selectedCommand: string | undefined;
    let resetSelection: (() => void) | undefined;

    if (target === 'quickCommands' && quickCommandsSelectedIndex.value >= 0) {
      const commands = quickCommandsFiltered.value;
      if (quickCommandsSelectedIndex.value < commands.length) {
        selectedCommand = commands[quickCommandsSelectedIndex.value].command;
        resetSelection = resetQuickCommandsSelection;
      }
    } else if (target === 'commandHistory' && historySelectedIndex.value >= 0) {
      const history = historyFiltered.value;
      if (historySelectedIndex.value < history.length) {
        selectedCommand = history[historySelectedIndex.value].command;
        resetSelection = resetHistorySelection;
      }
    }

    if (selectedCommand !== undefined) {
      event.preventDefault();
      console.log(
        `[CommandInputBar] Enter detected with selection. Sending selected command: ${selectedCommand}`
      );
      emitWorkspaceEvent('terminal:sendCommand', { command: selectedCommand }); // 发送选中命令
      if (activeSessionId.value) {
        updateSessionCommandInput(activeSessionId.value, ''); // 清空输入框
      }
      resetSelection?.(); // 重置列表选中状态
      return; // 阻止后续的 Enter 处理
    }
    // 如果没有选中项，则继续执行下面的默认 Enter 逻辑
  }
  // --- 结束：优先处理 Enter 键执行选中项 ---

  if (event.ctrlKey && event.key === 'f') {
    event.preventDefault(); // 阻止浏览器默认的查找行为
    isSearching.value = true;
    nextTick(() => {
      searchInputRef.value?.focus();
    });
  } else if (event.key === 'ArrowUp') {
    const target = commandInputSyncTarget.value;
    if (target === 'quickCommands') {
      event.preventDefault();
      quickCommandsStore.selectPreviousCommand();
    } else if (target === 'commandHistory') {
      event.preventDefault();
      commandHistoryStore.selectPreviousCommand();
    }
  } else if (event.key === 'ArrowDown') {
    const target = commandInputSyncTarget.value;
    if (target === 'quickCommands') {
      event.preventDefault();
      quickCommandsStore.selectNextCommand();
    } else if (target === 'commandHistory') {
      event.preventDefault();
      commandHistoryStore.selectNextCommand();
    }
  } else if (event.ctrlKey && event.key === 'c' && currentSessionCommandInput.value === '') {
    // 检查计算属性的值
    // Handle Ctrl+C when input is empty
    event.preventDefault();
    console.log('[CommandInputBar] Ctrl+C detected with empty input. Sending SIGINT.');
    emitWorkspaceEvent('terminal:sendCommand', { command: '\x03' }); // Send ETX character (Ctrl+C)
  } else if (!event.altKey && event.key === 'Enter') {
    // Handle regular Enter key press - send current input (empty or not)
    event.preventDefault(); // Prevent default if needed, e.g., form submission
    sendCommand(); // Call the existing sendCommand function
  } else {
    // --- 处理其他按键，取消列表选中状态 ---
    // 检查按下的键是否是普通输入键或删除键等，而不是导航键或修饰键
    if (
      ![
        'ArrowUp',
        'ArrowDown',
        'Enter',
        'Shift',
        'Control',
        'Alt',
        'Meta',
        'Tab',
        'Escape',
      ].includes(event.key)
    ) {
      const target = commandInputSyncTarget.value;
      if (target === 'quickCommands' && quickCommandsSelectedIndex.value >= 0) {
        resetQuickCommandsSelection();
      } else if (target === 'commandHistory' && historySelectedIndex.value >= 0) {
        resetHistorySelection();
      }
    }
  }
};

//  Handle blur event on command input
const handleCommandInputBlur = () => {
  // Reset selection in the target store when input loses focus
  const target = commandInputSyncTarget.value;
  if (target === 'quickCommands') {
    resetQuickCommandsSelection();
  } else if (target === 'commandHistory') {
    resetHistorySelection();
  }
};

// +++ 监听 Store 中的触发器以激活终端搜索 +++
watch(
  () => focusSwitcherStore.activateTerminalSearchTrigger,
  () => {
    if (focusSwitcherStore.activateTerminalSearchTrigger > 0 && !isSearching.value) {
      console.log('[CommandInputBar] Received terminal search activation trigger from store.');
      toggleSearch(); // 调用组件内部的切换搜索方法来激活
    }
  }
);

// --- Focus Actions ---
const focusCommandInput = (): boolean => {
  if (commandInputRef.value) {
    commandInputRef.value.focus();
    return true;
  }
  return false;
};

const focusSearchInput = (): boolean => {
  if (!isSearching.value) {
    // If search is not active, activate it first
    toggleSearch(); // This might need nextTick if toggleSearch is async
    nextTick(() => {
      // Ensure DOM is updated after toggleSearch
      if (searchInputRef.value) {
        searchInputRef.value.focus();
      }
    });
    // Since focusing might be async after toggle, we optimistically return true
    // or adjust based on toggleSearch's behavior. For simplicity, assume it works.
    return true;
  } else if (searchInputRef.value) {
    searchInputRef.value.focus();
    return true;
  }
  return false;
};

defineExpose({ focusCommandInput, focusSearchInput });

// --- Register/Unregister Focus Actions ---
let unregisterCommandInputFocus: (() => void) | null = null;
let unregisterTerminalSearchFocus: (() => void) | null = null;

onMounted(() => {
  unregisterCommandInputFocus = focusSwitcherStore.registerFocusAction(
    'commandInput',
    focusCommandInput
  );
  unregisterTerminalSearchFocus = focusSwitcherStore.registerFocusAction(
    'terminalSearch',
    focusSearchInput
  );
});

onBeforeUnmount(() => {
  if (unregisterCommandInputFocus) {
    unregisterCommandInputFocus();
  }
  if (unregisterTerminalSearchFocus) {
    unregisterTerminalSearchFocus();
  }
});

// +++ Functions to control the quick commands modal +++
const openQuickCommandsModal = () => {
  showQuickCommands.value = true;
};

const closeQuickCommandsModal = () => {
  showQuickCommands.value = false;
};

// +++ Functions to control the suspended SSH sessions modal +++
const openSuspendedSshSessionsModal = () => {
  showSuspendedSshSessionsModal.value = true;
};

const closeSuspendedSshSessionsModal = () => {
  showSuspendedSshSessionsModal.value = false;
};

// +++ Function to request opening the file manager modal via event bus +++
const openFileManagerModal = () => {
  if (activeSessionId.value) {
    console.log(
      `[CommandInputBar] Emitting fileManager:openModalRequest for session: ${activeSessionId.value}`
    );
    emitWorkspaceEvent('fileManager:openModalRequest', { sessionId: activeSessionId.value });
  } else {
    console.warn('[CommandInputBar] Cannot open file manager modal: No active session ID.');
    // Optionally, show a notification to the user
  }
};

// +++ Function to request opening the file editor modal +++
const openFileEditorModal = () => {
  if (activeSessionId.value) {
    console.log(`[CommandInputBar] Triggering popup editor for session: ${activeSessionId.value}`);
    fileEditorStore.triggerPopup('', activeSessionId.value); // Call store action directly
  } else {
    console.warn('[CommandInputBar] Cannot open file editor modal: No active session ID.');
    // Optionally, show a notification to the user
  }
};

// +++ Handler for command execution from the modal +++
const handleQuickCommandExecute = (command: string) => {
  console.log(`[CommandInputBar] Executing quick command: ${command}`);
  emitWorkspaceEvent('terminal:sendCommand', { command }); // Emit the command to the parent
  closeQuickCommandsModal(); // Close the modal after selection
};
</script>

<template>
  <div :class="$attrs.class" class="flex items-center py-1.5 bg-background">
    <!-- Bind $attrs.class, removed px-2 and gap-1 -->
    <div class="flex-grow flex items-center bg-transparent relative gap-1 px-2 w-full">
      <!-- Added px-2 here, ensure full width -->
      <!-- Clear Terminal Button -->
      <button
        @click="emitWorkspaceEvent('terminal:clear')"
        class="flex-shrink-0 flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
        :title="t('commandInputBar.clearTerminal', '清空终端')"
      >
        <i class="fas fa-eraser text-base"></i>
      </button>
      <!-- +++ Quick Commands Button (Mobile only) +++ -->
      <button
        v-if="props.isMobile"
        @click="openQuickCommandsModal"
        class="flex-shrink-0 flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
        :title="t('quickCommands.title', '快捷指令')"
      >
        <i class="fas fa-bolt text-base"></i>
      </button>
      <!-- Focus Switcher Config Button (Hide on mobile) -->
      <button
        v-if="!props.isMobile"
        @click="focusSwitcherStore.toggleConfigurator(true)"
        class="flex-shrink-0 flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
        :title="t('commandInputBar.configureFocusSwitch', '配置焦点切换')"
      >
        <i class="fas fa-keyboard text-base"></i>
        <!-- Removed text-primary -->
      </button>
      <!-- Command Input (Hide on mobile when searching) -->
      <input
        v-if="!props.isMobile || !isSearching"
        type="text"
        v-model="currentSessionCommandInput"
        :placeholder="t('commandInputBar.placeholder')"
        class="flex-grow min-w-0 px-4 py-1.5 border border-border/50 rounded-lg bg-input text-foreground text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 ease-in-out"
        :class="{
          'basis-3/4': !props.isMobile && isSearching, // Desktop searching: 3/4 width
          'basis-full': !props.isMobile && !isSearching, // Desktop non-searching: full width
          'w-0': props.isMobile, // Mobile non-searching: adjust width to fit
        }"
        ref="commandInputRef"
        data-focus-id="commandInput"
        @keydown="handleCommandInputKeydown"
        @blur="handleCommandInputBlur"
      />

      <!-- Search Input (Show when searching, adjust width on mobile) -->
      <input
        v-if="isSearching"
        type="text"
        v-model="searchTerm"
        :placeholder="t('commandInputBar.searchPlaceholder')"
        class="flex-grow min-w-0 px-4 py-1.5 border border-border/50 rounded-lg bg-input text-foreground text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300 ease-in-out"
        :class="{ 'basis-1/4': !props.isMobile, 'w-0': props.isMobile }"
        data-focus-id="terminalSearch"
        @keydown.enter.prevent="findNext"
        @keydown.shift.enter.prevent="findPrevious"
        @keydown.up.prevent="findPrevious"
        @keydown.down.prevent="findNext"
        ref="searchInputRef"
      />

      <!-- Search Controls -->
      <div class="flex items-center gap-1 flex-shrink-0">
        <!-- +++ Toggle Virtual Keyboard Button (Moved here, Mobile only) +++ -->
        <!-- +++ Suspended SSH Sessions Button (Mobile only, new position) +++ -->
        <button
          v-if="props.isMobile"
          @click="openSuspendedSshSessionsModal"
          class="flex-shrink-0 flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
          :title="t('suspendedSshSessions.title', '挂起会话')"
        >
          <i class="fas fa-pause-circle text-base"></i>
        </button>
        <!-- +++ Toggle Virtual Keyboard Button (Mobile only) +++ -->
        <button
          v-if="props.isMobile"
          @click="emit('toggle-virtual-keyboard')"
          class="flex-shrink-0 flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
          :title="
            props.isVirtualKeyboardVisible
              ? t('commandInputBar.hideKeyboard', '隐藏虚拟键盘')
              : t('commandInputBar.showKeyboard', '显示虚拟键盘')
          "
        >
          <i
            class="fas fa-keyboard text-base"
            :class="{ 'opacity-50': !props.isVirtualKeyboardVisible }"
          ></i>
        </button>
        <!-- AI Assistant Toggle Button -->
        <button
          v-if="!props.isMobile"
          @click="openNL2CMDPanel"
          class="flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
          :title="isNL2CMDEnabled ? 'AI 助手 (Ctrl+I)' : '请在设置中启用 AI 助手'"
          :disabled="!isNL2CMDEnabled"
          :class="{ 'opacity-50': !isNL2CMDEnabled }"
        >
          <i class="fas fa-magic text-base"></i>
        </button>
        <!-- Search Toggle Button -->
        <button
          v-if="!props.isMobile"
          @click="toggleSearch"
          class="flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
          :title="isSearching ? t('commandInputBar.closeSearch') : t('commandInputBar.openSearch')"
        >
          <i v-if="!isSearching" class="fas fa-search text-base"></i>
          <i v-else class="fas fa-times text-base"></i>
        </button>

        <!-- Search navigation buttons (Hide on mobile when searching) -->
        <template v-if="isSearching && !props.isMobile">
          <!-- +++ Add !props.isMobile condition +++ -->
          <button
            @click="findPrevious"
            class="flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
            :title="t('commandInputBar.findPrevious')"
          >
            <i class="fas fa-arrow-up text-base"></i>
          </button>
          <button
            @click="findNext"
            class="flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
            :title="t('commandInputBar.findNext')"
          >
            <i class="fas fa-arrow-down text-base"></i>
          </button>
        </template>
        <!-- File Manager Button -->
        <button
          v-if="showPopupFileManagerBoolean || props.isMobile"
          @click="openFileManagerModal"
          class="flex-shrink-0 flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
        >
          <i class="fas fa-folder text-base"></i>
        </button>
        <!-- File Editor Button -->
        <button
          v-if="showPopupFileEditorBoolean || props.isMobile"
          @click="openFileEditorModal"
          class="flex-shrink-0 flex items-center justify-center w-8 h-8 border border-border/50 rounded-lg text-text-secondary transition-colors duration-200 hover:bg-border hover:text-foreground"
        >
          <i class="fas fa-edit text-base"></i>
        </button>
        <!-- Note: On mobile, when searching, only the close button (inside toggleSearch button logic) will be effectively visible in this control group -->
      </div>
    </div>
  </div>
  <!-- +++ Quick Commands Modal Instance +++ -->
  <QuickCommandsModal
    :is-visible="showQuickCommands"
    @close="closeQuickCommandsModal"
    @execute-command="handleQuickCommandExecute"
  />
  <!-- +++ Suspended SSH Sessions Modal Instance +++ -->
  <SuspendedSshSessionsModal
    :is-visible="showSuspendedSshSessionsModal"
    @close="closeSuspendedSshSessionsModal"
  />
  <!-- File Manager Modal is now handled by a listener for 'fileManager:openModalRequest' event -->

  <!-- +++ AI Assistant Panel +++ -->
  <Teleport to="body">
    <transition name="nl2cmd-fade">
      <div v-if="nl2cmdVisible" class="nl2cmd-overlay" @click.self="closeNL2CMDPanel">
        <div class="nl2cmd-content">
          <div class="nl2cmd-input-container">
            <div class="nl2cmd-icon-wrapper">
              <span v-if="nl2cmdLoading" class="animate-spin">⏳</span>
              <span v-else>✨</span>
            </div>
            <textarea
              ref="nl2cmdInputRef"
              v-model="nl2cmdQuery"
              class="nl2cmd-input"
              placeholder="AI 助手：描述您想要执行的操作..."
              rows="1"
              @keydown="handleNL2CMDTextareaKeydown"
              @input="
                (e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                }
              "
            ></textarea>
            <div class="nl2cmd-actions">
              <button class="nl2cmd-action-btn" @click="submitNL2CMD" title="生成命令 (Ctrl+Enter)">
                ↩
              </button>
            </div>
          </div>
          <div class="nl2cmd-hint-bar">
            <span>使用自然语言描述操作，AI 将自动生成命令</span>
            <span class="keys"> <kbd>Esc</kbd> 关闭 </span>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
/* Scoped styles removed for Tailwind CSS refactoring */

/* NL2CMD Panel Styles - Compact Spotlight Style */
.nl2cmd-fade-enter-active,
.nl2cmd-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.nl2cmd-fade-enter-from,
.nl2cmd-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.nl2cmd-overlay {
  position: absolute;
  bottom: 80px; /* Show near bottom, above command bar */
  left: 50%;
  transform: translateX(-50%);
  width: 500px;
  max-width: 90%;
  z-index: 2000; /* High z-index */
}

.nl2cmd-content {
  background: var(--bg-secondary); /* Ensure this maps to a solid color */
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.nl2cmd-input-container {
  display: flex;
  align-items: flex-start;
  padding: 12px;
  gap: 10px;
  background: var(--bg-primary); /* Ensure contrast */
}

.nl2cmd-icon-wrapper {
  padding-top: 2px;
  font-size: 18px;
  width: 24px;
  text-align: center;
}

.nl2cmd-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.5;
  padding: 2px 0;
  resize: none;
  outline: none;
  font-family: inherit;
  min-height: 24px;
  max-height: 120px;
}

.nl2cmd-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.7;
}

.nl2cmd-actions {
  display: flex;
  align-items: flex-start;
  padding-top: 0;
}

.nl2cmd-action-btn {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.nl2cmd-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nl2cmd-hint-bar {
  padding: 6px 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-tertiary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nl2cmd-hint-bar .keys kbd {
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  margin-left: 4px;
  border: 1px solid var(--border-color);
}

.animate-spin {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
