/**
 * composables/useQuickCommandTagEditing 单元测试
 * 覆盖快捷指令标签行内编辑：创建/更新/取消/校验分支
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => {
      if (key === 'quickCommands.untagged') return '未标记';
      return fallback || key;
    },
  }),
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockAddTag = vi.fn();
const mockUpdateTag = vi.fn();
const mockAssignCommandsToTagAction = vi.fn();
const mockFetchQuickCommands = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowInfo = vi.fn();
const mockShowError = vi.fn();

vi.mock('../stores/quickCommandTags.store', () => ({
  useQuickCommandTagsStore: () => ({ addTag: mockAddTag, updateTag: mockUpdateTag }),
}));

vi.mock('../stores/quickCommands.store', () => ({
  useQuickCommandsStore: () => ({
    assignCommandsToTagAction: mockAssignCommandsToTagAction,
    fetchQuickCommands: mockFetchQuickCommands,
  }),
}));

vi.mock('../stores/uiNotifications.store', () => ({
  useUiNotificationsStore: () => ({
    showSuccess: mockShowSuccess,
    showInfo: mockShowInfo,
    showError: mockShowError,
  }),
}));

import { useQuickCommandTagEditing } from './useQuickCommandTagEditing';

interface MockCommand {
  id: number;
  name: string;
}
interface MockGroup {
  tagId: number | null;
  groupName: string;
  commands: MockCommand[];
}

const untaggedGroup: MockGroup = {
  tagId: null,
  groupName: '未标记',
  commands: [
    { id: 1, name: 'ls' },
    { id: 2, name: 'pwd' },
  ],
};
const tagGroup: MockGroup = { tagId: 5, groupName: '运维', commands: [{ id: 3, name: 'df' }] };

describe('useQuickCommandTagEditing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockAddTag.mockReset();
    mockUpdateTag.mockReset();
    mockAssignCommandsToTagAction.mockReset();
    mockFetchQuickCommands.mockReset();
    mockShowSuccess.mockReset();
    mockShowInfo.mockReset();
    mockShowError.mockReset();
  });

  it('startEditingTag 应设置编辑状态', () => {
    const { startEditingTag, editingTagId, editedTagName } = useQuickCommandTagEditing();

    startEditingTag(5, '运维');
    expect(editingTagId.value).toBe(5);
    expect(editedTagName.value).toBe('运维');
  });

  it('startEditingTag(null) 应标记为 untagged 并清空名称', () => {
    const { startEditingTag, editingTagId, editedTagName } = useQuickCommandTagEditing();

    startEditingTag(null, '');
    expect(editingTagId.value).toBe('untagged');
    expect(editedTagName.value).toBe('');
  });

  it('cancelEditingTag 应清空编辑状态', () => {
    const { startEditingTag, cancelEditingTag, editingTagId } = useQuickCommandTagEditing();

    startEditingTag(5, '运维');
    cancelEditingTag();
    expect(editingTagId.value).toBeNull();
  });

  it('空名称编辑已有标签时应取消而非保存', async () => {
    const { startEditingTag, finishEditingTag, editingTagId, editedTagName } =
      useQuickCommandTagEditing();

    startEditingTag(5, '运维');
    editedTagName.value = '   '; // 空白名称
    await finishEditingTag([untaggedGroup, tagGroup], {});
    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(editingTagId.value).toBeNull();
  });

  it('创建新标签并分配未标记命令', async () => {
    mockAddTag.mockResolvedValue({ id: 9, name: '新组' });
    mockAssignCommandsToTagAction.mockResolvedValue(true);
    const { startEditingTag, finishEditingTag, editedTagName } = useQuickCommandTagEditing();

    startEditingTag(null, '');
    editedTagName.value = '新组';
    const expandedGroups: Record<string, boolean> = { 未标记: true };

    await finishEditingTag([untaggedGroup, tagGroup], expandedGroups);

    expect(mockAddTag).toHaveBeenCalledWith('新组');
    expect(mockAssignCommandsToTagAction).toHaveBeenCalledWith([1, 2], 9);
    expect(mockShowSuccess).toHaveBeenCalled();
    // 展开组状态应从"未标记"迁移到"新组"
    expect(expandedGroups['未标记']).toBeUndefined();
    expect(expandedGroups['新组']).toBe(true);
  });

  it('创建新标签时无未标记命令应提示', async () => {
    mockAddTag.mockResolvedValue({ id: 9, name: '新组' });
    const { startEditingTag, finishEditingTag, editedTagName } = useQuickCommandTagEditing();

    startEditingTag(null, '');
    editedTagName.value = '新组';
    await finishEditingTag([tagGroup], {});

    expect(mockShowInfo).toHaveBeenCalled();
  });

  it('更新已有标签名称并刷新命令列表', async () => {
    mockUpdateTag.mockResolvedValue(true);
    mockFetchQuickCommands.mockResolvedValue(undefined);
    const { startEditingTag, finishEditingTag, editedTagName } = useQuickCommandTagEditing();

    startEditingTag(5, '运维');
    editedTagName.value = '监控';
    const expandedGroups: Record<string, boolean> = { 运维: false };

    await finishEditingTag([untaggedGroup, tagGroup], expandedGroups);

    expect(mockUpdateTag).toHaveBeenCalledWith(5, '监控');
    expect(mockFetchQuickCommands).toHaveBeenCalled();
    expect(expandedGroups['运维']).toBeUndefined();
    expect(expandedGroups['监控']).toBe(false);
  });

  it('名称未变化时不应调用更新', async () => {
    const { startEditingTag, finishEditingTag } = useQuickCommandTagEditing();

    startEditingTag(5, '运维');
    await finishEditingTag([untaggedGroup, tagGroup], {});

    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it('更新失败时应静默保留编辑状态清理', async () => {
    mockUpdateTag.mockResolvedValue(false);
    const { startEditingTag, finishEditingTag, editingTagId, editedTagName } =
      useQuickCommandTagEditing();

    startEditingTag(5, '运维');
    editedTagName.value = '监控';
    await finishEditingTag([untaggedGroup, tagGroup], {});

    expect(mockUpdateTag).toHaveBeenCalledWith(5, '监控');
    expect(editingTagId.value).toBeNull();
  });

  it('异常时应显示错误通知', async () => {
    mockAddTag.mockRejectedValue(new Error('网络错误'));
    const { startEditingTag, finishEditingTag, editedTagName } = useQuickCommandTagEditing();

    startEditingTag(null, '');
    editedTagName.value = '新组';
    await finishEditingTag([untaggedGroup, tagGroup], {});

    expect(mockShowError).toHaveBeenCalled();
  });
});
