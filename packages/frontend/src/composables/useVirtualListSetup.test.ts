import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useVirtualListSetup } from './useVirtualListSetup';

// Mock @vueuse/core useVirtualList
vi.mock('@vueuse/core', () => ({
  useVirtualList: vi.fn((dataSource, options) => ({
    list: ref([]),
    containerProps: { ref: ref(null), onScroll: vi.fn(), style: { overflow: 'auto' } },
    wrapperProps: { style: { minHeight: '0px' } },
    scrollTo: vi.fn(),
    _capturedOptions: options,
  })),
}));

import { useVirtualList } from '@vueuse/core';

describe('useVirtualListSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('返回值结构', () => {
    it('应该返回 list、containerProps、wrapperProps 和 scrollTo', () => {
      const data = ref([1, 2, 3]);
      const result = useVirtualListSetup(data, { itemHeight: 50 });

      expect(result).toHaveProperty('list');
      expect(result).toHaveProperty('containerProps');
      expect(result).toHaveProperty('wrapperProps');
      expect(result).toHaveProperty('scrollTo');
    });

    it('应该调用 @vueuse/core 的 useVirtualList', () => {
      const data = ref(['a', 'b', 'c']);
      useVirtualListSetup(data, { itemHeight: 40 });

      expect(useVirtualList).toHaveBeenCalledOnce();
      expect(useVirtualList).toHaveBeenCalledWith(data, expect.objectContaining({ itemHeight: 40 }));
    });
  });

  describe('overscan 自动计算', () => {
    it('当未提供 overscan 时应自动计算', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 50 });

      // height=50: Math.min(15, Math.max(5, Math.ceil(200/50))) = Math.min(15, Math.max(5, 4)) = 5
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('高度为 20px 时 overscan 应为 10', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 20 });

      // height=20: Math.min(15, Math.max(5, Math.ceil(200/20))) = Math.min(15, Math.max(5, 10)) = 10
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('高度为 10px 时 overscan 应达到最大值 15', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 10 });

      // height=10: Math.min(15, Math.max(5, Math.ceil(200/10))) = Math.min(15, Math.max(5, 20)) = 15
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('高度为 100px 时 overscan 应为最小值 5', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 100 });

      // height=100: Math.min(15, Math.max(5, Math.ceil(200/100))) = Math.min(15, Math.max(5, 2)) = 5
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('高度为 200px 时 overscan 应为最小值 5', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 200 });

      // height=200: Math.min(15, Math.max(5, Math.ceil(200/200))) = Math.min(15, Math.max(5, 1)) = 5
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('高度为 14px 时 overscan 应为 15（ceil(200/14)=15）', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 14 });

      // height=14: Math.min(15, Math.max(5, Math.ceil(200/14))) = Math.min(15, Math.max(5, 15)) = 15
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 15 })
      );
    });
  });

  describe('overscan 显式覆盖', () => {
    it('当提供 overscan 时应使用提供的值', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 50, overscan: 10 });

      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('overscan=0 时应使用 0', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 50, overscan: 0 });

      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 0 })
      );
    });

    it('overscan=15 时应使用 15', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 50, overscan: 15 });

      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('overscan=1 时不应用自动缩放逻辑', () => {
      const data = ref([1]);
      // 如果自动计算，height=50 时 overscan=5，但指定为 1 应使用 1
      useVirtualListSetup(data, { itemHeight: 50, overscan: 1 });

      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 1 })
      );
    });
  });

  describe('动态 itemHeight 函数', () => {
    it('应该支持函数类型的 itemHeight', () => {
      const data = ref([1]);
      const itemHeightFn = () => 60;
      useVirtualListSetup(data, { itemHeight: itemHeightFn });

      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ itemHeight: itemHeightFn })
      );
    });

    it('函数 itemHeight 时应正确计算 overscan', () => {
      const data = ref([1]);
      const itemHeightFn = () => 40;
      useVirtualListSetup(data, { itemHeight: itemHeightFn });

      // height=40: Math.min(15, Math.max(5, Math.ceil(200/40))) = Math.min(15, Math.max(5, 5)) = 5
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('函数 itemHeight 返回小值时 overscan 应达到上限', () => {
      const data = ref([1]);
      const itemHeightFn = () => 5;
      useVirtualListSetup(data, { itemHeight: itemHeightFn });

      // height=5: Math.min(15, Math.max(5, Math.ceil(200/5))) = Math.min(15, Math.max(5, 40)) = 15
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('函数 itemHeight 带显式 overscan 时应用显式值', () => {
      const data = ref([1]);
      const itemHeightFn = () => 5; // 如果自动计算会是 15
      useVirtualListSetup(data, { itemHeight: itemHeightFn, overscan: 8 });

      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 8 })
      );
    });
  });

  describe('数据源传递', () => {
    it('应该将数据源原样传递给 useVirtualList', () => {
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const data = ref(items);
      useVirtualListSetup(data, { itemHeight: 50 });

      expect(useVirtualList).toHaveBeenCalledWith(data, expect.any(Object));
    });

    it('应该支持空数组数据源', () => {
      const data = ref<string[]>([]);
      expect(() => useVirtualListSetup(data, { itemHeight: 50 })).not.toThrow();
    });

    it('应该支持泛型类型', () => {
      interface Item { id: number; name: string }
      const data = ref<Item[]>([{ id: 1, name: 'test' }]);
      expect(() => useVirtualListSetup(data, { itemHeight: 50 })).not.toThrow();
    });
  });

  describe('overscan 边界计算', () => {
    it('overscan 应不低于 5', () => {
      // 使用非常大的 itemHeight 使得 ceil(200/height) < 5
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 1000 });

      // height=1000: Math.min(15, Math.max(5, ceil(200/1000))) = Math.min(15, Math.max(5, 1)) = 5
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('overscan 应不超过 15', () => {
      // 使用非常小的 itemHeight 使得 ceil(200/height) >> 15
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 1 });

      // height=1: Math.min(15, Math.max(5, ceil(200/1))) = Math.min(15, Math.max(5, 200)) = 15
      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ overscan: 15 })
      );
    });
  });

  describe('itemHeight 传递', () => {
    it('数值型 itemHeight 应原样传递给 useVirtualList', () => {
      const data = ref([1, 2]);
      useVirtualListSetup(data, { itemHeight: 36 });

      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ itemHeight: 36 })
      );
    });

    it('函数型 itemHeight 应原样传递给 useVirtualList（不被展开）', () => {
      const data = ref([1]);
      const fn = () => 48;
      useVirtualListSetup(data, { itemHeight: fn });

      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ itemHeight: fn })
      );
    });

    it('不同 itemHeight 值每次调用后均应正确传递', () => {
      const data = ref([1]);

      useVirtualListSetup(data, { itemHeight: 24 });
      expect(useVirtualList).toHaveBeenLastCalledWith(
        data,
        expect.objectContaining({ itemHeight: 24 })
      );

      useVirtualListSetup(data, { itemHeight: 120 });
      expect(useVirtualList).toHaveBeenLastCalledWith(
        data,
        expect.objectContaining({ itemHeight: 120 })
      );
    });
  });

  describe('返回值完整性', () => {
    it('scrollTo 应为函数', () => {
      const data = ref([1]);
      const result = useVirtualListSetup(data, { itemHeight: 50 });
      expect(typeof result.scrollTo).toBe('function');
    });

    it('containerProps 应包含 onScroll 函数', () => {
      const data = ref([1]);
      const result = useVirtualListSetup(data, { itemHeight: 50 });
      expect(result.containerProps).toHaveProperty('onScroll');
      expect(typeof result.containerProps.onScroll).toBe('function');
    });

    it('wrapperProps 应包含 style', () => {
      const data = ref([1]);
      const result = useVirtualListSetup(data, { itemHeight: 50 });
      expect(result.wrapperProps).toHaveProperty('style');
    });

    it('list 应为响应式 ref', () => {
      const data = ref([1, 2, 3]);
      const result = useVirtualListSetup(data, { itemHeight: 50 });
      // list should be a ref-like object (has .value)
      expect(result.list).toBeDefined();
    });
  });

  describe('overscan=0 边界行为', () => {
    it('overscan=0 不影响 itemHeight 的传递', () => {
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 80, overscan: 0 });

      expect(useVirtualList).toHaveBeenCalledWith(
        data,
        expect.objectContaining({ itemHeight: 80, overscan: 0 })
      );
    });
  });

  describe('大数量数据源', () => {
    it('应该支持大数组（10000 项）而不抛出', () => {
      const bigData = ref(Array.from({ length: 10000 }, (_, i) => i));
      expect(() => useVirtualListSetup(bigData, { itemHeight: 50 })).not.toThrow();
    });
  });
});