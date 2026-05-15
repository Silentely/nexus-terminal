import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// ==================== Mock @vueuse/core ====================
const mockScrollTo = vi.fn();
const mockContainerProps = { ref: vi.fn(), onScroll: vi.fn() };
const mockWrapperProps = { style: { height: '1000px' } };
const mockList = ref([{ data: 'item1', index: 0 }]);

const mockUseVirtualList = vi.fn(() => ({
  list: mockList,
  containerProps: mockContainerProps,
  wrapperProps: mockWrapperProps,
  scrollTo: mockScrollTo,
}));

vi.mock('@vueuse/core', () => ({
  useVirtualList: mockUseVirtualList,
}));

import { useVirtualListSetup } from './useVirtualListSetup';

describe('useVirtualListSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVirtualList.mockReturnValue({
      list: mockList,
      containerProps: mockContainerProps,
      wrapperProps: mockWrapperProps,
      scrollTo: mockScrollTo,
    });
  });

  describe('返回值结构', () => {
    it('应返回 list, containerProps, wrapperProps, scrollTo', () => {
      const dataSource = ref(['a', 'b', 'c']);
      const result = useVirtualListSetup(dataSource, { itemHeight: 50 });

      expect(result).toHaveProperty('list');
      expect(result).toHaveProperty('containerProps');
      expect(result).toHaveProperty('wrapperProps');
      expect(result).toHaveProperty('scrollTo');
    });

    it('返回值应来自 useVirtualList', () => {
      const dataSource = ref(['a', 'b']);
      const result = useVirtualListSetup(dataSource, { itemHeight: 50 });

      expect(result.list).toBe(mockList);
      expect(result.containerProps).toBe(mockContainerProps);
      expect(result.wrapperProps).toBe(mockWrapperProps);
      expect(result.scrollTo).toBe(mockScrollTo);
    });

    it('应将 dataSource 传递给 useVirtualList', () => {
      const dataSource = ref([1, 2, 3]);
      useVirtualListSetup(dataSource, { itemHeight: 40 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        dataSource,
        expect.objectContaining({ itemHeight: 40 })
      );
    });
  });

  describe('自动 overscan 计算', () => {
    it('高度 20px 时 overscan 应为 ceil(200/20)=10', () => {
      const dataSource = ref([1, 2, 3]);
      useVirtualListSetup(dataSource, { itemHeight: 20 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      expect(callArgs.overscan).toBe(10);
    });

    it('高度 50px 时 overscan 应为 ceil(200/50)=4 -> clamped to 5 (min)', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 50 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      // Math.ceil(200/50) = 4, max(5, 4) = 5
      expect(callArgs.overscan).toBe(5);
    });

    it('高度 10px 时 overscan 应为 min(15, ceil(200/10))=15', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 10 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      // Math.ceil(200/10) = 20, min(15, 20) = 15
      expect(callArgs.overscan).toBe(15);
    });

    it('高度 100px 时 overscan 应为 5（最小值）', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 100 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      // Math.ceil(200/100) = 2, max(5, 2) = 5
      expect(callArgs.overscan).toBe(5);
    });

    it('高度 200px 时 overscan 应为 5（最小值）', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 200 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      // Math.ceil(200/200) = 1, max(5, 1) = 5
      expect(callArgs.overscan).toBe(5);
    });

    it('高度 180px 时 overscan 应为 5（AuditLogView 场景）', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 180 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      // Math.ceil(200/180) = 2, max(5, 2) = 5
      expect(callArgs.overscan).toBe(5);
    });

    it('高度 13px 时 overscan 应为 ceil(200/13)=16 -> clamped to 15 (max)', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 13 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      // Math.ceil(200/13) = 16, min(15, 16) = 15
      expect(callArgs.overscan).toBe(15);
    });

    it('动态函数 itemHeight 应正确计算 overscan', () => {
      const dataSource = ref([1]);
      const itemHeightFn = () => 40;
      useVirtualListSetup(dataSource, { itemHeight: itemHeightFn });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      // Math.ceil(200/40) = 5, max(5, 5) = 5
      expect(callArgs.overscan).toBe(5);
    });

    it('动态函数 itemHeight 返回小值时应计算正确', () => {
      const dataSource = ref([1]);
      const itemHeightFn = () => 15;
      useVirtualListSetup(dataSource, { itemHeight: itemHeightFn });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      // Math.ceil(200/15) = 14, min(15, max(5, 14)) = 14
      expect(callArgs.overscan).toBe(14);
    });
  });

  describe('显式 overscan 覆盖', () => {
    it('显式传入 overscan 时应使用该值而非自动计算', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 50, overscan: 15 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      expect(callArgs.overscan).toBe(15);
    });

    it('显式传入 overscan 10 时应使用 10', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 50, overscan: 10 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      expect(callArgs.overscan).toBe(10);
    });

    it('显式传入 overscan 0 时应使用 0（不触发自动计算）', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 50, overscan: 0 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      expect(callArgs.overscan).toBe(0);
    });

    it('WorkspaceConnectionList 场景：overscan=10 应被直接使用', () => {
      const dataSource = ref([{ id: 1 }]);
      useVirtualListSetup(dataSource, { itemHeight: 40, overscan: 10 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      expect(callArgs.overscan).toBe(10);
    });

    it('FileManagerFileList 场景：overscan=15 应被直接使用', () => {
      const dataSource = ref([{ name: 'file.txt' }]);
      const itemHeightFn = () => 32;
      useVirtualListSetup(dataSource, { itemHeight: itemHeightFn, overscan: 15 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      expect(callArgs.overscan).toBe(15);
    });
  });

  describe('itemHeight 传递', () => {
    it('数字 itemHeight 应原样传递给 useVirtualList', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 60 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      expect(callArgs.itemHeight).toBe(60);
    });

    it('函数 itemHeight 应原样传递给 useVirtualList', () => {
      const dataSource = ref([1]);
      const heightFn = () => 32;
      useVirtualListSetup(dataSource, { itemHeight: heightFn });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      expect(callArgs.itemHeight).toBe(heightFn);
    });
  });

  describe('边界条件', () => {
    it('空数组数据源应正常工作', () => {
      const dataSource = ref<string[]>([]);
      expect(() => useVirtualListSetup(dataSource, { itemHeight: 40 })).not.toThrow();
    });

    it('超大 itemHeight 应使 overscan 降至最小值 5', () => {
      const dataSource = ref([1]);
      useVirtualListSetup(dataSource, { itemHeight: 1000 });

      const callArgs = mockUseVirtualList.mock.calls[0][1];
      // Math.ceil(200/1000) = 1, max(5, 1) = 5
      expect(callArgs.overscan).toBe(5);
    });

    it('useVirtualList 只应被调用一次', () => {
      const dataSource = ref([1, 2]);
      useVirtualListSetup(dataSource, { itemHeight: 40 });
      expect(mockUseVirtualList).toHaveBeenCalledTimes(1);
    });
  });
});