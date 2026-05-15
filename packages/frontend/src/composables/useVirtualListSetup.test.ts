import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock @vueuse/core's useVirtualList
const mockScrollTo = vi.fn();
const mockUseVirtualList = vi.fn();

vi.mock('@vueuse/core', () => ({
  useVirtualList: mockUseVirtualList,
}));

import { useVirtualListSetup } from './useVirtualListSetup';

describe('useVirtualListSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVirtualList.mockReturnValue({
      list: ref([]),
      containerProps: { ref: vi.fn(), onScroll: vi.fn() },
      wrapperProps: { style: {} },
      scrollTo: mockScrollTo,
    });
  });

  describe('返回值结构', () => {
    it('应该返回 list、containerProps、wrapperProps 和 scrollTo', () => {
      const source = ref([1, 2, 3]);
      const result = useVirtualListSetup(source, { itemHeight: 40 });

      expect(result).toHaveProperty('list');
      expect(result).toHaveProperty('containerProps');
      expect(result).toHaveProperty('wrapperProps');
      expect(result).toHaveProperty('scrollTo');
    });

    it('scrollTo 应该是来自 useVirtualList 的函数', () => {
      const source = ref([1]);
      const result = useVirtualListSetup(source, { itemHeight: 40 });
      expect(result.scrollTo).toBe(mockScrollTo);
    });
  });

  describe('overscan 显式覆盖', () => {
    it('当提供 overscan 时应直接使用该值', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 40, overscan: 15 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('当 overscan 为 0 时应使用 0（而不是自动计算）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 40, overscan: 0 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 0 })
      );
    });

    it('当 overscan 为 1 时应使用 1', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 100, overscan: 1 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 1 })
      );
    });
  });

  describe('自动 overscan 缩放 - 数值型 itemHeight', () => {
    // 公式：Math.min(15, Math.max(5, Math.ceil(200 / height)))

    it('itemHeight=20 时 overscan 应为 10（200/20=10）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 20 });

      // Math.min(15, Math.max(5, ceil(200/20))) = Math.min(15, Math.max(5, 10)) = 10
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('itemHeight=10 时 overscan 应为 15（clamp 到上限）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 10 });

      // Math.min(15, Math.max(5, ceil(200/10))) = Math.min(15, Math.max(5, 20)) = 15
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('itemHeight=200 时 overscan 应为 5（clamp 到下限）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 200 });

      // Math.min(15, Math.max(5, ceil(200/200))) = Math.min(15, Math.max(5, 1)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('itemHeight=40 时 overscan 应为 5（200/40=5）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 40 });

      // Math.min(15, Math.max(5, ceil(200/40))) = Math.min(15, Math.max(5, 5)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('itemHeight=180 时 overscan 应为 5（大行高 audit log 场景）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 180 });

      // Math.min(15, Math.max(5, ceil(200/180))) = Math.min(15, Math.max(5, 2)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('itemHeight=1 时 overscan 应为 15（极小行高 clamp 上限）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 1 });

      // Math.min(15, Math.max(5, ceil(200/1))) = Math.min(15, 200) = 15
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('itemHeight=100 时 overscan 应为 5（200/100=2，下限 5）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 100 });

      // Math.min(15, Math.max(5, ceil(200/100))) = Math.min(15, Math.max(5, 2)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 5 })
      );
    });
  });

  describe('自动 overscan 缩放 - 函数型 itemHeight', () => {
    it('itemHeight 为返回 20 的函数时 overscan 应为 10', () => {
      const source = ref([1]);
      const itemHeightFn = () => 20;
      useVirtualListSetup(source, { itemHeight: itemHeightFn });

      // Math.min(15, Math.max(5, ceil(200/20))) = 10
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('itemHeight 为返回 10 的函数时 overscan 应为 15（上限）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: () => 10 });

      // ceil(200/10)=20 -> clamp to 15
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('itemHeight 为返回 500 的函数时 overscan 应为 5（下限）', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: () => 500 });

      // ceil(200/500)=1 -> max(5,1)=5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 5 })
      );
    });
  });

  describe('itemHeight 传递', () => {
    it('数值型 itemHeight 应直接传递给 useVirtualList', () => {
      const source = ref(['a', 'b']);
      useVirtualListSetup(source, { itemHeight: 64 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ itemHeight: 64 })
      );
    });

    it('函数型 itemHeight 应原样传递给 useVirtualList', () => {
      const source = ref(['a', 'b']);
      const heightFn = () => 48;
      useVirtualListSetup(source, { itemHeight: heightFn });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ itemHeight: heightFn })
      );
    });
  });

  describe('数据源传递', () => {
    it('应该将 dataSource ref 传递给 useVirtualList', () => {
      const source = ref([10, 20, 30]);
      useVirtualListSetup(source, { itemHeight: 40 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(source, expect.any(Object));
    });

    it('应该对空数组正常工作', () => {
      const source = ref<number[]>([]);
      const result = useVirtualListSetup(source, { itemHeight: 40 });
      expect(result).toHaveProperty('list');
    });
  });

  describe('边界情况', () => {
    it('overscan 为 undefined 时应触发自动计算', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 20, overscan: undefined });

      // overscanOverride is undefined -> auto compute: ceil(200/20)=10
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('overscan 为 10 时（WorkspaceConnectionList 场景）应使用 10', () => {
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 36, overscan: 10 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 10 })
      );
    });
  });
});