import { ref, watch, nextTick, type ComponentPublicInstance } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GroupedQuickCommands } from '../stores/quickCommands.store';
import { useQuickCommandsStore } from '../stores/quickCommands.store';
import { useQuickCommandTagsStore } from '../stores/quickCommandTags.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { log } from '@/utils/log';

/**
 * 快捷指令标签行内编辑 composable
 * 管理标签编辑状态、输入框聚焦、创建/更新标签等逻辑
 */
export function useQuickCommandTagEditing() {
  const quickCommandsStore = useQuickCommandsStore();
  const quickCommandTagsStore = useQuickCommandTagsStore();
  const uiNotificationsStore = useUiNotificationsStore();
  const { t } = useI18n();

  // 编辑状态
  const editingTagId = ref<number | null | 'untagged'>(null);
  const editedTagName = ref('');
  const tagInputRefs = ref(new Map<string | number, HTMLInputElement | null>());

  /**
   * 设置标签输入框的 ref 引用
   */
  const setTagInputRef = (el: Element | ComponentPublicInstance | null, id: string | number) => {
    let inputEl: HTMLInputElement | null = null;
    if (el instanceof HTMLInputElement) {
      inputEl = el;
    } else if (
      el &&
      typeof el === 'object' &&
      '$el' in el &&
      (el as { $el?: unknown }).$el instanceof HTMLInputElement
    ) {
      inputEl = (el as { $el: HTMLInputElement }).$el;
    }

    if (inputEl) {
      tagInputRefs.value.set(id, inputEl);
      return;
    }

    tagInputRefs.value.delete(id);
  };

  /**
   * 开始编辑标签
   */
  const startEditingTag = (tagId: number | null, currentName: string) => {
    editingTagId.value = tagId === null ? 'untagged' : tagId;
    editedTagName.value = tagId === null ? '' : currentName;
  };

  /**
   * 完成标签编辑（创建新标签或更新已有标签）
   */
  const finishEditingTag = async (
    filteredAndGroupedCommands: GroupedQuickCommands[],
    expandedGroups: Record<string, boolean>,
  ) => {
    const currentEditingId = editingTagId.value;
    const newName = editedTagName.value.trim();
    const originalGroup = filteredAndGroupedCommands.find((g) => g.tagId === currentEditingId);

    // 基础校验：空名称直接取消
    if (newName === '' && currentEditingId !== 'untagged') {
      cancelEditingTag();
      return;
    }
    if (newName === '' && currentEditingId === 'untagged') {
      cancelEditingTag();
      return;
    }

    try {
      if (currentEditingId === 'untagged') {
        // --- 创建新标签并分配命令 ---
        log.info(`[useQuickCommandTagEditing] Creating new tag: ${newName}`);
        const newTag = await quickCommandTagsStore.addTag(newName);
        if (newTag) {
          uiNotificationsStore.showSuccess(t('quickCommands.tags.createSuccess'));
          const untaggedGroup = filteredAndGroupedCommands.find((g) => g.tagId === null);
          const commandIdsToAssign = untaggedGroup ? untaggedGroup.commands.map((c) => c.id) : [];

          if (commandIdsToAssign.length > 0) {
            log.info(
              `[useQuickCommandTagEditing] Assigning ${commandIdsToAssign.length} commands to new tag ID: ${newTag.id}`,
            );
            const assignSuccess = await quickCommandsStore.assignCommandsToTagAction(
              commandIdsToAssign,
              newTag.id,
            );
            if (assignSuccess) {
              log.info(`[useQuickCommandTagEditing] assignCommandsToTagAction reported success.`);
            } else {
              log.error(`[useQuickCommandTagEditing] assignCommandsToTagAction reported failure.`);
            }
          } else {
            uiNotificationsStore.showInfo(t('quickCommands.tags.noCommandsToAssign'));
          }

          // 更新展开组状态
          const untaggedGroupName = t('quickCommands.untagged', '未标记');
          if (expandedGroups[untaggedGroupName] !== undefined) {
            const currentState = expandedGroups[untaggedGroupName];
            delete expandedGroups[untaggedGroupName]; // eslint-disable-line no-param-reassign
            expandedGroups[newName] = currentState; // eslint-disable-line no-param-reassign
          }
        }
      } else if (typeof currentEditingId === 'number') {
        // --- 更新已有标签 ---
        const originalTagName = originalGroup?.groupName;
        if (!originalTagName) {
          log.error(
            `[useQuickCommandTagEditing] Cannot find original group name for tag ID ${currentEditingId}`,
          );
          cancelEditingTag();
          return;
        }
        if (originalTagName === newName) {
          // 名称未变化
        } else {
          log.info(
            `[useQuickCommandTagEditing] Updating tag ID ${currentEditingId} from "${originalTagName}" to "${newName}"`,
          );
          const updateResult = await quickCommandTagsStore.updateTag(currentEditingId, newName);
          if (updateResult) {
            // 更新展开组状态
            if (expandedGroups[originalTagName] !== undefined) {
              const currentState = expandedGroups[originalTagName];
              delete expandedGroups[originalTagName]; // eslint-disable-line no-param-reassign
              expandedGroups[newName] = currentState; // eslint-disable-line no-param-reassign
            }
            await quickCommandsStore.fetchQuickCommands();
          }
        }
      }
    } catch (error: unknown) {
      log.error('[useQuickCommandTagEditing] Error during finishEditingTag:', error);
      uiNotificationsStore.showError(t('common.unexpectedError'));
    } finally {
      editingTagId.value = null;
    }
  };

  /**
   * 取消标签编辑
   */
  const cancelEditingTag = () => {
    editingTagId.value = null;
  };

  // 监听编辑状态变化，自动聚焦输入框
  watch(editingTagId, async (newId) => {
    if (newId !== null) {
      await nextTick();
      const inputRef = tagInputRefs.value.get(newId);
      if (inputRef) {
        inputRef.focus();
        inputRef.select();
      } else {
        log.error(`[useQuickCommandTagEditing] Watcher: Input ref for ID ${newId} not found.`);
      }
    }
  });

  return {
    editingTagId,
    editedTagName,
    tagInputRefs,
    setTagInputRef,
    startEditingTag,
    finishEditingTag,
    cancelEditingTag,
  };
}
