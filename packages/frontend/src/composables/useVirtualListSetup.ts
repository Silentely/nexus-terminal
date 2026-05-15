import { computed, type Ref } from 'vue';
import { useVirtualList } from '@vueuse/core';

/**
 * Provide a reusable virtual-list setup that wraps `useVirtualList` and exposes rendering bindings and a scroll helper.
 *
 * When `options.overscan` is omitted, the function computes an overscan value from `itemHeight` as `Math.ceil(200 / height)` and clamps it to the range [5, 15].
 *
 * @param dataSource - Reactive array `Ref` used as the list data source
 * @param options - Configuration for item sizing and optional overscan
 * @param options.itemHeight - Item height in pixels or a function that returns the height
 * @param options.overscan - Optional override for the number of items to pre-render around the viewport
 * @returns An object containing `list` (virtualized rendering rows), `containerProps` (props for the scroll container), `wrapperProps` (props for the inner wrapper), and `scrollTo` (function to scroll to a specific index)
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
