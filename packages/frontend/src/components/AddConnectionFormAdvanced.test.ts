/**
 * AddConnectionFormAdvanced.vue 单元测试
 * 测试高级选项表单组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import AddConnectionFormAdvanced from './AddConnectionFormAdvanced.vue';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => {
      // 简单的映射，用于测试
      const translations: Record<string, string> = {
        'tags.loading': '加载中...',
        'proxies.loading': '加载中...',
        'connections.form.noProxy': '无代理',
      };
      return translations[key] || fallback || key;
    },
    locale: ref('zh-CN'),
  }),
}));

// Mock TagInput component
vi.mock('./TagInput.vue', () => ({
  default: {
    name: 'TagInput',
    template: '<div class="mock-tag-input"></div>',
    props: ['modelValue', 'availableTags', 'allowCreate', 'allowDelete', 'placeholder'],
    emits: ['update:modelValue', 'create-tag', 'delete-tag'],
  },
}));

// 测试数据工厂
const createMockFormData = (overrides = {}) => ({
  id: undefined as number | undefined,
  type: 'SSH' as 'SSH' | 'RDP' | 'VNC',
  proxy_id: null as number | null,
  jump_chain: [] as Array<number | null>,
  proxy_type: undefined as 'proxy' | 'jump' | undefined,
  tag_ids: [] as number[],
  notes: '',
  force_keyboard_interactive: false,
  ...overrides,
});

const createMockProxies = () => [
  {
    id: 1,
    name: 'Proxy 1',
    type: 'SOCKS5' as const,
    host: '10.0.0.1',
    port: 1080,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
  {
    id: 2,
    name: 'Proxy 2',
    type: 'HTTP' as const,
    host: '10.0.0.2',
    port: 8080,
    created_at: Date.now(),
    updated_at: Date.now(),
  },
];

const createMockConnections = () => [
  {
    id: 1,
    name: 'SSH Server 1',
    type: 'SSH' as const,
    host: '192.168.1.1',
    port: 22,
    username: 'user',
    auth_method: 'password' as const,
    created_at: Date.now(),
    updated_at: Date.now(),
    last_connected_at: null,
  },
  {
    id: 2,
    name: 'SSH Server 2',
    type: 'SSH' as const,
    host: '192.168.1.2',
    port: 22,
    username: 'user',
    auth_method: 'password' as const,
    created_at: Date.now(),
    updated_at: Date.now(),
    last_connected_at: null,
  },
  {
    id: 3,
    name: 'RDP Server',
    type: 'RDP' as const,
    host: '192.168.1.3',
    port: 3389,
    username: 'user',
    auth_method: 'password' as const,
    created_at: Date.now(),
    updated_at: Date.now(),
    last_connected_at: null,
  },
];

const createMockTags = () => [
  { id: 1, name: 'Tag 1', created_at: Date.now(), updated_at: Date.now() },
  { id: 2, name: 'Tag 2', created_at: Date.now(), updated_at: Date.now() },
];

describe('AddConnectionFormAdvanced.vue', () => {
  let wrapper: VueWrapper;
  const mockAddJumpHost = vi.fn();
  const mockRemoveJumpHost = vi.fn();
  type AdvancedFormData = ReturnType<typeof createMockFormData>;
  type AdvancedExtraProps = Partial<{
    advancedConnectionMode: 'proxy' | 'jump';
    isEditMode: boolean;
  }> &
    Record<string, unknown>;

  const createComponent = (formData: AdvancedFormData, extraProps?: AdvancedExtraProps) => {
    // 直接构建完整的 props 对象，避免展开运算符问题
    return mount(AddConnectionFormAdvanced, {
      props: {
        formData,
        proxies: createMockProxies(),
        connections: createMockConnections(),
        tags: createMockTags(),
        isProxyLoading: false,
        proxyStoreError: null,
        isTagLoading: false,
        tagStoreError: null,
        advancedConnectionMode: extraProps?.advancedConnectionMode ?? 'proxy',
        addJumpHost: mockAddJumpHost,
        removeJumpHost: mockRemoveJumpHost,
        isEditMode: extraProps?.isEditMode ?? false,
        ...extraProps,
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('渲染测试', () => {
    it('应渲染高级选项容器', () => {
      wrapper = createComponent(createMockFormData());

      expect(wrapper.find('.space-y-4').exists()).toBe(true);
      expect(wrapper.text()).toContain('高级选项');
    });

    it('应渲染 TagInput 组件', () => {
      wrapper = createComponent(createMockFormData());

      expect(wrapper.find('.mock-tag-input').exists()).toBe(true);
    });

    it('应渲染备注文本区域', () => {
      wrapper = createComponent(createMockFormData());

      expect(wrapper.find('textarea#conn-notes').exists()).toBe(true);
    });
  });

  describe('Force Keyboard Interactive 开关', () => {
    it('SSH 类型时应显示强制键盘交互式认证开关', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData);

      expect(wrapper.text()).toContain('强制键盘交互式认证');
    });

    it('SSH 类型时应显示描述文本', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData);

      expect(wrapper.text()).toContain('双因素认证');
    });

    it('RDP 类型时应不显示强制键盘交互式认证开关', () => {
      const formData = createMockFormData({ type: 'RDP' });
      wrapper = createComponent(formData);

      expect(wrapper.text()).not.toContain('强制键盘交互式认证');
    });

    it('VNC 类型时应不显示强制键盘交互式认证开关', () => {
      const formData = createMockFormData({ type: 'VNC' });
      wrapper = createComponent(formData);

      expect(wrapper.text()).not.toContain('强制键盘交互式认证');
    });

    it('默认状态下开关应为关闭', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData);

      const checkbox = wrapper.find('input[type="checkbox"]');
      expect((checkbox.element as HTMLInputElement).checked).toBe(false);
    });

    it('点击开关应通过事件传递 force_keyboard_interactive', async () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData);

      const checkbox = wrapper.find('input[type="checkbox"]');
      await (checkbox as any).setChecked(true);

      // checkbox 使用 @change → handleForceKeyboardInteractiveChange → patchFormData → emit('patch-form-data')
      const emitted = wrapper.emitted('patch-form-data');
      expect(emitted).toBeTruthy();
      expect(emitted?.[emitted.length - 1]?.[0]).toEqual({ force_keyboard_interactive: true });
    });

    it('编辑模式下应正确显示已有值', () => {
      const formData = createMockFormData({
        type: 'SSH',
        force_keyboard_interactive: true,
        id: 1,
      });
      wrapper = createComponent(formData, { isEditMode: true });

      const checkbox = wrapper.find('input[type="checkbox"]');
      expect((checkbox.element as HTMLInputElement).checked).toBe(true);
    });

    it('应仅对 SSH 类型渲染开关', () => {
      // SSH - 应该显示
      wrapper = createComponent(createMockFormData({ type: 'SSH' }));
      let checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(true);
      wrapper.unmount();

      // RDP - 不应该显示
      wrapper = createComponent(createMockFormData({ type: 'RDP' }));
      checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(false);
      wrapper.unmount();

      // VNC - 不应该显示
      wrapper = createComponent(createMockFormData({ type: 'VNC' }));
      checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(false);
    });
  });

  describe('代理选择', () => {
    it('SSH 类型且代理模式时应显示代理选择下拉框', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'proxy' });

      expect(wrapper.find('#conn-proxy').exists()).toBe(true);
    });

    it('SSH 类型但跳板机模式时应不显示代理选择', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'jump' });

      expect(wrapper.find('#conn-proxy').exists()).toBe(false);
    });

    it('RDP 类型时应不显示代理选择', () => {
      const formData = createMockFormData({ type: 'RDP' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'proxy' });

      expect(wrapper.find('#conn-proxy').exists()).toBe(false);
    });

    it('应正确显示代理列表', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'proxy' });

      expect(wrapper.text()).toContain('Proxy 1');
      expect(wrapper.text()).toContain('Proxy 2');
    });

    it('应显示"无代理"选项', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'proxy' });

      // 通过 select 找到所有 option，然后查找包含"无代理"文本的选项
      const select = wrapper.find('select#conn-proxy');
      expect(select.exists()).toBe(true);
      const options = select.findAll('option');
      const nullOption = options.find((opt) => opt.text().includes('无代理'));
      expect(nullOption).toBeDefined();
    });
  });

  describe('跳板机配置', () => {
    it('SSH 类型且跳板机模式时应显示跳板机配置区域', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'jump' });

      expect(wrapper.text()).toContain('跳板机链配置');
    });

    it('SSH 类型但代理模式时应不显示跳板机配置', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'proxy' });

      expect(wrapper.text()).not.toContain('跳板机链配置');
    });

    it('点击添加跳板机按钮应调用 addJumpHost', async () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'jump' });

      const addButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('添加跳板机'));
      await addButton?.trigger('click');

      expect(mockAddJumpHost).toHaveBeenCalled();
    });

    it('没有可用 SSH 连接时应显示警告信息', () => {
      const formData = createMockFormData({ type: 'SSH' });
      const connections = [
        { id: 1, name: 'RDP Server', type: 'RDP' as const, host: '192.168.1.1', port: 3389 },
      ];
      wrapper = createComponent(formData, {
        advancedConnectionMode: 'jump',
        connections,
      });

      expect(wrapper.text()).toContain('没有可用的SSH连接作为跳板机');
    });

    it('编辑模式下当前连接不应出现在跳板机选项中', () => {
      const formData = createMockFormData({
        type: 'SSH',
        id: 1,
        jump_chain: [null], // 添加一个跳板机条目以渲染下拉框
      });
      wrapper = createComponent(formData, {
        advancedConnectionMode: 'jump',
        isEditMode: true,
      });

      // SSH Server 1 是当前编辑的连接，不应出现在选项中
      expect(wrapper.text()).not.toContain('SSH Server 1');
      // SSH Server 2 不是当前连接，应该出现在选项中
      expect(wrapper.text()).toContain('SSH Server 2');
    });
  });

  describe('连接模式切换', () => {
    it('SSH 类型时应显示连接方式切换按钮', () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData);

      const proxyButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('代理'));
      const jumpButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('跳板机'));

      expect(proxyButton).toBeTruthy();
      expect(jumpButton).toBeTruthy();
    });

    it('RDP 类型时应不显示连接方式切换按钮', () => {
      const formData = createMockFormData({ type: 'RDP' });
      wrapper = createComponent(formData);

      const proxyButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('代理'));

      expect(proxyButton).toBeFalsy();
    });

    it('点击代理按钮应触发 update:advancedConnectionMode 事件', async () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'jump' });

      const proxyButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('代理'));
      await proxyButton?.trigger('click');

      expect(wrapper.emitted('update:advancedConnectionMode')).toBeTruthy();
      expect(wrapper.emitted('update:advancedConnectionMode')?.[0]).toEqual(['proxy']);
    });

    it('点击跳板机按钮应触发 update:advancedConnectionMode 事件', async () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'proxy' });

      const jumpButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('跳板机'));
      await jumpButton?.trigger('click');

      expect(wrapper.emitted('update:advancedConnectionMode')).toBeTruthy();
      expect(wrapper.emitted('update:advancedConnectionMode')?.[0]).toEqual(['jump']);
    });

    it('当前模式下点击同一按钮不应触发事件', async () => {
      const formData = createMockFormData({ type: 'SSH' });
      wrapper = createComponent(formData, { advancedConnectionMode: 'proxy' });

      const proxyButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('代理'));
      await proxyButton?.trigger('click');

      // 不应该触发事件，因为已经在 proxy 模式
      expect(wrapper.emitted('update:advancedConnectionMode')).toBeFalsy();
    });
  });

  describe('标签管理', () => {
    it('应渲染 TagInput 组件', () => {
      wrapper = createComponent(createMockFormData());

      expect(wrapper.find('.mock-tag-input').exists()).toBe(true);
    });

    it('create-tag 事件应正确透传', async () => {
      wrapper = createComponent(createMockFormData());

      const tagInput = wrapper.findComponent({ name: 'TagInput' });
      await tagInput.vm.$emit('create-tag', 'New Tag');

      expect(wrapper.emitted('create-tag')).toBeTruthy();
      expect(wrapper.emitted('create-tag')?.[0]).toEqual(['New Tag']);
    });

    it('delete-tag 事件应正确透传', async () => {
      wrapper = createComponent(createMockFormData());

      const tagInput = wrapper.findComponent({ name: 'TagInput' });
      await tagInput.vm.$emit('delete-tag', 1);

      expect(wrapper.emitted('delete-tag')).toBeTruthy();
      expect(wrapper.emitted('delete-tag')?.[0]).toEqual([1]);
    });
  });

  describe('备注', () => {
    it('应渲染备注文本区域', () => {
      wrapper = createComponent(createMockFormData());

      expect(wrapper.find('textarea#conn-notes').exists()).toBe(true);
    });

    it('应显示正确的占位符', () => {
      wrapper = createComponent(createMockFormData());

      expect(wrapper.find('textarea#conn-notes').attributes('placeholder')).toContain(
        '输入连接备注',
      );
    });

    it('应正确通过事件传递备注内容', async () => {
      const formData = createMockFormData();
      wrapper = createComponent(formData);

      const textarea = wrapper.find('textarea#conn-notes');
      await textarea.setValue('测试备注内容');

      // textarea 使用 @input → patchFormData → emit('patch-form-data') 模式
      // 不直接修改 prop 对象，而是通过事件向父组件传递变更
      const emitted = wrapper.emitted('patch-form-data');
      expect(emitted).toBeTruthy();
      expect(emitted?.[emitted.length - 1]?.[0]).toEqual({ notes: '测试备注内容' });
    });
  });

  describe('加载状态', () => {
    it('代理加载中时应显示加载提示', () => {
      const formData = createMockFormData();
      wrapper = createComponent(formData, { isProxyLoading: true });

      expect(wrapper.text()).toContain('加载中...');
    });

    it('标签加载中时应显示加载提示', () => {
      const formData = createMockFormData();
      wrapper = createComponent(formData, { isTagLoading: true });

      expect(wrapper.text()).toContain('加载中...');
    });

    it('代理错误时应显示错误信息', () => {
      const formData = createMockFormData();
      wrapper = createComponent(formData, { proxyStoreError: '代理加载失败' });

      expect(wrapper.text()).toContain('代理加载失败');
    });

    it('标签错误时应显示错误信息', () => {
      const formData = createMockFormData();
      wrapper = createComponent(formData, { tagStoreError: '标签加载失败' });

      expect(wrapper.text()).toContain('标签加载失败');
    });
  });
});
