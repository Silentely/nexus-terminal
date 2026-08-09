/**
 * composables/useConfirmDialog 单元测试
 * 覆盖确认对话框的 store 委托与默认值逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, fallback?: string) => fallback || key }),
}));

const mockShowDialog = vi.fn();
const mockSetLoading = vi.fn();

vi.mock('../stores/dialog.store', () => ({
  useDialogStore: () => ({
    showDialog: mockShowDialog,
    setLoading: mockSetLoading,
  }),
}));

import { useConfirmDialog } from './useConfirmDialog';

describe('useConfirmDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockShowDialog.mockReset();
    mockSetLoading.mockReset();
  });

  it('showConfirmDialog 应委托 dialogStore.showDialog', () => {
    mockShowDialog.mockResolvedValue(true);
    const { showConfirmDialog } = useConfirmDialog();

    const result = showConfirmDialog({ title: '删除', message: '确认删除？' });
    expect(mockShowDialog).toHaveBeenCalledWith({
      title: '删除',
      message: '确认删除？',
      confirmText: undefined,
      cancelText: undefined,
    });
    return expect(result).resolves.toBe(true);
  });

  it('showConfirmDialog 无 title 时应使用默认标题', () => {
    const { showConfirmDialog } = useConfirmDialog();

    showConfirmDialog({ message: '确认？' });
    expect(mockShowDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: '请确认', message: '确认？' }),
    );
  });

  it('confirmAction 应使用默认标题与简化参数', () => {
    mockShowDialog.mockResolvedValue(false);
    const { confirmAction } = useConfirmDialog();

    confirmAction('删除此连接？');
    expect(mockShowDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: '请确认', message: '删除此连接？' }),
    );
  });

  it('confirmAction 可传入自定义标题', () => {
    mockShowDialog.mockResolvedValue(true);
    const { confirmAction } = useConfirmDialog();

    confirmAction('删除此连接？', '危险操作');
    expect(mockShowDialog).toHaveBeenCalledWith(expect.objectContaining({ title: '危险操作' }));
  });

  it('setDialogLoading 应委托 dialogStore.setLoading', () => {
    const { setDialogLoading } = useConfirmDialog();

    setDialogLoading(true);
    expect(mockSetLoading).toHaveBeenCalledWith(true);
  });
});
