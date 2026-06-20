/**
 * 标签行内编辑逻辑 composable
 *
 * 从 WorkspaceConnectionList.vue 中提取，提供标签名称的行内编辑能力：
 * - 编辑现有标签名称
 * - 为"未标记"分组创建新标签并批量分配
 * - 自动聚焦输入框
 */
import { ref, watch, nextTick, type ComponentPublicInstance } from 'vue';
import { log } from '@/utils/log';

export interface TagEditingDependencies {
  /** 获取标签列表（响应式） */
  tags: () => Array<{ id: number; name: string; created_at: number; updated_at: number }>;
  /** 添加标签，返回创建的标签或 null */
  addTag: (name: string) => Promise<{ id: number; name: string } | null>;
  /** 更新标签名称，返回是否成功 */
  updateTag: (id: number, name: string) => Promise<boolean>;
  /** 批量为连接添加标签，返回是否成功 */
  addTagToConnections: (connectionIds: number[], tagId: number) => Promise<boolean>;
  /** 获取"未标记"分组的连接 ID 列表 */
  getUntaggedConnectionIds: () => number[];
  /** 获取展开状态（响应式），用于在重命名后更新分组键名 */
  expandedGroups: () => Record<string, boolean>;
  /** 通知函数 */
  notify: (opts: { message: string; type: 'success' | 'error' | 'info' | 'warning' }) => void;
  /** 国际化翻译函数 */
  t: (key: string, params?: Record<string, unknown>) => string;
}

export function useTagEditing(deps: TagEditingDependencies) {
  /** 当前正在编辑的标签 ID，number 编辑现有标签，'untagged' 为未标记分组创建新标签，null 未编辑 */
  const editingTagId = ref<number | null | 'untagged'>(null);

  /** 编辑中的临时标签名称 */
  const editedTagName = ref('');

  /** 输入框 ref 映射表 */
  const tagInputRefs = ref(new Map<string | number, HTMLInputElement | null>());

  /**
   * 设置输入框 ref 到映射表中
   * 兼容直接 HTMLInputElement 和 Vue 组件实例（$el 为 input）
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

    if (!inputEl) {
      tagInputRefs.value.delete(id);
      return;
    }

    tagInputRefs.value.set(id, inputEl);
  };

  /**
   * 开始编辑标签（或准备为"未标记"分组创建新标签）
   * @param tagId 标签 ID，null 表示"未标记"分组
   * @param currentName 当前标签名称
   */
  const startEditingTag = (tagId: number | null, currentName: string) => {
    editingTagId.value = tagId === null ? 'untagged' : tagId;
    // 未标记组开始编辑时清空输入框，编辑现有标签则填入当前名称
    editedTagName.value = tagId === null ? '' : currentName;
  };

  /**
   * 完成编辑标签（保存更改或创建新标签并分配）
   * 包含完整的异步业务逻辑：创建标签、更新标签、批量分配连接
   */
  const finishEditingTag = async () => {
    const currentEditingId = editingTagId.value;
    const newName = editedTagName.value.trim();
    const tags = deps.tags();
    const originalTag =
      typeof currentEditingId === 'number' ? tags.find((t) => t.id === currentEditingId) : null;

    // 新名称为空则取消编辑
    if (newName === '') {
      editingTagId.value = null;
      return;
    }

    try {
      if (currentEditingId === 'untagged') {
        // --- 创建新标签并批量分配 ---
        const newTag = await deps.addTag(newName);
        if (newTag) {
          deps.notify({ message: deps.t('tags.createSuccess'), type: 'success' });

          const untaggedConnectionIds = deps.getUntaggedConnectionIds();

          if (untaggedConnectionIds.length > 0) {
            const assignSuccess = await deps.addTagToConnections(untaggedConnectionIds, newTag.id);
            if (assignSuccess) {
              deps.notify({
                message: deps.t('workspaceConnectionList.allConnectionsTaggedSuccess'),
                type: 'success',
              });
            } else {
              deps.notify({
                message: deps.t('workspaceConnectionList.allConnectionsTaggedFailed'),
                type: 'error',
              });
            }
          } else {
            deps.notify({
              message: deps.t('workspaceConnectionList.noConnectionsToTag'),
              type: 'info',
            });
          }

          // 更新展开状态：将"未标记"分组的展开状态迁移到新标签名下
          const untaggedGroupName = deps.t('workspaceConnectionList.untagged');
          const groups1 = deps.expandedGroups();
          if (groups1[untaggedGroupName] !== undefined) {
            const currentState = groups1[untaggedGroupName];
            delete groups1[untaggedGroupName];
            groups1[newName] = currentState;
          }
        }
      } else if (typeof currentEditingId === 'number') {
        // --- 更新现有标签 ---
        if (!originalTag) {
          log.error(`Tag with ID ${currentEditingId} not found for update.`);
        } else if (originalTag.name === newName) {
          // 名称未变，视为成功
        } else {
          const updateResult = await deps.updateTag(currentEditingId, newName);
          if (updateResult) {
            deps.notify({ message: deps.t('tags.updateSuccess'), type: 'success' });
            // 更新展开状态：将旧名称的展开状态迁移到新名称下
            const groups2 = deps.expandedGroups();
            if (groups2[originalTag.name] !== undefined) {
              const currentState = groups2[originalTag.name];
              delete groups2[originalTag.name];
              groups2[newName] = currentState;
            }
          }
        }
      }
    } catch (error: unknown) {
      log.error('Error during finishEditingTag:', error);
      deps.notify({ message: deps.t('common.unexpectedError'), type: 'error' });
    } finally {
      // 无论核心操作成功与否，最终都退出编辑模式
      editingTagId.value = null;
    }
  };

  /** 取消编辑（例如按 Esc 键） */
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
        log.error(
          `[useTagEditing] Watcher: Input ref for ID ${newId} not found in map after nextTick.`,
        );
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
