/**
 * composables/useAlertDialog 单元测试
 * 覆盖警告对话框的创建、挂载、确定回调与关闭路径
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock AlertDialog 组件：捕获 props 并暴露触发回调的桩
const capturedProps: Array<Record<string, unknown>> = [];
let triggerOnOk: (() => void) | null = null;
let triggerClose: (() => void) | null = null;

vi.mock('../components/common/AlertDialog.vue', () => ({
  default: {
    name: 'AlertDialog',
    props: ['visible', 'title', 'message', 'okText', 'onOk', 'onUpdate:visible'],
    setup(props: Record<string, unknown>) {
      capturedProps.push(props);
      triggerOnOk = props.onOk as () => void;
      triggerClose = () => (props['onUpdate:visible'] as (v: boolean) => void)(false);
      return () => null;
    },
  },
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, fallback?: string) => fallback || key }),
}));

import { useAlertDialog } from './useAlertDialog';

describe('useAlertDialog', () => {
  beforeEach(() => {
    capturedProps.length = 0;
    triggerOnOk = null;
    triggerClose = null;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('showAlertDialog 应挂载对话框并返回 Promise', () => {
    const { showAlertDialog } = useAlertDialog();
    const promise = showAlertDialog({ title: '错误', message: '操作失败' });

    expect(capturedProps).toHaveLength(1);
    expect(capturedProps[0].title).toBe('错误');
    expect(capturedProps[0].message).toBe('操作失败');
    expect(capturedProps[0].visible).toBe(true);
    expect(typeof promise.then).toBe('function');
  });

  it('点击确定应执行 onOk 并 resolve', async () => {
    const onOk = vi.fn();
    const { showAlertDialog } = useAlertDialog();
    const promise = showAlertDialog({ title: '确认', message: '继续？', onOk });

    triggerOnOk?.();
    await promise;

    expect(onOk).toHaveBeenCalledTimes(1);
    // 挂载容器应被移除
    expect(document.body.querySelector('div')).toBeNull();
  });

  it('关闭（Escape/点击外部）应 resolve 且不执行 onOk', async () => {
    const onOk = vi.fn();
    const { showAlertDialog } = useAlertDialog();
    const promise = showAlertDialog({ title: '确认', message: '继续？', onOk });

    triggerClose?.();
    await promise;

    expect(onOk).not.toHaveBeenCalled();
    expect(document.body.querySelector('div')).toBeNull();
  });

  it('未提供 okText 时应使用默认文本', () => {
    const { showAlertDialog } = useAlertDialog();
    showAlertDialog({ title: '提示', message: '内容' });

    expect(capturedProps[0].okText).toBe('确定');
  });
});
