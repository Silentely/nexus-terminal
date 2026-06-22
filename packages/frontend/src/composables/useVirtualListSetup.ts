import { useVirtualList } from '@vueuse/core';
import type { Ref } from 'vue';

/**
 * Creates a reusable virtual-list setup that wraps useVirtualList and computes an appropriate overscan when not provided.
 *
 * @param dataSource - A Ref to the source array to be virtualized.
 * @param options - Configuration options.
 * @param options.itemHeight - Item height in pixels, either a fixed number or a function returning the height.
 * @param options.overscan - Optional explicit overscan count; when omitted an automatic value is computed from `itemHeight`.
 * @returns The virtual list controls and binding props: `list`, `containerProps`, `wrapperProps`, and `scrollTo`.
 */
export function useVirtualListSetup<T>(
  dataSource: Ref<T[]>,
  options: {
    /** 每项高度（px），支持固定数值或动态函数 */
    itemHeight: number | (() => number);
    /** overscan 预渲染数量，默认自动缩放 */
    overscan?: number;
  },
) {
  const { itemHeight, overscan: overscanOverride } = options;

  // 自动 overscan 缩放：根据行高动态调整预渲染数量，平衡滚动流畅度与渲染开销
  // 注意：useVirtualList 仅在初始化时读取 overscan，后续变化不会生效，因此直接计算为常量
  const height = typeof itemHeight === 'function' ? itemHeight() : itemHeight;
  const resolvedOverscan =
    overscanOverride !== undefined
      ? overscanOverride
      : Math.min(15, Math.max(5, Math.ceil(200 / height)));

  const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(dataSource, {
    itemHeight,
    overscan: resolvedOverscan,
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
