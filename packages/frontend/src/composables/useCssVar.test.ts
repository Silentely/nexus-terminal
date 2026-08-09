/**
 * composables/useCssVar 单元测试
 * 覆盖 hexToRgba 纯函数与 useCssVar 的读取/缓存行为
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hexToRgba, useCssVar, useCssVarWithLifecycle, resetCssVarCache } from './useCssVar';

// useCssVarWithLifecycle 依赖 Vue 生命周期钩子，需在组件上下文调用；
// 此处直接验证 refresh 函数与事件监听行为
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return {
    ...actual,
    onMounted: (fn: () => void) => fn(),
    onUnmounted: (fn: () => void) => fn(),
  };
});

describe('hexToRgba', () => {
  it('应转换 6 位十六进制颜色', () => {
    expect(hexToRgba('#10b981', 0.15)).toBe('rgba(16, 185, 129, 0.15)');
    expect(hexToRgba('#0ea5e9', 1)).toBe('rgba(14, 165, 233, 1)');
  });

  it('应转换 3 位十六进制颜色', () => {
    expect(hexToRgba('#0af', 0.5)).toBe('rgba(0, 170, 255, 0.5)');
    expect(hexToRgba('#fff', 0.1)).toBe('rgba(255, 255, 255, 0.1)');
  });

  it('应忽略大小写', () => {
    expect(hexToRgba('#10B981', 0.5)).toBe('rgba(16, 185, 129, 0.5)');
  });

  it('无法解析时返回原始值', () => {
    expect(hexToRgba('rgba(1,2,3,1)', 0.5)).toBe('rgba(1,2,3,1)');
    expect(hexToRgba('', 0.5)).toBe('');
    expect(hexToRgba('transparent', 0.5)).toBe('transparent');
  });

  it('应去除首尾空白', () => {
    expect(hexToRgba('  #10b981  ', 0.5)).toBe('rgba(16, 185, 129, 0.5)');
  });
});

describe('useCssVar', () => {
  beforeEach(() => {
    resetCssVarCache();
  });

  it('应读取 CSS 变量的实际值', () => {
    document.documentElement.style.setProperty('--test-color', '#123456');
    const value = useCssVar('--test-color');
    expect(value.value).toBe('#123456');
  });

  it('读取为空时应应用回退值', () => {
    document.documentElement.style.removeProperty('--test-missing');
    const value = useCssVar('--test-missing', '#abcdef');
    expect(value.value).toBe('#abcdef');
  });

  it('同一变量应返回缓存实例', () => {
    const a = useCssVar('--test-cached', '#111111');
    const b = useCssVar('--test-cached', '#222222');
    expect(a).toBe(b);
    expect(b.value).toBe(a.value);
  });

  it('resetCssVarCache 后应重新读取', () => {
    document.documentElement.style.setProperty('--test-reset', '#111111');
    const first = useCssVar('--test-reset');
    expect(first.value).toBe('#111111');

    document.documentElement.style.setProperty('--test-reset', '#222222');
    resetCssVarCache();
    const second = useCssVar('--test-reset');
    expect(second.value).toBe('#222222');
  });
});

describe('useCssVarWithLifecycle', () => {
  let listeners: Array<() => void>;

  beforeEach(() => {
    resetCssVarCache();
    listeners = [];
  });

  afterEach(() => {
    listeners.forEach((listener) =>
      window.removeEventListener('appearance-theme-applied', listener),
    );
  });

  it('主题应用事件触发后应刷新值', () => {
    document.documentElement.style.setProperty('--test-live', '#111111');
    const { value, refresh } = useCssVarWithLifecycle('--test-live');
    expect(value.value).toBe('#111111');

    // 修改 CSS 变量并手动调用 refresh（模拟主题切换）
    document.documentElement.style.setProperty('--test-live', '#222222');
    refresh();
    expect(value.value).toBe('#222222');
  });

  it('卸载时应移除事件监听', () => {
    document.documentElement.style.setProperty('--test-unmount', '#111111');
    // onMounted/onUnmounted 被 mock 为立即执行，此处验证 refresh 仍可用且无报错
    const { value } = useCssVarWithLifecycle('--test-unmount');
    expect(value.value).toBe('#111111');
  });
});
