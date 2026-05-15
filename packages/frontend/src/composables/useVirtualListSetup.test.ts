/**
 * useVirtualListSetup 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock @vueuse/core's useVirtualList
const mockUseVirtualList = vi.fn();
vi.mock('@vueuse/core', () => ({
  useVirtualList: mockUseVirtualList,
}));

// Default return value for useVirtualList mock
const mockVirtualListReturn = {
  list: ref([]),
  containerProps: { ref: vi.fn(), onScroll: vi.fn(), style: {} },
  wrapperProps: { style: {} },
  scrollTo: vi.fn(),
};

describe('useVirtualListSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVirtualList.mockReturnValue(mockVirtualListReturn);
  });

  describe('返回值结构', () => {
    it('应该返回 list、containerProps、wrapperProps、scrollTo', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([1, 2, 3]);
      const result = useVirtualListSetup(dataSource, { itemHeight: 40 });

      expect(result).toHaveProperty('list');
      expect(result).toHaveProperty('containerProps');
      expect(result).toHaveProperty('wrapperProps');
      expect(result).toHaveProperty('scrollTo');
    });

    it('应该将数据源传递给 useVirtualList', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref(['a', 'b', 'c']);
      useVirtualListSetup(dataSource, { itemHeight: 50 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ itemHeight: 50 })
      );
    });
  });

  describe('overscan 自动缩放', () => {
    it('行高为 40px 时 overscan 应为 5（Math.ceil(200/40)=5）', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 40 });

      // Math.min(15, Math.max(5, Math.ceil(200/40))) = Math.min(15, Math.max(5, 5)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('行高为 20px 时 overscan 应为 10（Math.ceil(200/20)=10）', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 20 });

      // Math.min(15, Math.max(5, Math.ceil(200/20))) = Math.min(15, Math.max(5, 10)) = 10
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('行高为 10px 时 overscan 应为 15（上限）', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 10 });

      // Math.min(15, Math.max(5, Math.ceil(200/10))) = Math.min(15, Math.max(5, 20)) = 15
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('行高为 100px 时 overscan 应为 5（下限）', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 100 });

      // Math.min(15, Math.max(5, Math.ceil(200/100))) = Math.min(15, Math.max(5, 2)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('行高为 180px 时 overscan 应为 5（审计日志场景）', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 180 });

      // Math.min(15, Math.max(5, Math.ceil(200/180))) = Math.min(15, Math.max(5, 2)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('行高为 14px 时 overscan 应为 15（Math.ceil(200/14)=15）', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 14 });

      // Math.min(15, Math.max(5, Math.ceil(200/14))) = Math.min(15, Math.max(5, 15)) = 15
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 15 })
      );
    });
  });

  describe('overscan 显式覆盖', () => {
    it('提供 overscan 时应使用指定值', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 40, overscan: 15 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('overscan 为 10 时应使用 10 而非自动计算值', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      // 行高 180px 时自动计算为 5，但明确传 10 应使用 10
      useVirtualListSetup(dataSource, { itemHeight: 180, overscan: 10 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('overscan 为 0 时应使用 0（边界值）', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 40, overscan: 0 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 0 })
      );
    });
  });

  describe('itemHeight 函数形式', () => {
    it('itemHeight 为函数时应传递给 useVirtualList', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      const heightFn = () => 50;
      useVirtualListSetup(dataSource, { itemHeight: heightFn });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ itemHeight: heightFn })
      );
    });

    it('itemHeight 为函数且无 overscan 时应自动计算 overscan', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      const heightFn = () => 20;
      useVirtualListSetup(dataSource, { itemHeight: heightFn });

      // Math.min(15, Math.max(5, Math.ceil(200/20))) = 10
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('itemHeight 为函数时应在计算 overscan 时调用该函数', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      const heightFn = vi.fn().mockReturnValue(40);
      useVirtualListSetup(dataSource, { itemHeight: heightFn });

      // overscan 计算应调用 heightFn
      expect(heightFn).toHaveBeenCalled();
    });
  });

  describe('泛型支持', () => {
    it('应该支持字符串数组', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref<string[]>(['a', 'b', 'c']);
      const result = useVirtualListSetup(dataSource, { itemHeight: 30 });

      expect(result).toBeDefined();
      expect(mockUseVirtualList).toHaveBeenCalled();
    });

    it('应该支持对象数组', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref<{ id: number; name: string }[]>([{ id: 1, name: 'test' }]);
      const result = useVirtualListSetup(dataSource, { itemHeight: 60 });

      expect(result).toBeDefined();
    });

    it('应该支持空数组', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref<never[]>([]);
      expect(() => useVirtualListSetup(dataSource, { itemHeight: 40 })).not.toThrow();
    });
  });

  describe('边界情况', () => {
    it('行高为极大值时 overscan 应为 5（下限）', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 10000 });

      // Math.min(15, Math.max(5, Math.ceil(200/10000))) = Math.min(15, Math.max(5, 1)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('行高为 1px 时 overscan 应为 15（上限）', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const dataSource = ref([]);
      useVirtualListSetup(dataSource, { itemHeight: 1 });

      // Math.min(15, Math.max(5, Math.ceil(200/1))) = Math.min(15, 200) = 15
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ overscan: 15 })
      );
    });
  });
});