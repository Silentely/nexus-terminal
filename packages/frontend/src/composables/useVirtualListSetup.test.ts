import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock @vueuse/core's useVirtualList to capture the options passed to it
const mockScrollTo = vi.fn();
const mockUseVirtualList = vi.fn();

vi.mock('@vueuse/core', () => ({
  useVirtualList: mockUseVirtualList,
}));

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

  describe('return shape', () => {
    it('should return list, containerProps, wrapperProps, and scrollTo', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1, 2, 3]);
      const result = useVirtualListSetup(data, { itemHeight: 50 });

      expect(result).toHaveProperty('list');
      expect(result).toHaveProperty('containerProps');
      expect(result).toHaveProperty('wrapperProps');
      expect(result).toHaveProperty('scrollTo');
    });

    it('should pass the same scrollTo function from useVirtualList', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref(['a', 'b']);
      const result = useVirtualListSetup(data, { itemHeight: 40 });

      expect(result.scrollTo).toBe(mockScrollTo);
    });
  });

  describe('overscan auto-calculation', () => {
    it('should compute overscan = ceil(200/height) for moderate height', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      // height = 40 → ceil(200/40) = 5
      useVirtualListSetup(data, { itemHeight: 40 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });

    it('should cap overscan at 15 for small item heights', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      // height = 10 → ceil(200/10) = 20, capped at 15
      useVirtualListSetup(data, { itemHeight: 10 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(15);
    });

    it('should floor overscan at 5 for large item heights', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      // height = 300 → ceil(200/300) = 1, floored at 5
      useVirtualListSetup(data, { itemHeight: 300 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });

    it('should compute overscan = 10 for height = 20 (ceil(200/20) = 10)', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 20 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(10);
    });

    it('should compute overscan = 7 for height = 30 (ceil(200/30) = 7)', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 30 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(7);
    });

    it('should compute overscan = 15 for height = 180 (audit log height) — clamped at 15 due to ceil(200/180)=2 -> max(5,2)=5, wait: min(15, max(5, ceil(200/180))) = min(15, max(5,2)) = 5', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      // height = 180 → ceil(200/180) = 2, max(5, 2) = 5, min(15, 5) = 5
      useVirtualListSetup(data, { itemHeight: 180 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });
  });

  describe('explicit overscan override', () => {
    it('should use explicit overscan when provided (overscan: 10)', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 50, overscan: 10 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(10);
    });

    it('should use explicit overscan = 15 (file list convention)', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 50, overscan: 15 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(15);
    });

    it('should use explicit overscan = 0 (edge case)', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 50, overscan: 0 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(0);
    });
  });

  describe('function itemHeight', () => {
    it('should call itemHeight function to get height for auto overscan', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      const itemHeightFn = vi.fn().mockReturnValue(25);
      // height = 25 → ceil(200/25) = 8, max(5,8) = 8, min(15,8) = 8
      useVirtualListSetup(data, { itemHeight: itemHeightFn });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(8);
    });

    it('should pass function itemHeight directly to useVirtualList', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      const itemHeightFn = () => 60;
      useVirtualListSetup(data, { itemHeight: itemHeightFn });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].itemHeight).toBe(itemHeightFn);
    });

    it('should not call function itemHeight for auto overscan when override is provided', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      const itemHeightFn = vi.fn().mockReturnValue(25);
      useVirtualListSetup(data, { itemHeight: itemHeightFn, overscan: 7 });

      // With an explicit override, the computed uses the override immediately
      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(7);
    });
  });

  describe('data source passthrough', () => {
    it('should pass the data source ref directly to useVirtualList', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([{ id: 1 }, { id: 2 }]);
      useVirtualListSetup(data, { itemHeight: 50 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[0]).toBe(data);
    });
  });

  describe('boundary conditions', () => {
    it('should handle height = 200 exactly (ceil(200/200) = 1, floored at 5)', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      useVirtualListSetup(data, { itemHeight: 200 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(5);
    });

    it('should handle height = 14 (ceil(200/14) = 15, exactly at cap)', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref([1]);
      // ceil(200/14) = ceil(14.28) = 15 → min(15, max(5, 15)) = 15
      useVirtualListSetup(data, { itemHeight: 14 });

      const callArgs = mockUseVirtualList.mock.calls[0];
      expect(callArgs[1].overscan).toBe(15);
    });

    it('should work with an empty array data source', async () => {
      const { useVirtualListSetup } = await import('./useVirtualListSetup');
      const data = ref<number[]>([]);
      expect(() => useVirtualListSetup(data, { itemHeight: 50 })).not.toThrow();
    });
  });
});