/**
 * 文件管理器剪贴板逻辑
 * 从 FileManager.vue 提取，负责文件的复制、剪切和粘贴操作
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { SftpManagerInstance } from '../../composables/useSftpActions';
import type { ClipboardState } from './useFileManagerContextMenu';
import { log } from '@/utils/log';

export interface UseFileManagerClipboardOptions {
  /** SFTP 管理器实例（响应式） */
  currentSftpManager: ComputedRef<SftpManagerInstance | null>;
  /** 选中项集合 */
  selectedItems: Ref<Set<string>>;
  /** 会话 ID（响应式，session:remapped 后自动更新） */
  sessionId: ComputedRef<string>;
  /** 实例 ID */
  instanceId: string;
}

export function useFileManagerClipboard(options: UseFileManagerClipboardOptions) {
  const { currentSftpManager, selectedItems, sessionId, instanceId } = options;

  const logPrefix = computed(() => `[FileManager ${sessionId.value}-${instanceId}]`);

  // --- 剪贴板状态 ---
  const clipboardState = ref<ClipboardState>({ hasContent: false });
  const clipboardSourcePaths = ref<string[]>([]);
  const clipboardSourceBaseDir = ref<string>('');

  /** 复制选中项到剪贴板 */
  const handleCopy = () => {
    const manager = currentSftpManager.value;
    if (!manager || selectedItems.value.size === 0) return;
    clipboardSourcePaths.value = Array.from(selectedItems.value).map((filename) =>
      manager.joinPath(manager.currentPath.value, filename),
    );
    clipboardState.value = { hasContent: true, operation: 'copy' };
    clipboardSourceBaseDir.value = manager.currentPath.value;
    log.info(`${logPrefix.value} Copied to clipboard:`, clipboardSourcePaths.value);
  };

  /** 剪切选中项到剪贴板 */
  const handleCut = () => {
    const manager = currentSftpManager.value;
    if (!manager || selectedItems.value.size === 0) return;
    clipboardSourcePaths.value = Array.from(selectedItems.value).map((filename) =>
      manager.joinPath(manager.currentPath.value, filename),
    );
    clipboardState.value = { hasContent: true, operation: 'cut' };
    clipboardSourceBaseDir.value = manager.currentPath.value;
    log.info(`${logPrefix.value} Cut to clipboard:`, clipboardSourcePaths.value);
  };

  /** 粘贴剪贴板内容到当前目录 */
  const handlePaste = () => {
    const manager = currentSftpManager.value;
    if (!manager || !clipboardState.value.hasContent || clipboardSourcePaths.value.length === 0)
      return;

    const destinationDir = manager.currentPath.value;
    const operation = clipboardState.value.operation;
    const sources = clipboardSourcePaths.value;
    const sourceBaseDir = clipboardSourceBaseDir.value;

    log.info(
      `${logPrefix.value} Pasting items. Operation: ${operation}, Sources: ${sources.join(', ')}, Destination: ${destinationDir}`,
    );

    if (operation === 'copy') {
      manager.copyItems(sources, destinationDir);
    } else if (operation === 'cut') {
      if (sourceBaseDir === destinationDir) {
        log.warn(`${logPrefix.value} Cannot cut and paste in the same directory.`);
        return;
      }
      manager.moveItems(sources, destinationDir);
      // 注意：moveItems 是 fire-and-forget（无返回值），此处同步清空剪贴板。
      // 若后端移动失败，用户将无法重试。理想方案需监听 sftp:move:success 事件后再清空。
      clipboardState.value = { hasContent: false };
      clipboardSourcePaths.value = [];
      clipboardSourceBaseDir.value = '';
    }
  };

  return {
    clipboardState,
    clipboardSourcePaths,
    clipboardSourceBaseDir,
    handleCopy,
    handleCut,
    handlePaste,
  };
}
