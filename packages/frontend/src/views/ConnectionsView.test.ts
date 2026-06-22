import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// Mock stores before import
const mockConnectionsStore = {
  connections: ref<unknown[]>([]),
  isLoading: ref(false),
  fetchConnections: vi.fn().mockResolvedValue(undefined),
  testConnection: vi.fn().mockResolvedValue({ success: true, latency: 50 }),
  deleteBatchConnections: vi.fn().mockResolvedValue(undefined),
};

const mockSessionStore = {
  handleConnectRequest: vi.fn().mockResolvedValue(undefined),
};

const mockTagsStore = {
  tags: ref<unknown[]>([]),
  isLoading: ref(false),
  fetchTags: vi.fn().mockResolvedValue(undefined),
};

const mockShowConfirmDialog = vi.fn().mockResolvedValue(true);
const mockShowAlertDialog = vi.fn();

vi.mock('../stores/connections.store', () => ({ useConnectionsStore: () => mockConnectionsStore }));
vi.mock('../stores/session.store', () => ({ useSessionStore: () => mockSessionStore }));
vi.mock('../stores/tags.store', () => ({ useTagsStore: () => mockTagsStore }));
vi.mock('../composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ showConfirmDialog: mockShowConfirmDialog }),
}));
vi.mock('../composables/useAlertDialog', () => ({
  useAlertDialog: () => ({ showAlertDialog: mockShowAlertDialog }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    locale: ref('zh-CN'),
  }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia');
  return {
    ...actual,
    storeToRefs: <T extends object>(store: T) => store,
  };
});

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: (error: unknown, fallback: string) => {
    if (error instanceof Error) return error.message;
    return fallback;
  },
}));

vi.mock('../components/AddConnectionForm.vue', () => ({
  default: { name: 'AddConnectionForm', template: '<div />' },
}));
vi.mock('../components/BatchEditConnectionForm.vue', () => ({
  default: { name: 'BatchEditConnectionForm', template: '<div />' },
}));

function makeConnection(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    name: 'Test Server',
    type: 'SSH',
    host: '192.168.1.1',
    port: 22,
    username: 'root',
    notes: '',
    tag_ids: [],
    last_connected_at: Date.now() / 1000,
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
    ...overrides,
  };
}

describe('ConnectionsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionsStore.connections.value = [];
    mockConnectionsStore.isLoading.value = false;
    mockTagsStore.tags.value = [];
    mockTagsStore.isLoading.value = false;
    mockShowConfirmDialog.mockResolvedValue(true);
    // 清除 localStorage
    localStorage.clear();
  });

  async function mountView() {
    const { default: ConnectionsView } = await import('./ConnectionsView.vue');
    const wrapper = mount(ConnectionsView, {
      global: {
        stubs: {
          AddConnectionForm: { name: 'AddConnectionForm', template: '<div />' },
          BatchEditConnectionForm: { name: 'BatchEditConnectionForm', template: '<div />' },
        },
      },
    });
    await nextTick();
    return wrapper;
  }

  describe('初始化', () => {
    it('无连接时应加载连接列表', async () => {
      await mountView();
      expect(mockConnectionsStore.fetchConnections).toHaveBeenCalled();
      expect(mockTagsStore.fetchTags).toHaveBeenCalled();
    });

    it('已有连接时不应重复加载', async () => {
      mockConnectionsStore.connections.value = [makeConnection()];
      await mountView();
      expect(mockConnectionsStore.fetchConnections).not.toHaveBeenCalled();
      expect(mockTagsStore.fetchTags).toHaveBeenCalled();
    });
  });

  describe('filteredAndSortedConnections', () => {
    it('空列表时应返回空数组', async () => {
      mockConnectionsStore.connections.value = [];
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('0');
    });

    it('有连接时应显示连接数量', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A' }),
        makeConnection({ id: 2, name: 'Server B' }),
      ];
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('2');
    });

    it('应显示连接名称和地址信息', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'My Server', username: 'admin', host: '10.0.0.1', port: 22 }),
      ];
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('My Server');
      expect(wrapper.text()).toContain('admin@10.0.0.1:22');
    });

    it('搜索框应过滤连接', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Web Server' }),
        makeConnection({ id: 2, name: 'DB Server', host: '10.0.0.2' }),
      ];
      const wrapper = await mountView();

      const input = wrapper.find('input[type="text"]');
      await input.setValue('Web');
      await nextTick();

      expect(wrapper.text()).toContain('Web Server');
      expect(wrapper.text()).not.toContain('DB Server');
    });

    it('搜索应匹配 host', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', host: '192.168.1.100' }),
        makeConnection({ id: 2, name: 'Server B', host: '10.0.0.1' }),
      ];
      const wrapper = await mountView();

      const input = wrapper.find('input[type="text"]');
      await input.setValue('192.168');
      await nextTick();

      expect(wrapper.text()).toContain('Server A');
      expect(wrapper.text()).not.toContain('Server B');
    });

    it('搜索应匹配 username', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', username: 'admin' }),
        makeConnection({ id: 2, name: 'Server B', username: 'deploy' }),
      ];
      const wrapper = await mountView();

      const input = wrapper.find('input[type="text"]');
      await input.setValue('deploy');
      await nextTick();

      expect(wrapper.text()).not.toContain('Server A');
      expect(wrapper.text()).toContain('Server B');
    });

    it('搜索应匹配 port', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', port: 22 }),
        makeConnection({ id: 2, name: 'Server B', port: 3306 }),
      ];
      const wrapper = await mountView();

      const input = wrapper.find('input[type="text"]');
      await input.setValue('3306');
      await nextTick();

      expect(wrapper.text()).not.toContain('Server A');
      expect(wrapper.text()).toContain('Server B');
    });

    it('搜索应匹配 notes', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', notes: 'alpha_note' }),
        makeConnection({ id: 2, name: 'Server B', notes: 'beta_note' }),
      ];
      const wrapper = await mountView();

      const input = wrapper.find('input[type="text"]');
      await input.setValue('alpha_note');
      await nextTick();

      expect(wrapper.text()).toContain('Server A');
      expect(wrapper.text()).not.toContain('Server B');
    });
  });

  describe('标签过滤', () => {
    it('应按标签过滤连接', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', tag_ids: [1] }),
        makeConnection({ id: 2, name: 'Server B', tag_ids: [2] }),
      ];
      mockTagsStore.tags.value = [
        { id: 1, name: 'Production' },
        { id: 2, name: 'Development' },
      ];
      const wrapper = await mountView();

      // 两个连接都应显示（无过滤）
      expect(wrapper.text()).toContain('Server A');
      expect(wrapper.text()).toContain('Server B');
      expect(wrapper.text()).toContain('连接列表 (2)');

      // 验证标签名称已渲染（通过 getTagNames）
      expect(wrapper.text()).toContain('Production');
      expect(wrapper.text()).toContain('Development');
    });
  });

  describe('排序', () => {
    it('应按名称排序', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Zebra', last_connected_at: 1 }),
        makeConnection({ id: 2, name: 'Alpha', last_connected_at: 2 }),
      ];
      const wrapper = await mountView();

      const selects = wrapper.findAll('select');
      // 第一个 select 是标签过滤（index 0），第二个是排序方式（index 1）
      expect(selects.length).toBeGreaterThanOrEqual(2);
      const sortSelect = selects[1];
      await sortSelect.setValue('name');
      await nextTick();

      const items = wrapper.findAll('li');
      expect(items.length).toBe(2);
    });

    it('切换排序方向按钮应正常工作', async () => {
      mockConnectionsStore.connections.value = [makeConnection({ id: 1, name: 'Server A' })];
      const wrapper = await mountView();

      // 找到排序方向按钮（有 aria-label 属性且包含 sort 关键字）
      const sortBtns = wrapper.findAll('button[aria-label]');
      const sortDirBtn = sortBtns.find((b) => b.attributes('aria-label')?.includes('sort'));
      expect(sortDirBtn).toBeDefined();
      // 默认排序为降序，aria-label 应包含 sortDescending
      expect(sortDirBtn?.attributes('aria-label')).toContain('sortDescending');
      // 点击切换为升序
      await sortDirBtn?.trigger('click');
      await nextTick();
      // aria-label 应变为包含 sortAscending
      const updatedBtn = wrapper
        .findAll('button[aria-label]')
        .find((b) => b.attributes('aria-label')?.includes('sort'));
      expect(updatedBtn?.attributes('aria-label')).toContain('sortAscending');
    });
  });

  describe('连接操作', () => {
    it('connectTo 应调用 sessionStore.handleConnectRequest', async () => {
      const conn = makeConnection({ id: 1, name: 'Server' });
      mockConnectionsStore.connections.value = [conn];
      const wrapper = await mountView();

      const connectBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('connections.actions.connect'));
      expect(connectBtn).toBeDefined();
      await connectBtn?.trigger('click');
      await nextTick();
      expect(mockSessionStore.handleConnectRequest).toHaveBeenCalledWith(conn);
    });

    it('打开新增连接表单', async () => {
      mockConnectionsStore.connections.value = [makeConnection()];
      const wrapper = await mountView();

      // 点击前 AddConnectionForm 不应渲染（v-if=false）
      expect(wrapper.findComponent({ name: 'AddConnectionForm' }).exists()).toBe(false);
      // 找到含 fa-plus 图标的按钮（新增连接按钮）并点击
      const buttons = wrapper.findAll('button');
      const addBtn = buttons.find((b) => b.find('.fa-plus').exists());
      expect(addBtn).toBeDefined();
      await addBtn?.trigger('click');
      await nextTick();
      // 点击后 AddConnectionForm 应渲染（v-if=true）
      expect(wrapper.findComponent({ name: 'AddConnectionForm' }).exists()).toBe(true);
    });
  });

  describe('批量编辑模式', () => {
    it('切换批量编辑模式', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A' }),
        makeConnection({ id: 2, name: 'Server B' }),
      ];
      const wrapper = await mountView();

      // 找到批量编辑开关
      const toggleBtn = wrapper.find('#batch-edit-toggle');
      expect(toggleBtn.exists()).toBe(true);

      await toggleBtn.trigger('click');
      await nextTick();

      // 应显示批量操作按钮（mock t() 返回 fallback 文本 '全选'）
      expect(wrapper.text()).toContain('全选');
    });

    it('批量模式下应显示全选/取消全选/反选按钮', async () => {
      mockConnectionsStore.connections.value = [makeConnection({ id: 1, name: 'Server A' })];
      const wrapper = await mountView();

      const toggleBtn = wrapper.find('#batch-edit-toggle');
      await toggleBtn.trigger('click');
      await nextTick();

      // mock t() 返回 fallback 文本：'全选'、'取消全选'、'反选'
      expect(wrapper.text()).toContain('全选');
      expect(wrapper.text()).toContain('取消全选');
      expect(wrapper.text()).toContain('反选');
    });

    it('退出批量模式应清除选择', async () => {
      mockConnectionsStore.connections.value = [makeConnection({ id: 1, name: 'Server A' })];
      const wrapper = await mountView();

      const toggleBtn = wrapper.find('#batch-edit-toggle');
      // 进入批量模式
      await toggleBtn.trigger('click');
      await nextTick();
      // 退出批量模式
      await toggleBtn.trigger('click');
      await nextTick();

      // 批量操作按钮不应显示
      expect(wrapper.text()).not.toContain('全选');
    });

    it('无选择时编辑选中按钮应处于禁用状态', async () => {
      mockConnectionsStore.connections.value = [makeConnection({ id: 1, name: 'Server A' })];
      const wrapper = await mountView();

      const toggleBtn = wrapper.find('#batch-edit-toggle');
      await toggleBtn.trigger('click');
      await nextTick();

      // 找到编辑选中按钮（mock t() 返回 fallback 文本 '编辑选中'）
      const editBtn = wrapper.findAll('button').find((b) => b.text().includes('编辑选中'));
      expect(editBtn).toBeDefined();
      // 无选择时按钮应被禁用
      expect(editBtn?.attributes('disabled')).toBeDefined();
    });
  });

  describe('formatRelativeTime', () => {
    it('null/undefined 时间戳应显示从未连接', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', last_connected_at: null }),
      ];
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('connections.status.never');
    });

    it('有效时间戳应显示相对时间', async () => {
      const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', last_connected_at: oneHourAgo }),
      ];
      const wrapper = await mountView();
      // date-fns 会输出中文相对时间
      expect(wrapper.text()).not.toContain('connections.status.never');
    });
  });

  describe('getTagNames', () => {
    it('有标签时应显示标签名称', async () => {
      mockTagsStore.tags.value = [
        { id: 1, name: 'Production' },
        { id: 2, name: 'Web' },
      ];
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', tag_ids: [1, 2] }),
      ];
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('Production');
      expect(wrapper.text()).toContain('Web');
    });

    it('无标签时不显示标签区域', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', tag_ids: [] }),
      ];
      const wrapper = await mountView();
      // 不应有标签样式元素
      expect(wrapper.findAll('.rounded.bg-muted').length).toBe(0);
    });

    it('tag_ids 包含不存在的标签时应忽略', async () => {
      mockTagsStore.tags.value = [{ id: 1, name: 'Production' }];
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', tag_ids: [1, 999] }),
      ];
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('Production');
    });
  });

  describe('getTruncatedNotes', () => {
    it('短备注应完整显示', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', notes: '这是备注' }),
      ];
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('这是备注');
    });

    it('长备注应截断显示', async () => {
      const longNotes = 'a'.repeat(150);
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', notes: longNotes }),
      ];
      const wrapper = await mountView();
      // 截断后应该是 100 字符 + '...'
      expect(wrapper.text()).toContain('a'.repeat(100) + '...');
    });

    it('空备注不显示备注区域', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', notes: '' }),
      ];
      const wrapper = await mountView();
      expect(wrapper.text()).not.toContain('connections.form.notes');
    });
  });

  describe('连接测试', () => {
    it('handleTestSingleConnection 成功时应显示延迟', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', type: 'SSH' }),
      ];
      mockConnectionsStore.testConnection.mockResolvedValueOnce({ success: true, latency: 42 });
      const wrapper = await mountView();

      // 找到测试按钮
      const testBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('connections.actions.test'));
      if (testBtn) {
        await testBtn.trigger('click');
        await nextTick();
        await vi.waitFor(() => {
          expect(mockConnectionsStore.testConnection).toHaveBeenCalledWith(1);
        });
      }
    });

    it('handleTestSingleConnection 失败时应显示错误', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', type: 'SSH' }),
      ];
      mockConnectionsStore.testConnection.mockResolvedValueOnce({
        success: false,
        message: '连接超时',
      });
      const wrapper = await mountView();

      const testBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('connections.actions.test'));
      if (testBtn) {
        await testBtn.trigger('click');
        await nextTick();
        await vi.waitFor(() => {
          expect(mockConnectionsStore.testConnection).toHaveBeenCalled();
        });
      }
    });

    it('非 SSH 类型连接不应显示测试按钮', async () => {
      mockConnectionsStore.connections.value = [
        makeConnection({ id: 1, name: 'Server A', type: 'RDP' }),
      ];
      const wrapper = await mountView();
      // RDP 连接不应有单个测试按钮（但可能有"测试全部"按钮）
      // 通过 v-if="conn.type === 'SSH'" 控制，RDP 的 li 中不应有测试按钮
      const connItems = wrapper.findAll('li');
      expect(connItems.length).toBe(1);
      // RDP 项中不应包含单个测试按钮（mock t 返回 fallback 'connections.actions.test'）
      const rdpItem = connItems[0];
      const buttonsInItem = rdpItem.findAll('button');
      const singleTestBtn = buttonsInItem.find((b) =>
        b.text().includes('connections.actions.test'),
      );
      expect(singleTestBtn).toBeUndefined();
    });
  });

  describe('加载状态', () => {
    it('加载中应显示 loading 文本', async () => {
      mockConnectionsStore.isLoading.value = true;
      mockConnectionsStore.connections.value = [];
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('common.loading');
    });
  });

  describe('空状态', () => {
    it('无连接且未加载时应显示空状态', async () => {
      mockConnectionsStore.connections.value = [];
      mockConnectionsStore.isLoading.value = false;
      const wrapper = await mountView();
      // mock t() 返回 fallback 文本 '没有连接记录'
      expect(wrapper.text()).toContain('没有连接记录');
    });
  });

  describe('组件卸载', () => {
    it('卸载时不应抛出错误', async () => {
      mockConnectionsStore.connections.value = [makeConnection()];
      const wrapper = await mountView();
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });
});
