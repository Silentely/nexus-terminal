/**
 * useVirtualListSetup 单元测试
 *
 * 测试虚拟列表通用配置 composable 的核心行为：
 * - 自动 overscan 缩放计算
 * - 显式 overscan 覆盖
 * - 返回值结构完整性
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock @vueuse/core's useVirtualList
const mockScrollTo = vi.fn();
const mockList = ref([]);
const mockContainerProps = { ref: vi.fn(), onScroll: vi.fn(), style: {} };
const mockWrapperProps = { style: {} };

vi.mock('@vueuse/core', () => ({
  useVirtualList: vi.fn((source, options) => ({
    list: mockList,
    containerProps: mockContainerProps,
    wrapperProps: mockWrapperProps,
    scrollTo: mockScrollTo,
    // expose the passed options for inspection
    _options: options,
  })),
}));

import { useVirtualList } from '@vueuse/core';
import { useVirtualListSetup } from './useVirtualListSetup';

describe('useVirtualListSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('返回值结构', () => {
    it('应该返回 list、containerProps、wrapperProps、scrollTo', () => {
      const source = ref(['a', 'b', 'c']);
      const result = useVirtualListSetup(source, { itemHeight: 50 });

      expect(result).toHaveProperty('list');
      expect(result).toHaveProperty('containerProps');
      expect(result).toHaveProperty('wrapperProps');
      expect(result).toHaveProperty('scrollTo');
    });

    it('应该将 scrollTo 直接透传', () => {
      const source = ref([1, 2, 3]);
      const result = useVirtualListSetup(source, { itemHeight: 40 });

      expect(result.scrollTo).toBe(mockScrollTo);
    });

    it('应该将 containerProps 直接透传', () => {
      const source = ref([1, 2, 3]);
      const result = useVirtualListSetup(source, { itemHeight: 40 });

      expect(result.containerProps).toBe(mockContainerProps);
    });

    it('应该将 wrapperProps 直接透传', () => {
      const source = ref([1, 2, 3]);
      const result = useVirtualListSetup(source, { itemHeight: 40 });

      expect(result.wrapperProps).toBe(mockWrapperProps);
    });
  });

  describe('自动 overscan 缩放 —— 数值型 itemHeight', () => {
    it('小行高（< 14px）应返回 overscan 上限 15', () => {
      // ceil(200/13) = 16, clamped to 15
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 13 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(15);
    });

    it('行高 200px 应返回 overscan = 1，但下限为 5', () => {
      // ceil(200/200) = 1, clamped to max(5, 1) = 5
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 200 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });

    it('行高 40px 应返回 overscan = 5', () => {
      // ceil(200/40) = 5, within [5, 15]
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 40 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });

    it('行高 20px 应返回 overscan = 10', () => {
      // ceil(200/20) = 10, within [5, 15]
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 20 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(10);
    });

    it('行高 30px 应返回 overscan = 7', () => {
      // ceil(200/30) = ceil(6.67) = 7
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 30 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(7);
    });

    it('行高 180px（审计日志场景）应返回 overscan = 5（下限）', () => {
      // ceil(200/180) = ceil(1.11) = 2, clamped to max(5, 2) = 5
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 180 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });
  });

  describe('函数型 itemHeight 的自动 overscan 缩放', () => {
    it('动态行高函数返回 40px 时应得到 overscan = 5', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: () => 40 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });

    it('动态行高函数返回 10px 时应得到 overscan 上限 15', () => {
      // ceil(200/10) = 20, clamped to 15
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: () => 10 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(15);
    });

    it('动态行高函数返回 500px 时应得到 overscan 下限 5', () => {
      // ceil(200/500) = 1, clamped to 5
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: () => 500 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });
  });

  describe('显式 overscan 覆盖', () => {
    it('显式传入 overscan=15 时应使用 15', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 50, overscan: 15 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(15);
    });

    it('显式传入 overscan=10 时应使用 10，忽略自动计算', () => {
      const source = ref([1, 2, 3]);
      // 行高 13 自动计算应为 15，但显式指定 10
      useVirtualListSetup(source, { itemHeight: 13, overscan: 10 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(10);
    });

    it('显式传入 overscan=5 时应使用 5（即使行高极小）', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 1, overscan: 5 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });

    it('显式传入 overscan=0 时应使用 0（不走自动缩放路径）', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 50, overscan: 0 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(0);
    });
  });

  describe('将 itemHeight 正确透传给 useVirtualList', () => {
    it('数值型 itemHeight 应透传', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 60 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].itemHeight).toBe(60);
    });

    it('函数型 itemHeight 应透传', () => {
      const source = ref([1, 2, 3]);
      const heightFn = () => 80;
      useVirtualListSetup(source, { itemHeight: heightFn });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].itemHeight).toBe(heightFn);
    });

    it('数据源应直接透传给 useVirtualList', () => {
      const source = ref(['x', 'y', 'z']);
      useVirtualListSetup(source, { itemHeight: 40 });

      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[0]).toBe(source);
    });
  });

  describe('overscan 边界值', () => {
    it('行高恰好使 ceil(200/h) === 5 时应返回 5', () => {
      // ceil(200/40) = 5
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 40 });
      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });

    it('行高恰好使 ceil(200/h) === 15 时应返回 15', () => {
      // ceil(200/14) = ceil(14.28) = 15
      const source = ref([1]);
      useVirtualListSetup(source, { itemHeight: 14 });
      const callArgs = vi.mocked(useVirtualList).mock.calls[0];
      expect(callArgs[1].overscan).toBe(15);
    });
  });
});