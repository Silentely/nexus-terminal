/**
 * useResizable 防御性守卫单元测试
 * 覆盖 handleMouseDown 中的 HTMLElement 类型守卫
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref, nextTick, defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { useResizable } from './useResizable';

describe('useResizable - handleMouseDown 防御性守卫', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('当 elementRef.value 为 null 时 composable 应正常初始化', () => {
    const elementRef = ref<HTMLElement | null>(null);

    const wrapper = mount(
      defineComponent({
        setup() {
          const result = useResizable(elementRef);
          return { ...result };
        },
        template: '<div />',
      }),
    );

    expect(wrapper.vm.isResizing).toBe(false);
    wrapper.unmount();
  });

  it('当 elementRef.value 为非 HTMLElement 对象时 handleMouseDown 应安全跳过', async () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          const elementRef = ref<HTMLElement | null>(null);
          const result = useResizable(elementRef, { edgeThreshold: 10 });
          return { ...result, elementRef };
        },
        template: '<div ref="elementRef" />',
      }),
    );

    await nextTick();

    const el = wrapper.vm.elementRef as HTMLElement;
    // 将 getBoundingClientRect 设为 null，使 el 不再像 HTMLElement 那样工作
    // 同时 mock getComputedStyle 防止 watcher 报错
    const originalGCS = window.getComputedStyle;
    window.getComputedStyle = vi.fn(
      () =>
        new Proxy({} as CSSStyleDeclaration, {
          get: () => '0',
        }),
    );

    // 替换 elementRef 为纯对象（模拟 Vue 组件实例而非 DOM 元素）
    wrapper.vm.elementRef = {
      getBoundingClientRect: vi.fn(),
      style: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    await nextTick();

    // dispatch event 不应抛出异常
    expect(() => {
      el.dispatchEvent(new MouseEvent('mousedown', { clientX: 5, clientY: 5, bubbles: true }));
    }).not.toThrow();

    expect(wrapper.vm.isResizing).toBe(false);
    window.getComputedStyle = originalGCS;
    wrapper.unmount();
  });

  it('当 elementRef 为有效 HTMLElement 且鼠标在边缘时应触发 resize 并调用 getBoundingClientRect', async () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          const elementRef = ref<HTMLElement | null>(null);
          const result = useResizable(elementRef, { edgeThreshold: 10 });
          return { ...result, elementRef };
        },
        template: '<div ref="elementRef" style="width:300px;height:200px;" />',
      }),
    );

    await nextTick();

    const el = wrapper.vm.elementRef as HTMLElement;
    const getBcrSpy = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));
    el.getBoundingClientRect = getBcrSpy;

    // 在右下角边缘触发 mousedown
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: 296, clientY: 196, bubbles: true }));
    await nextTick();

    expect(wrapper.vm.isResizing).toBe(true);
    expect(getBcrSpy).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('当 elementRef 为有效 HTMLElement 但鼠标在中间时不应触发 resize', async () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          const elementRef = ref<HTMLElement | null>(null);
          const result = useResizable(elementRef, { edgeThreshold: 10 });
          return { ...result, elementRef };
        },
        template: '<div ref="elementRef" style="width:300px;height:200px;" />',
      }),
    );

    await nextTick();

    const el = wrapper.vm.elementRef as HTMLElement;
    el.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));

    // 在元素中间触发 mousedown（远离边缘）
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: 150, clientY: 100, bubbles: true }));
    await nextTick();

    expect(wrapper.vm.isResizing).toBe(false);
    wrapper.unmount();
  });
});
