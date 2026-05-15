import { computed, type Ref } from 'vue';
import { useVirtualList } from '@vueuse/core';

/**
 * Create a reusable virtual list setup that virtualizes a reactive array and provides a computed overscan when not supplied.
 *
 * @param dataSource - Ref to the source array to virtualize.
 * @param options - Configuration options.
 * @param options.itemHeight - Item height in pixels, either a fixed number or a function returning the current height.
 * @param options.overscan - Optional explicit overscan count; when omitted an automatic value is computed from `itemHeight` as Math.ceil(200 / height) and clamped to the range 5–15.
 * @returns The virtual list controls and binding props: `list`, `containerProps`, `wrapperProps`, and `scrollTo`.
 */
export function useVirtualListSetup<T>(
  dataSource: Ref<T[]>,
  options: {
    /** 每项高度（px），支持固定数值或动态函数 */
    itemHeight: number | (() => number);
    /** overscan 预渲染数量，默认自动缩放 */
    overscan?: number;
  }
) {
  const { itemHeight, overscan: overscanOverride } = options;

  // 自动 overscan 缩放：根据行高动态调整预渲染数量，平衡滚动流畅度与渲染开销
  const resolvedOverscan = computed(() => {
    if (overscanOverride !== undefined) return overscanOverride;
    const height = typeof itemHeight === 'function' ? itemHeight() : itemHeight;
    return Math.min(15, Math.max(5, Math.ceil(200 / height)));
  });

  const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(dataSource, {
    itemHeight,
    overscan: resolvedOverscan.value,
  });

  return {
    /** 虚拟列表渲染数据 */
    list,
    /** 绑定到滚动容器的属性 */
    containerProps,
    /** 绑定到内容包装器的属性 */
    wrapperProps,
    /** 滚动到指定索引 */
    scrollTo,
  };
}
