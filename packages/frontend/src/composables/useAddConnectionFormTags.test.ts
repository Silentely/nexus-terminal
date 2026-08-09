/**
 * composables/useAddConnectionFormTags 单元测试
 * 覆盖标签创建（自动选中）与删除（确认对话框）逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, type Ref } from 'vue';
import { createTagHandlers, type TagDeps } from './useAddConnectionFormTags';
import type { TranslateFn } from '../types/i18n.types';

const t: TranslateFn = ((key: string, params?: Record<string, unknown>) => {
  if (params) {
    return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), key);
  }
  return key;
}) as TranslateFn;

function makeDeps(partial: Partial<TagDeps> = {}): TagDeps {
  const formData = { tag_ids: [1] };
  const deps: TagDeps = {
    formData,
    tags: ref([
      { id: 1, name: '运维' },
      { id: 2, name: '开发' },
    ]) as Ref<Array<{ id: number; name: string }>>,
    tagsStore: {
      addTag: vi.fn(),
      deleteTag: vi.fn(),
      error: null as string | null,
    } as unknown as TagDeps['tagsStore'],
    showConfirmDialog: vi.fn().mockResolvedValue(true),
    showAlertDialog: vi.fn(),
    t,
  };
  return { ...deps, ...partial };
}

describe('createTagHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleCreateTag 空名称应直接返回', async () => {
    const deps = makeDeps();
    const { handleCreateTag } = createTagHandlers(deps);

    await handleCreateTag('   ');
    expect(deps.tagsStore.addTag).not.toHaveBeenCalled();
  });

  it('handleCreateTag 应创建标签并自动选中', async () => {
    const deps = makeDeps();
    (deps.tagsStore.addTag as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 3, name: '测试' });
    const { handleCreateTag } = createTagHandlers(deps);

    await handleCreateTag('测试');

    expect(deps.tagsStore.addTag).toHaveBeenCalledWith('测试');
    expect(deps.formData.tag_ids).toContain(3);
  });

  it('handleCreateTag 已存在的标签不应重复选中', async () => {
    const deps = makeDeps();
    (deps.tagsStore.addTag as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 1, name: '运维' });
    const { handleCreateTag } = createTagHandlers(deps);

    await handleCreateTag('运维');

    expect(deps.formData.tag_ids).toEqual([1]); // 不重复添加
  });

  it('handleDeleteTag 不存在的标签应直接返回', async () => {
    const deps = makeDeps();
    const { handleDeleteTag } = createTagHandlers(deps);

    await handleDeleteTag(999);
    expect(deps.showConfirmDialog).not.toHaveBeenCalled();
  });

  it('handleDeleteTag 确认后应删除标签', async () => {
    const deps = makeDeps();
    (deps.tagsStore.deleteTag as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { handleDeleteTag } = createTagHandlers(deps);

    await handleDeleteTag(2);

    expect(deps.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('tags.prompts.confirmDelete') }),
    );
    expect(deps.tagsStore.deleteTag).toHaveBeenCalledWith(2);
  });

  it('handleDeleteTag 取消确认时不应删除', async () => {
    const deps = makeDeps({ showConfirmDialog: vi.fn().mockResolvedValue(false) });
    const { handleDeleteTag } = createTagHandlers(deps);

    await handleDeleteTag(2);
    expect(deps.tagsStore.deleteTag).not.toHaveBeenCalled();
  });

  it('handleDeleteTag 删除失败时应显示警告', async () => {
    const deps = makeDeps();
    (deps.tagsStore.deleteTag as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    deps.tagsStore.error = '数据库错误';
    const { handleDeleteTag } = createTagHandlers(deps);

    await handleDeleteTag(2);

    expect(deps.showAlertDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('tags.errorDelete') }),
    );
  });
});
