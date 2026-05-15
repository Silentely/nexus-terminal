import { computed, type Ref } from 'vue';
import { useVirtualList } from '@vueuse/core';

/**
 * Provide a reusable virtual-list setup with automatic overscan scaling.
 *
 * When `options.overscan` is omitted, computes an overscan based on `itemHeight`
 * as `clamp(ceil(200 / height), 5, 15)` to balance smoothness and render cost.
 *
 * @param dataSource - A `Ref` to the source array to be virtualized.
 * @param options.itemHeight - Item height in pixels, either a fixed number or a function returning the height.
 * @param options.overscan - Optional explicit overscan (number of items to prerender); when omitted an automatic value is computed.
 * @returns An object containing `list`, `containerProps`, `wrapperProps`, and `scrollTo` for driving a virtualized list.
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
