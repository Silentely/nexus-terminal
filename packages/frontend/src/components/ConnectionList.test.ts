/**
 * ConnectionList.vue 单元测试
 * 测试连接列表组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, defineStore } from 'pinia';
import { ref, computed, reactive } from 'vue';
import ConnectionList from './ConnectionList.vue';
import type { ConnectionInfo } from '../stores/connections.store';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Mock vue-router
const mockPush = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock connections store
const mockDeleteConnection = vi.fn();
const mockTestConnection = vi.fn();
vi.mock('../stores/connections.store', () => ({
  useConnectionsStore: () => ({
    deleteConnection: mockDeleteConnection,
    testConnection: mockTestConnection,
    error: null,
  }),
  ConnectionInfo: {},
}));

// Mock tags store - 使用 ref 创建响应式数据以兼容 storeToRefs
const mockFetchTags = vi.fn();
const mockTagsRef = ref([
  { id: 1, name: 'Production', created_at: 1000, updated_at: 1000 },
  { id: 2, name: 'Development', created_at: 1000, updated_at: 1000 },
]);
const mockIsLoadingRef = ref(false);
const mockTagsErrorRef = ref<string | null>(null);

vi.mock('../stores/tags.store', () => ({
  useTagsStore: () => ({
    tags: mockTagsRef,
    isLoading: mockIsLoadingRef,
    error: mockTagsErrorRef,
    fetchTags: mockFetchTags,
    // Pinia store 需要 $id 属性
    $id: 'tags',
  }),
}));

// Mock confirm dialog
const mockShowConfirmDialog = vi.fn();
vi.mock('../composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    showConfirmDialog: mockShowConfirmDialog,
  }),
}));

// Mock alert dialog
const mockShowAlertDialog = vi.fn();
vi.mock('../composables/useAlertDialog', () => ({
  useAlertDialog: () => ({
    showAlertDialog: mockShowAlertDialog,
  }),
}));

describe('ConnectionList.vue', () => {
  const mockConnections: ConnectionInfo[] = [
    {
      id: 1,
      name: 'Server A',
      type: 'SSH',
      host: '192.168.1.1',
      port: 22,
      username: 'admin',
      auth_method: 'password',
      tag_ids: [1],
      created_at: 1700000000,
      updated_at: 1700000000,
      last_connected_at: 1700100000,
    },
    {
      id: 2,
      name: 'Server B',
      type: 'SSH',
      host: '192.168.1.2',
      port: 22,
      username: 'root',
      auth_method: 'key',
      tag_ids: [2],
      created_at: 1700000000,
      updated_at: 1700000000,
      last_connected_at: null,
    },
    {
      id: 3,
      name: 'RDP Server',
      type: 'RDP',
      host: '192.168.1.3',
      port: 3389,
      username: 'admin',
      auth_method: 'password',
      tag_ids: [],
      created_at: 1700000000,
      updated_at: 1700000000,
      last_connected_at: 1700200000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    mockShowConfirmDialog.mockResolvedValue(true);
    mockDeleteConnection.mockResolvedValue(true);
    mockTestConnection.mockResolvedValue({ success: true });

    // 重置 mock refs
    mockTagsRef.value = [
      { id: 1, name: 'Production', created_at: 1000, updated_at: 1000 },
      { id: 2, name: 'Development', created_at: 1000, updated_at: 1000 },
    ];
    mockIsLoadingRef.value = false;
    mockTagsErrorRef.value = null;
  });

  describe('渲染测试', () => {
    it('应正确渲染连接列表', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      expect(wrapper.find('.mt-2').exists()).toBe(true);
      // 应该有分组标题
      const groups = wrapper.findAll('h4');
      expect(groups.length).toBeGreaterThanOrEqual(2);
    });

    it('无连接时应显示空状态', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: [] },
      });

      // 应该只有未标记分组
      const untaggedText = wrapper.text();
      expect(untaggedText).toContain('connections.untaggedGroup');
    });

    it('应显示连接的基本信息', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      expect(wrapper.text()).toContain('Server A');
      expect(wrapper.text()).toContain('192.168.1.1');
      expect(wrapper.text()).toContain('22');
      expect(wrapper.text()).toContain('admin');
    });

    it('应为 RDP/VNC 连接显示桌面图标', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      // RDP 连接应该有 fa-desktop 图标
      const desktopIcons = wrapper.findAll('.fa-desktop');
      expect(desktopIcons.length).toBeGreaterThanOrEqual(1);
    });

    it('应为 SSH 连接显示服务器图标', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      // SSH 连接应该有 fa-server 图标
      const serverIcons = wrapper.findAll('.fa-server');
      expect(serverIcons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('分组逻辑', () => {
    it('应按标签分组连接', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;
      const grouped = vm.groupedConnections;

      // Production 组应有 1 个连接
      expect(grouped.Production?.length).toBe(1);
      expect(grouped.Production?.[0].name).toBe('Server A');

      // Development 组应有 1 个连接
      expect(grouped.Development?.length).toBe(1);
      expect(grouped.Development?.[0].name).toBe('Server B');
    });

    it('未标记的连接应归入 _untagged_ 组', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;
      const grouped = vm.groupedConnections;

      // _untagged_ 组应有 1 个连接（RDP Server）
      expect(grouped._untagged_?.length).toBe(1);
      expect(grouped._untagged_?.[0].name).toBe('RDP Server');
    });

    it('应按名称排序每个分组内的连接', () => {
      const connectionsWithSameTag: ConnectionInfo[] = [
        { ...mockConnections[0], id: 1, name: 'Zebra', tag_ids: [1] },
        { ...mockConnections[0], id: 2, name: 'Alpha', tag_ids: [1] },
        { ...mockConnections[0], id: 3, name: 'Beta', tag_ids: [1] },
      ];

      const wrapper = mount(ConnectionList, {
        props: { connections: connectionsWithSameTag },
      });

      const vm = wrapper.vm as any;
      const grouped = vm.groupedConnections;

      expect(grouped.Production[0].name).toBe('Alpha');
      expect(grouped.Production[1].name).toBe('Beta');
      expect(grouped.Production[2].name).toBe('Zebra');
    });
  });

  describe('标签显示', () => {
    it('应正确显示连接的标签名称', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;

      // Server A 有 tag_ids: [1]，对应 Production
      const tagNames = vm.getConnectionTagNames(mockConnections[0]);
      expect(tagNames).toContain('Production');
    });

    it('无标签的连接应返回空数组', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;

      // RDP Server 无标签
      const tagNames = vm.getConnectionTagNames(mockConnections[2]);
      expect(tagNames).toEqual([]);
    });
  });

  describe('时间格式化', () => {
    it('应正确格式化最后连接时间', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;

      // 有时间戳的情况
      const formatted = vm.formatTimestamp(1700000000);
      expect(formatted).toBeTruthy();
      expect(formatted).not.toBe('connections.status.never');
    });

    it('无连接记录时应显示"从未连接"', () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;

      // null 时间戳
      const formatted = vm.formatTimestamp(null);
      expect(formatted).toBe('connections.status.never');
    });
  });

  describe('事件处理', () => {
    it('点击编辑按钮应触发 edit-connection 事件', async () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      // 找到编辑按钮
      const editButtons = wrapper
        .findAll('button')
        .filter((b) => b.text().includes('connections.actions.edit'));

      if (editButtons.length > 0) {
        await editButtons[0].trigger('click');
        expect(wrapper.emitted('edit-connection')).toBeTruthy();
      }
    });

    it('点击删除按钮应调用 handleDelete', async () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      // 找到删除按钮
      const deleteButtons = wrapper
        .findAll('button')
        .filter((b) => b.text().includes('connections.actions.delete'));

      if (deleteButtons.length > 0) {
        await deleteButtons[0].trigger('click');
        expect(mockShowConfirmDialog).toHaveBeenCalled();
      }
    });

    it('删除确认后应调用 deleteConnection', async () => {
      mockShowConfirmDialog.mockResolvedValue(true);
      mockDeleteConnection.mockResolvedValue(true);

      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;
      await vm.handleDelete(mockConnections[0]);

      expect(mockShowConfirmDialog).toHaveBeenCalled();
      expect(mockDeleteConnection).toHaveBeenCalledWith(1);
    });

    it('取消删除确认不应调用 deleteConnection', async () => {
      mockShowConfirmDialog.mockResolvedValue(false);

      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;
      await vm.handleDelete(mockConnections[0]);

      expect(mockShowConfirmDialog).toHaveBeenCalled();
      expect(mockDeleteConnection).not.toHaveBeenCalled();
    });

    it('删除失败时应显示错误对话框', async () => {
      mockShowConfirmDialog.mockResolvedValue(true);
      mockDeleteConnection.mockResolvedValue(false);

      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;
      await vm.handleDelete(mockConnections[0]);

      expect(mockShowAlertDialog).toHaveBeenCalled();
    });
  });

  describe('测试连接功能', () => {
    it('点击测试按钮应调用 testConnection', async () => {
      mockTestConnection.mockResolvedValue({ success: true });

      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;
      await vm.handleTestConnection(1);

      expect(mockTestConnection).toHaveBeenCalledWith(1);
    });

    it('测试成功应显示成功对话框', async () => {
      mockTestConnection.mockResolvedValue({ success: true });

      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;
      await vm.handleTestConnection(1);

      expect(mockShowAlertDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'common.success' })
      );
    });

    it('测试失败应显示错误对话框', async () => {
      mockTestConnection.mockResolvedValue({ success: false, message: 'Connection refused' });

      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;
      await vm.handleTestConnection(1);

      expect(mockShowAlertDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'common.error' })
      );
    });

    it('测试中状态应禁用测试按钮', async () => {
      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      const vm = wrapper.vm as any;

      // 设置测试中状态
      vm.testingState[1] = true;
      await wrapper.vm.$nextTick();

      // 检查按钮是否显示 "testing" 文本
      const testButtons = wrapper
        .findAll('button')
        .filter((b) => b.text().includes('connections.actions.testing'));
      expect(testButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('组件挂载', () => {
    it('挂载时应获取标签列表', () => {
      mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      expect(mockFetchTags).toHaveBeenCalled();
    });
  });

  describe('错误处理', () => {
    it('标签加载错误时组件应正常渲染', async () => {
      mockTagsErrorRef.value = 'Failed to load tags';

      const wrapper = mount(ConnectionList, {
        props: { connections: mockConnections },
      });

      // 组件应该正常渲染
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('边界条件', () => {
    it('应处理连接有无效标签 ID 的情况', () => {
      const connectionsWithInvalidTag: ConnectionInfo[] = [
        { ...mockConnections[0], tag_ids: [999] }, // 无效的标签 ID
      ];

      const wrapper = mount(ConnectionList, {
        props: { connections: connectionsWithInvalidTag },
      });

      const vm = wrapper.vm as any;
      const tagNames = vm.getConnectionTagNames(connectionsWithInvalidTag[0]);

      // 无效标签应被过滤掉
      expect(tagNames).toEqual([]);
    });

    it('应处理连接同时有多个标签的情况', () => {
      const connectionsWithMultipleTags: ConnectionInfo[] = [
        { ...mockConnections[0], tag_ids: [1, 2] }, // 两个标签
      ];

      const wrapper = mount(ConnectionList, {
        props: { connections: connectionsWithMultipleTags },
      });

      const vm = wrapper.vm as any;
      const tagNames = vm.getConnectionTagNames(connectionsWithMultipleTags[0]);

      expect(tagNames).toContain('Production');
      expect(tagNames).toContain('Development');
    });

    it('应处理 tag_ids 为 undefined 的情况', () => {
      const connectionsWithoutTagIds: ConnectionInfo[] = [
        { ...mockConnections[0], tag_ids: undefined },
      ];

      const wrapper = mount(ConnectionList, {
        props: { connections: connectionsWithoutTagIds },
      });

      const vm = wrapper.vm as any;
      const grouped = vm.groupedConnections;

      // 应归入未标记组
      expect(grouped._untagged_?.length).toBe(1);
    });
  });
});
