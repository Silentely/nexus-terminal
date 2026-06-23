import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import apiClient from '../utils/apiClient';
import { useLayoutStore, type PaneName, type LayoutNode } from './layout.store';

vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const mockGet = vi.mocked(apiClient.get);
const mockPut = vi.mocked(apiClient.put);

// 等待 store 初始化完成
// 移除自动初始化后，需显式调用 initializeLayout()
async function waitForInit() {
  const store = useLayoutStore();
  await store.initializeLayout();
  // 额外等待微任务队列清空
  await new Promise((resolve) => Promise.resolve().then(resolve));
}

function mockBackendAllNull() {
  mockGet.mockImplementation((url: string) => {
    if (url === '/settings/layout') return Promise.resolve({ data: null });
    if (url === '/settings/sidebar') return Promise.resolve({ data: null });
    if (url === '/settings/nav-bar-visibility') return Promise.resolve({ data: { visible: true } });
    return Promise.resolve({ data: null });
  });
  mockPut.mockResolvedValue({ data: null });
}

function makePaneNode(component: PaneName, size = 50): LayoutNode {
  return { id: `pane-${component}`, type: 'pane', component, size };
}

function makeContainer(
  id: string,
  direction: 'horizontal' | 'vertical',
  children: LayoutNode[],
  size?: number,
): LayoutNode {
  return { id, type: 'container', direction, children, size };
}

describe('layout.store', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
    mockBackendAllNull();
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it('allPossiblePanes 应包含 batchExec', () => {
    const store = useLayoutStore();
    expect(store.allPossiblePanes).toContain('batchExec');
  });

  describe('initializeLayout', () => {
    it('后端返回布局数据时应使用后端数据', async () => {
      const serverLayout: LayoutNode = makeContainer('root', 'horizontal', [
        makePaneNode('terminal'),
      ]);
      mockGet.mockImplementation((url: string) => {
        if (url === '/settings/layout') return Promise.resolve({ data: serverLayout });
        if (url === '/settings/sidebar') return Promise.resolve({ data: null });
        if (url === '/settings/nav-bar-visibility')
          return Promise.resolve({ data: { visible: true } });
        return Promise.resolve({ data: null });
      });

      const store = useLayoutStore();
      await store.initializeLayout();
      expect(store.layoutTree).not.toBeNull();
      expect(store.layoutTree?.type).toBe('container');
    });

    it('后端和 localStorage 均无数据时应使用默认布局', async () => {
      const store = useLayoutStore();
      await store.initializeLayout();
      expect(store.layoutTree).not.toBeNull();
      expect(store.layoutTree?.type).toBe('container');
      expect(store.layoutTree?.children).toBeDefined();
      expect(store.layoutTree?.children?.length).toBeGreaterThan(0);
    });

    it('后端加载失败时应使用默认布局', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/settings/layout') return Promise.reject(new Error('network'));
        if (url === '/settings/sidebar') return Promise.reject(new Error('network'));
        if (url === '/settings/nav-bar-visibility')
          return Promise.resolve({ data: { visible: true } });
        return Promise.resolve({ data: null });
      });

      const store = useLayoutStore();
      await store.initializeLayout();
      expect(store.layoutTree).not.toBeNull();
    });

    it('后端返回有效侧栏配置时应使用该配置', async () => {
      const sidebarData = { left: ['connections' as PaneName], right: ['editor' as PaneName] };
      mockGet.mockImplementation((url: string) => {
        if (url === '/settings/layout') return Promise.resolve({ data: null });
        if (url === '/settings/sidebar') return Promise.resolve({ data: sidebarData });
        if (url === '/settings/nav-bar-visibility')
          return Promise.resolve({ data: { visible: true } });
        return Promise.resolve({ data: null });
      });

      const store = useLayoutStore();
      await store.initializeLayout();
      expect(store.sidebarPanes.left).toEqual(['connections']);
      expect(store.sidebarPanes.right).toEqual(['editor']);
    });
  });

  describe('updateLayoutTree', () => {
    it('验证通过且有变更时应更新布局树并持久化', async () => {
      const store = useLayoutStore();
      await waitForInit();
      const newTree = makeContainer('new-root', 'vertical', [makePaneNode('terminal')]);

      await store.updateLayoutTree(newTree);
      expect(store.layoutTree).toEqual(newTree);
      expect(mockPut).toHaveBeenCalledWith('/settings/layout', newTree);
    });

    it('验证失败时不应更新布局树', async () => {
      const store = useLayoutStore();
      const invalidTree = { id: 'x', type: 'invalid' } as any;

      await store.updateLayoutTree(invalidTree);
      expect(store.layoutTree?.id).not.toBe('x');
    });

    it('树未变更时不应调用持久化', async () => {
      const store = useLayoutStore();
      const currentTree = store.layoutTree;

      mockPut.mockClear();
      await store.updateLayoutTree(currentTree);
      expect(mockPut).not.toHaveBeenCalledWith('/settings/layout', expect.anything());
    });

    it('传入 null 时应清除布局树', async () => {
      const store = useLayoutStore();
      await store.updateLayoutTree(makeContainer('c1', 'horizontal', [makePaneNode('terminal')]));
      mockPut.mockClear();

      await store.updateLayoutTree(null);
      expect(store.layoutTree).toBeNull();
    });
  });

  describe('updateSidebarPanes', () => {
    it('有效配置且有变更时应更新侧栏并持久化', async () => {
      const store = useLayoutStore();
      await waitForInit();
      const newPanes = { left: ['terminal' as PaneName], right: ['editor' as PaneName] };

      await store.updateSidebarPanes(newPanes);
      expect(store.sidebarPanes).toEqual(newPanes);
      expect(mockPut).toHaveBeenCalledWith('/settings/sidebar', newPanes);
    });

    it('无效配置（含重复）时不应更新', async () => {
      const store = useLayoutStore();
      const original = { left: [...store.sidebarPanes.left], right: [...store.sidebarPanes.right] };
      const invalidPanes = { left: ['terminal' as PaneName, 'terminal' as PaneName], right: [] };

      await store.updateSidebarPanes(invalidPanes as any);
      expect(store.sidebarPanes.left).toEqual(original.left);
      expect(store.sidebarPanes.right).toEqual(original.right);
    });

    it('配置未变更时不应调用持久化', async () => {
      const store = useLayoutStore();
      const currentPanes = {
        left: [...store.sidebarPanes.left],
        right: [...store.sidebarPanes.right],
      };

      mockPut.mockClear();
      await store.updateSidebarPanes(currentPanes as any);
      expect(mockPut).not.toHaveBeenCalledWith('/settings/sidebar', expect.anything());
    });
  });

  describe('updateNodeSizes', () => {
    it('找到节点时应更新子节点大小', async () => {
      const store = useLayoutStore();
      await waitForInit();
      const child1 = makePaneNode('terminal', 50);
      const child2 = makePaneNode('editor', 50);
      const tree = makeContainer('root', 'horizontal', [child1, child2]);
      await store.updateLayoutTree(tree);
      mockPut.mockClear();

      store.updateNodeSizes('root', [
        { index: 0, size: 30 },
        { index: 1, size: 70 },
      ]);
      expect(store.layoutTree?.children?.[0].size).toBe(30);
      expect(store.layoutTree?.children?.[1].size).toBe(70);
    });

    it('未找到节点时不应修改布局', async () => {
      const store = useLayoutStore();
      const tree = makeContainer('root', 'horizontal', [makePaneNode('terminal')]);
      await store.updateLayoutTree(tree);
      const before = JSON.stringify(store.layoutTree);

      store.updateNodeSizes('nonexistent', [{ index: 0, size: 100 }]);
      expect(JSON.stringify(store.layoutTree)).toBe(before);
    });
  });

  describe('toggleLayoutVisibility', () => {
    it('应切换 isLayoutVisible', () => {
      const store = useLayoutStore();
      expect(store.isLayoutVisible).toBe(true);
      store.toggleLayoutVisibility();
      expect(store.isLayoutVisible).toBe(false);
      store.toggleLayoutVisibility();
      expect(store.isLayoutVisible).toBe(true);
    });
  });

  describe('toggleHeaderVisibility', () => {
    it('成功时应切换 isHeaderVisible 并调用后端', async () => {
      const store = useLayoutStore();
      await waitForInit();
      expect(store.isHeaderVisible).toBe(true);

      await store.toggleHeaderVisibility();
      expect(store.isHeaderVisible).toBe(false);
      expect(mockPut).toHaveBeenCalledWith('/settings/nav-bar-visibility', { visible: false });
    });

    it('后端失败时仍应更新本地状态', async () => {
      mockPut.mockRejectedValueOnce(new Error('fail'));
      const store = useLayoutStore();
      await waitForInit();

      await store.toggleHeaderVisibility();
      expect(store.isHeaderVisible).toBe(false);
    });
  });

  describe('loadHeaderVisibility', () => {
    it('后端返回有效数据时应更新状态', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/settings/nav-bar-visibility')
          return Promise.resolve({ data: { visible: false } });
        if (url === '/settings/layout') return Promise.resolve({ data: null });
        if (url === '/settings/sidebar') return Promise.resolve({ data: null });
        return Promise.resolve({ data: null });
      });

      const store = useLayoutStore();
      await store.loadHeaderVisibility();
      expect(store.isHeaderVisible).toBe(false);
    });

    it('后端返回无效数据时应使用默认值', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/settings/nav-bar-visibility') return Promise.resolve({ data: {} });
        if (url === '/settings/layout') return Promise.resolve({ data: null });
        if (url === '/settings/sidebar') return Promise.resolve({ data: null });
        return Promise.resolve({ data: null });
      });

      const store = useLayoutStore();
      await store.loadHeaderVisibility();
      expect(store.isHeaderVisible).toBe(true);
    });

    it('后端失败时应使用默认值', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/settings/nav-bar-visibility') return Promise.reject(new Error('fail'));
        if (url === '/settings/layout') return Promise.resolve({ data: null });
        if (url === '/settings/sidebar') return Promise.resolve({ data: null });
        return Promise.resolve({ data: null });
      });

      const store = useLayoutStore();
      await store.loadHeaderVisibility();
      expect(store.isHeaderVisible).toBe(true);
    });
  });

  describe('getSystemDefaultLayout', () => {
    it('应返回默认布局结构', () => {
      const store = useLayoutStore();
      const defaultLayout = store.getSystemDefaultLayout();
      expect(defaultLayout.type).toBe('container');
      expect(defaultLayout.direction).toBe('horizontal');
      expect(defaultLayout.children).toBeDefined();
      expect(defaultLayout.children?.length).toBeGreaterThan(0);
    });
  });

  describe('getSystemDefaultSidebarPanes', () => {
    it('应返回默认侧栏配置', () => {
      const store = useLayoutStore();
      const defaultSidebar = store.getSystemDefaultSidebarPanes();
      expect(defaultSidebar.left).toContain('connections');
      expect(defaultSidebar.right).toEqual([]);
    });
  });

  describe('computed: availablePanes 和 usedPanes', () => {
    it('已使用的面板应从 availablePanes 中排除', () => {
      const store = useLayoutStore();
      expect(store.usedPanes.has('connections')).toBe(true);
      expect(store.availablePanes).not.toContain('connections');
    });

    it('未使用的面板应出现在 availablePanes 中', () => {
      const store = useLayoutStore();
      expect(store.usedPanes.has('suspendedSshSessions')).toBe(false);
      expect(store.availablePanes).toContain('suspendedSshSessions');
    });
  });
});
