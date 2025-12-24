/**
 * AddConnectionForm.vue 单元测试
 * 测试连接表单组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref, computed } from 'vue';
import AddConnectionForm from './AddConnectionForm.vue';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
    locale: ref('zh-CN'),
  }),
}));

// Mock language utils
vi.mock('../utils/languageUtils', () => ({
  getTranslation: (key: string) => key,
}));

// Mock child components
vi.mock('./AddConnectionFormBasicInfo.vue', () => ({
  default: {
    name: 'AddConnectionFormBasicInfo',
    template: '<div class="mock-basic-info"></div>',
    props: ['formData'],
  },
}));

vi.mock('./AddConnectionFormAuth.vue', () => ({
  default: {
    name: 'AddConnectionFormAuth',
    template: '<div class="mock-auth"></div>',
    props: ['formData', 'isEditMode'],
  },
}));

vi.mock('./AddConnectionFormAdvanced.vue', () => ({
  default: {
    name: 'AddConnectionFormAdvanced',
    template: '<div class="mock-advanced"></div>',
    props: [
      'formData',
      'proxies',
      'tags',
      'connections',
      'isProxyLoading',
      'proxyStoreError',
      'isTagLoading',
      'tagStoreError',
      'advancedConnectionMode',
      'addJumpHost',
      'removeJumpHost',
    ],
    emits: ['update:advancedConnectionMode', 'create-tag', 'delete-tag'],
  },
}));

// Mock useAddConnectionForm composable
const mockHandleSubmit = vi.fn();
const mockHandleDeleteConnection = vi.fn();
const mockHandleTestConnection = vi.fn();
const mockHandleCreateTag = vi.fn();
const mockHandleDeleteTag = vi.fn();
const mockAddJumpHost = vi.fn();
const mockRemoveJumpHost = vi.fn();

const mockIsScriptModeActive = ref(false);
const mockIsEditMode = ref(false);
const mockFormData = ref({
  name: '',
  type: 'SSH',
  host: '',
  port: 22,
  username: '',
  auth_method: 'password',
  password: '',
});
const mockIsLoading = ref(false);
const mockTestStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle');
const mockTestResult = ref('');
const mockTestLatency = ref(0);
const mockFormTitle = ref('connections.form.addTitle');
const mockSubmitButtonText = ref('connections.form.addButton');
const mockTestButtonText = ref('connections.test.button');
const mockAdvancedConnectionMode = ref<'proxy' | 'jump'>('proxy');

vi.mock('../composables/useAddConnectionForm', () => ({
  useAddConnectionForm: () => ({
    formData: mockFormData,
    isLoading: mockIsLoading,
    testStatus: mockTestStatus,
    testResult: mockTestResult,
    testLatency: mockTestLatency,
    isScriptModeActive: mockIsScriptModeActive,
    scriptInputText: ref(''),
    isEditMode: mockIsEditMode,
    formTitle: mockFormTitle,
    submitButtonText: mockSubmitButtonText,
    proxies: ref([]),
    tags: ref([]),
    connections: ref([]),
    isProxyLoading: ref(false),
    proxyStoreError: ref(null),
    isTagLoading: ref(false),
    tagStoreError: ref(null),
    advancedConnectionMode: mockAdvancedConnectionMode,
    addJumpHost: mockAddJumpHost,
    removeJumpHost: mockRemoveJumpHost,
    handleSubmit: mockHandleSubmit,
    handleDeleteConnection: mockHandleDeleteConnection,
    handleTestConnection: mockHandleTestConnection,
    handleCreateTag: mockHandleCreateTag,
    handleDeleteTag: mockHandleDeleteTag,
    latencyColor: computed(() => 'green'),
    testButtonText: mockTestButtonText,
  }),
}));

describe('AddConnectionForm.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // 重置 mock refs
    mockIsScriptModeActive.value = false;
    mockIsEditMode.value = false;
    mockFormData.value = {
      name: '',
      type: 'SSH',
      host: '',
      port: 22,
      username: '',
      auth_method: 'password',
      password: '',
    };
    mockIsLoading.value = false;
    mockTestStatus.value = 'idle';
    mockTestResult.value = '';
    mockFormTitle.value = 'connections.form.addTitle';
    mockSubmitButtonText.value = 'connections.form.addButton';
    mockAdvancedConnectionMode.value = 'proxy';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('渲染测试', () => {
    it('应渲染表单容器', () => {
      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      expect(wrapper.find('.fixed').exists()).toBe(true);
      expect(wrapper.find('form').exists()).toBe(true);
    });

    it('应显示正确的表单标题', () => {
      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      expect(wrapper.text()).toContain('connections.form.addTitle');
    });

    it('应渲染子组件（非脚本模式）', () => {
      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      expect(wrapper.find('.mock-basic-info').exists()).toBe(true);
      expect(wrapper.find('.mock-auth').exists()).toBe(true);
      expect(wrapper.find('.mock-advanced').exists()).toBe(true);
    });

    it('应显示提交按钮', () => {
      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const submitButton = wrapper.find('button[type="submit"]');
      expect(submitButton.exists()).toBe(true);
      expect(submitButton.text()).toContain('connections.form.addButton');
    });

    it('应显示取消按钮', () => {
      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const cancelButton = wrapper.findAll('button').find((b) => b.text().includes('cancel'));
      expect(cancelButton).toBeTruthy();
    });

    it('SSH 类型时应显示测试按钮', () => {
      mockFormData.value.type = 'SSH';

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      expect(wrapper.text()).toContain('connections.test.button');
    });
  });

  describe('编辑模式', () => {
    it('编辑模式应显示删除按钮', async () => {
      mockIsEditMode.value = true;

      const wrapper = mount(AddConnectionForm, {
        props: {
          connectionToEdit: {
            id: 1,
            name: 'Test Server',
            type: 'SSH',
            host: '192.168.1.1',
            port: 22,
            username: 'admin',
            auth_method: 'password',
            tag_ids: [],
            created_at: Date.now(),
            updated_at: Date.now(),
            last_connected_at: null,
          },
        },
      });

      const deleteButton = wrapper
        .findAll('button')
        .find((b) => b.text().includes('connections.actions.delete'));
      expect(deleteButton).toBeTruthy();
    });

    it('新增模式不应显示删除按钮', () => {
      mockIsEditMode.value = false;

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const deleteButton = wrapper
        .findAll('button')
        .find((b) => b.text().includes('connections.actions.delete'));
      expect(deleteButton).toBeFalsy();
    });
  });

  describe('脚本模式', () => {
    it('应显示脚本模式切换开关（新增模式）', () => {
      mockIsEditMode.value = false;

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      // 组件使用 t() 的 fallback 值 "脚本模式"
      expect(wrapper.text()).toContain('脚本模式');
      const switchButton = wrapper.find('button[role="switch"]');
      expect(switchButton.exists()).toBe(true);
    });

    it('点击开关应切换脚本模式', async () => {
      mockIsEditMode.value = false;

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const switchButton = wrapper.find('button[role="switch"]');
      expect(switchButton.attributes('aria-checked')).toBe('false');

      await switchButton.trigger('click');

      expect(mockIsScriptModeActive.value).toBe(true);
    });

    it('脚本模式激活时应显示文本区域', async () => {
      mockIsScriptModeActive.value = true;

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      expect(wrapper.find('textarea#conn-script-input').exists()).toBe(true);
    });

    it('脚本模式激活时不应渲染常规表单组件', async () => {
      mockIsScriptModeActive.value = true;

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      expect(wrapper.find('.mock-basic-info').exists()).toBe(false);
      expect(wrapper.find('.mock-auth').exists()).toBe(false);
      expect(wrapper.find('.mock-advanced').exists()).toBe(false);
    });

    it('编辑模式不应显示脚本模式切换', () => {
      mockIsEditMode.value = true;

      const wrapper = mount(AddConnectionForm, {
        props: {
          connectionToEdit: {
            id: 1,
            name: 'Test',
            type: 'SSH',
            host: '1.1.1.1',
            port: 22,
            username: 'admin',
            auth_method: 'password',
            tag_ids: [],
            created_at: Date.now(),
            updated_at: Date.now(),
            last_connected_at: null,
          },
        },
      });

      const switchButton = wrapper.find('button[role="switch"]');
      expect(switchButton.exists()).toBe(false);
    });
  });

  describe('表单操作', () => {
    it('点击提交按钮应调用 handleSubmit', async () => {
      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const submitButton = wrapper.find('button[type="submit"]');
      await submitButton.trigger('click');

      expect(mockHandleSubmit).toHaveBeenCalled();
    });

    it('点击取消按钮应触发 close 事件', async () => {
      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const cancelButton = wrapper.findAll('button').find((b) => b.text().includes('cancel'));
      await cancelButton?.trigger('click');

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('点击删除按钮应调用 handleDeleteConnection', async () => {
      mockIsEditMode.value = true;

      const wrapper = mount(AddConnectionForm, {
        props: {
          connectionToEdit: {
            id: 1,
            name: 'Test',
            type: 'SSH',
            host: '1.1.1.1',
            port: 22,
            username: 'admin',
            auth_method: 'password',
            tag_ids: [],
            created_at: Date.now(),
            updated_at: Date.now(),
            last_connected_at: null,
          },
        },
      });

      const deleteButton = wrapper
        .findAll('button')
        .find((b) => b.text().includes('connections.actions.delete'));
      await deleteButton?.trigger('click');

      expect(mockHandleDeleteConnection).toHaveBeenCalled();
    });

    it('点击测试按钮应调用 handleTestConnection', async () => {
      mockFormData.value.type = 'SSH';

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const testButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('connections.test.button'));
      await testButton?.trigger('click');

      expect(mockHandleTestConnection).toHaveBeenCalled();
    });
  });

  describe('测试连接状态', () => {
    it('测试中应显示加载状态', () => {
      mockFormData.value.type = 'SSH';
      mockTestStatus.value = 'testing';

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      // 组件使用 t() 的 fallback 值 "测试中..."
      expect(wrapper.text()).toContain('测试中...');
      expect(wrapper.find('.animate-spin').exists()).toBe(true);
    });

    it('测试成功应显示结果', () => {
      mockFormData.value.type = 'SSH';
      mockTestStatus.value = 'success';
      mockTestResult.value = '100ms';

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      expect(wrapper.text()).toContain('100ms');
    });

    it('测试失败应显示错误信息', () => {
      mockFormData.value.type = 'SSH';
      mockTestStatus.value = 'error';
      mockTestResult.value = 'Connection refused';

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      expect(wrapper.text()).toContain('Connection refused');
    });
  });

  describe('按钮禁用状态', () => {
    it('加载中应禁用提交按钮', () => {
      mockIsLoading.value = true;

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const submitButton = wrapper.find('button[type="submit"]');
      expect(submitButton.attributes('disabled')).toBeDefined();
    });

    it('测试中应禁用提交按钮', () => {
      mockFormData.value.type = 'SSH';
      mockTestStatus.value = 'testing';

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const submitButton = wrapper.find('button[type="submit"]');
      expect(submitButton.attributes('disabled')).toBeDefined();
    });

    it('加载中应禁用取消按钮', () => {
      mockIsLoading.value = true;

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const cancelButton = wrapper.findAll('button').find((b) => b.text().includes('cancel'));
      expect(cancelButton?.attributes('disabled')).toBeDefined();
    });

    it('测试中应禁用测试按钮', () => {
      mockFormData.value.type = 'SSH';
      mockTestStatus.value = 'testing';

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const testButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('connections.test.button'));
      expect(testButton?.attributes('disabled')).toBeDefined();
    });
  });

  describe('非 SSH 类型', () => {
    it('RDP 类型不应显示测试按钮', () => {
      mockFormData.value.type = 'RDP';

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const testButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('connections.test.button'));
      expect(testButton).toBeFalsy();
    });

    it('VNC 类型不应显示测试按钮', () => {
      mockFormData.value.type = 'VNC';

      const wrapper = mount(AddConnectionForm, {
        props: { connectionToEdit: null },
      });

      const testButton = wrapper
        .findAll('button[type="button"]')
        .find((b) => b.text().includes('connections.test.button'));
      expect(testButton).toBeFalsy();
    });
  });
});
