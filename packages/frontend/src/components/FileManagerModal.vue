<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import FileManager from './FileManager.vue';
import type { WebSocketDependencies } from '../composables/useSftpActions';
import type { SessionState } from '../stores/session/types';
import { log } from '@/utils/log';

/**
 * @interface FileManagerModalProps
 * @description 文件管理器模态框所需的外部依赖（通过 props 传入）
 */
interface FileManagerModalProps {
  /** 当前是否为移动端 */
  isMobile: boolean;
  /** 获取 session 的函数 */
  getSession: (sessionId: string) => SessionState | undefined;
  /** 获取 session 连接名称的函数 */
  getSessionName: (sessionId: string) => string;
  /** 显示错误通知的函数 */
  showError: (message: string) => void;
  /** i18n 翻译函数 */
  t: (key: string, fallback?: string) => string;
}

const props = defineProps<FileManagerModalProps>();

// --- 状态 ---
const showFileManagerModal = ref(false);
const fileManagerPropsMap = shallowRef<
  Map<
    string,
    {
      sessionId: string;
      instanceId: string;
      dbConnectionId: string;
      wsDeps: WebSocketDependencies;
    }
  >
>(new Map());
const currentFileManagerSessionId = ref<string | null>(null);

/**
 * 打开文件管理器模态框
 * 由父组件通过 defineExpose 调用
 */
const open = (sessionId: string) => {
  const session = props.getSession(sessionId);
  if (!session) {
    log.error(`[FileManagerModal] Cannot open file manager: Session ${sessionId} not found.`);
    props.showError(props.t('workspace.errors.sessionNotFound'));
    return;
  }

  // 1. 获取 dbConnectionId
  const dbConnectionId = session.connectionId;
  if (!dbConnectionId) {
    log.error(
      `[FileManagerModal] Cannot open file manager: Missing dbConnectionId for session ${sessionId}.`,
    );
    props.showError(props.t('workspace.errors.missingConnectionId'));
    return;
  }

  // 2. 获取 wsDeps
  if (!session.wsManager) {
    log.error(
      `[FileManagerModal] Cannot open file manager: wsManager not found for session ${sessionId}.`,
    );
    props.showError(props.t('workspace.errors.wsManagerNotFound'));
    return;
  }
  const wsDeps: WebSocketDependencies = {
    sendMessage: session.wsManager.sendMessage,
    onMessage: session.wsManager.onMessage,
    isConnected: session.wsManager.isConnected,
    isSftpReady: session.wsManager.isSftpReady,
  };

  // 3. 生成或获取 instanceId
  const currentProps = fileManagerPropsMap.value.get(sessionId);
  const instanceId = currentProps ? currentProps.instanceId : `fm-modal-${sessionId}`;

  // 4. 设置 props 并显示模态框
  const newProps = {
    sessionId,
    instanceId,
    dbConnectionId: String(dbConnectionId),
    wsDeps,
  };
  fileManagerPropsMap.value.set(sessionId, newProps);
  currentFileManagerSessionId.value = sessionId;
  showFileManagerModal.value = true;
  log.info(
    `[FileManagerModal] Opening FileManager modal with props for session ${sessionId}:`,
    newProps,
  );
};

/**
 * 处理来自工作区事件的打开请求
 */
const handleFileManagerOpenRequest = (payload: { sessionId: string }) => {
  open(payload.sessionId);
};

/**
 * 关闭文件管理器模态框
 */
const closeFileManagerModal = () => {
  showFileManagerModal.value = false;
  log.info('[FileManagerModal] FileManager modal hidden (kept alive).');
};

/** 清理指定会话的文件管理器实例（会话关闭时调用，避免内存泄漏） */
const removeSession = (sessionId: string) => {
  fileManagerPropsMap.value.delete(sessionId);
  fileManagerPropsMap.value = new Map(fileManagerPropsMap.value);
  log.info(`[FileManagerModal] Cleaned up FileManager for session ${sessionId}.`);
};

defineExpose({
  open,
  handleFileManagerOpenRequest,
  removeSession,
});
</script>

<template>
  <!-- FileManager Modal Container -->
  <div
    v-show="
      showFileManagerModal &&
      currentFileManagerSessionId &&
      fileManagerPropsMap.get(currentFileManagerSessionId)
    "
    class="fixed inset-0 flex items-center justify-center z-50 p-4"
    :style="{ backgroundColor: 'var(--overlay-bg-color)' }"
    @click.self="closeFileManagerModal"
  >
    <div
      class="bg-background rounded-lg shadow-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden border border-border"
    >
      <div
        class="flex justify-between items-center p-3 border-b border-border flex-shrink-0 bg-header"
      >
        <h2 class="text-lg font-semibold text-foreground">
          {{ t('fileManager.modalTitle', '文件管理器') }} ({{
            currentFileManagerSessionId ? getSessionName(currentFileManagerSessionId) : '未知会话'
          }})
        </h2>
        <button
          @click="closeFileManagerModal"
          class="text-text-secondary hover:text-foreground transition-colors"
          :aria-label="props.t('common.close', '关闭文件管理器')"
        >
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      <div class="flex-grow overflow-hidden">
        <template
          v-for="propsData in fileManagerPropsMap.values()"
          :key="`${propsData.sessionId}-${isMobile}`"
        >
          <div v-show="propsData.sessionId === currentFileManagerSessionId" class="h-full">
            <FileManager
              :session-id="propsData.sessionId"
              :instance-id="propsData.instanceId"
              :db-connection-id="propsData.dbConnectionId"
              :ws-deps="propsData.wsDeps"
              :is-mobile="isMobile"
              class="h-full"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
