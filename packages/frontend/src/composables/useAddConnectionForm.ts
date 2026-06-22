import { ref, reactive, watch, computed, onMounted, toRefs } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import apiClient from '../utils/apiClient';
import { useConnectionsStore, ConnectionInfo } from '../stores/connections.store';
import { useProxiesStore } from '../stores/proxies.store';
import { useTagsStore } from '../stores/tags.store';
import { useSshKeysStore } from '../stores/sshKeys.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { useConfirmDialog } from './useConfirmDialog';
import { useAlertDialog } from './useAlertDialog';
import { createScriptModeSubmit } from './useAddConnectionFormScriptMode';
import { type ConnectionType, type AuthMethod, parseIpRange } from './useAddConnectionFormParsers';
import { createSubmitHandler, createDeleteHandler } from './useAddConnectionFormSubmit';
import { createTagHandlers } from './useAddConnectionFormTags';
import { createTestConnection } from './useAddConnectionFormTest';
import { log } from '@/utils/log';

// Define Props interface based on the component's props
interface AddConnectionFormProps {
  connectionToEdit: ConnectionInfo | null;
}

// Define Emits type based on the component's emits
type AddConnectionFormEmits = {
  (e: 'close'): void;
  (e: 'connection-added'): void;
  (e: 'connection-updated'): void;
  (e: 'connection-deleted'): void;
};

type JumpChain = Array<number | null> | null;

export function useAddConnectionForm(props: AddConnectionFormProps, emit: AddConnectionFormEmits) {
  const { connectionToEdit } = toRefs(props);

  const { t } = useI18n();
  const { showConfirmDialog } = useConfirmDialog();
  const { showAlertDialog } = useAlertDialog();
  const connectionsStore = useConnectionsStore();
  const proxiesStore = useProxiesStore();
  const tagsStore = useTagsStore();
  const sshKeysStore = useSshKeysStore();
  const uiNotificationsStore = useUiNotificationsStore();

  const { isLoading: isConnLoading, connections } = storeToRefs(connectionsStore);
  const { proxies, isLoading: isProxyLoading, error: proxyStoreError } = storeToRefs(proxiesStore);
  const { tags, isLoading: isTagLoading, error: tagStoreError } = storeToRefs(tagsStore);
  const { sshKeys, isLoading: isSshKeyLoading } = storeToRefs(sshKeysStore);

  // 表单数据模型
  const initialFormData = {
    type: 'SSH' as ConnectionType,
    name: '',
    host: '',
    port: 22,
    username: '',
    auth_method: 'password' as AuthMethod,
    password: '',
    private_key: '',
    passphrase: '',
    selected_ssh_key_id: null as number | null,
    proxy_id: null as number | null,
    jump_chain: null as JumpChain,
    proxy_type: null as 'proxy' | 'jump' | null,
    tag_ids: [] as number[],
    notes: '',
    vncPassword: '',
    force_keyboard_interactive: false,
  };

  // Telnet 类型时的默认端口
  const telnetDefaultPort = 23;
  const formData = reactive({ ...initialFormData });

  const formError = ref<string | null>(null); // 表单级别的错误信息
  const advancedConnectionMode = ref<'proxy' | 'jump'>('proxy');

  // 合并所有 store 的加载和错误状态
  const isLoading = computed(
    () =>
      isConnLoading.value || isProxyLoading.value || isTagLoading.value || isSshKeyLoading.value,
  ); // +++ Include SSH Key loading +++

  // 测试连接状态
  const testStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle');
  const testResult = ref<string | number | null>(null); // 存储延迟或错误信息
  const testLatency = ref<number | null>(null); // 单独存储延迟用于颜色计算

  // Script Mode State
  const isScriptModeActive = ref(false);
  const scriptInputText = ref('');

  // 计算属性判断是否为编辑模式
  const isEditMode = computed(() => !!connectionToEdit.value);

  // When switching to edit mode, disable script mode
  watch(isEditMode, (editing) => {
    if (editing) {
      isScriptModeActive.value = false;
    }
  });

  // 计算属性动态设置表单标题
  const formTitle = computed(() => {
    return isEditMode.value ? t('connections.form.titleEdit') : t('connections.form.title');
  });

  // 计算属性动态设置提交按钮文本
  const submitButtonText = computed(() => {
    if (isLoading.value) {
      return isEditMode.value ? t('connections.form.saving') : t('connections.form.adding');
    }
    return isEditMode.value ? t('connections.form.confirmEdit') : t('connections.form.confirm');
  });

  // 监听 prop 变化以填充或重置表单
  watch(
    connectionToEdit,
    (newVal) => {
      formError.value = null; // 清除错误
      if (newVal) {
        formData.type = newVal.type as 'SSH' | 'RDP' | 'VNC' | 'Telnet';
        formData.name = newVal.name;
        formData.host = newVal.host;
        formData.port = newVal.port;
        formData.username = newVal.username;
        formData.auth_method = newVal.auth_method;
        formData.proxy_id = newVal.proxy_id ?? null;
        formData.proxy_type = newVal.proxy_type ?? null;
        formData.jump_chain = newVal.jump_chain ? structuredClone(newVal.jump_chain) : null;
        log.info('[Debug] watch connectionToEdit - newVal.jump_chain:', newVal.jump_chain);
        log.info(
          '[Debug] watch connectionToEdit - formData.jump_chain initialized:',
          formData.jump_chain,
        );
        formData.notes = newVal.notes ?? '';
        formData.tag_ids = newVal.tag_ids ? [...newVal.tag_ids] : [];

        formData.force_keyboard_interactive = newVal.force_keyboard_interactive ?? false;

        if (newVal.type === 'SSH' && newVal.auth_method === 'key') {
          formData.selected_ssh_key_id = newVal.ssh_key_id ?? null;
        } else {
          formData.selected_ssh_key_id = null;
        }

        if (newVal.proxy_type === 'jump' && newVal.jump_chain && newVal.jump_chain.length > 0) {
          advancedConnectionMode.value = 'jump';
        } else if (
          newVal.proxy_type === 'proxy' &&
          newVal.proxy_id !== null &&
          newVal.proxy_id !== undefined
        ) {
          advancedConnectionMode.value = 'proxy';
        } else if (
          newVal.jump_chain &&
          newVal.jump_chain.length > 0 &&
          (newVal.proxy_id === null || newVal.proxy_id === undefined)
        ) {
          advancedConnectionMode.value = 'jump';
        } else {
          advancedConnectionMode.value = 'proxy';
        }

        formData.password = '';
        formData.private_key = '';
        formData.passphrase = '';
        if (newVal.type !== 'VNC') {
          formData.vncPassword = '';
        } else {
          formData.vncPassword = ''; // 保持原逻辑或根据需求调整
        }
      } else {
        Object.assign(formData, initialFormData);
        formData.tag_ids = [];
        formData.selected_ssh_key_id = null;
        formData.notes = '';
        formData.vncPassword = '';
        formData.jump_chain = null;
        formData.proxy_type = null;
        formData.force_keyboard_interactive = false;
        log.info('[Debug] watch connectionToEdit - formData.jump_chain reset');
        advancedConnectionMode.value = 'proxy';
      }
    },
    { immediate: true },
  );

  // 组件挂载时获取代理、标签和 SSH 密钥列表
  onMounted(() => {
    proxiesStore.fetchProxies();
    tagsStore.fetchTags();
    sshKeysStore.fetchSshKeys();
  });

  // 监听连接类型变化，动态调整默认端口
  watch(
    () => formData.type,
    (newType) => {
      if (newType === 'RDP') {
        if (formData.port === 22 || formData.port === 5900 || formData.port === 5901)
          formData.port = 3389;
        formData.auth_method = 'password';
        formData.selected_ssh_key_id = null;
      } else if (newType === 'SSH') {
        if (formData.port === 3389 || formData.port === 5900 || formData.port === 5901)
          formData.port = 22;
      } else if (newType === 'VNC') {
        if (formData.port === 22 || formData.port === 3389) formData.port = 5900;
        formData.auth_method = 'password';
        formData.selected_ssh_key_id = null;
      } else if (newType === 'Telnet') {
        if (formData.port === 22 || formData.port === 3389 || formData.port === 5900)
          formData.port = telnetDefaultPort;
        formData.auth_method = 'password';
        formData.selected_ssh_key_id = null;
      }
    },
  );

  watch(
    [() => formData.type, advancedConnectionMode],
    ([newType, newAdvMode]) => {
      if (newType === 'SSH') {
        if (newAdvMode === 'proxy') {
          formData.proxy_type = 'proxy';
        } else if (newAdvMode === 'jump') {
          formData.proxy_type = 'jump';
        } else {
          formData.proxy_type = null;
        }
      } else {
        formData.proxy_type = null;
      }
      log.info(
        `[Debug] useAddConnectionForm: proxy_type set to ${formData.proxy_type} (type: ${newType}, mode: ${newAdvMode})`,
      );
    },
    { immediate: true },
  );

  // 脚本模式提交处理器（委托给子模块）
  const handleScriptModeSubmit = createScriptModeSubmit({
    scriptInputText,
    emit: emit as (e: 'connection-added') => void,
    connectionsStore,
    proxiesStore,
    tagsStore,
    sshKeysStore,
    uiNotificationsStore,
    proxies,
    tags,
    sshKeys,
    t,
  });

  // 绑定 t 函数到纯函数解析器
  const parseIpRangeBound = (ipRangeStr: string) => parseIpRange(ipRangeStr, t);

  // 表单提交处理器（委托给子模块）
  const handleSubmit = createSubmitHandler({
    formData,
    isEditMode,
    connectionToEdit,
    isScriptModeActive,
    handleScriptModeSubmit,
    parseIpRange: parseIpRangeBound,
    formError,
    connectionsStore,
    proxiesStore,
    uiNotificationsStore,
    tags,
    emit,
    t,
  });

  // 删除连接处理器（委托给子模块）
  const handleDeleteConnection = createDeleteHandler({
    isEditMode,
    connectionToEdit,
    showConfirmDialog,
    formError,
    connectionsStore,
    uiNotificationsStore,
    emit,
    t,
  });

  // 标签管理处理器（委托给子模块）
  const { handleCreateTag, handleDeleteTag } = createTagHandlers({
    formData,
    tags,
    tagsStore,
    showConfirmDialog,
    showAlertDialog,
    t,
  });

  // 测试连接处理器（委托给子模块）
  const { handleTestConnection, latencyColor, testButtonText } = createTestConnection({
    formData,
    isEditMode,
    connectionToEdit,
    testStatus,
    testResult,
    testLatency,
    uiNotificationsStore,
    apiClient,
    t,
  });

  // --- Jump Host Chain Management ---
  const addJumpHost = () => {
    if (formData.jump_chain === null || formData.jump_chain === undefined) {
      formData.jump_chain = [];
    }
    formData.jump_chain.push(null);
  };

  const removeJumpHost = (index: number) => {
    if (formData.jump_chain && index >= 0 && index < formData.jump_chain.length) {
      formData.jump_chain.splice(index, 1);
    }
  };

  return {
    formData,
    isLoading,
    testStatus,
    testResult,
    testLatency,
    isScriptModeActive,
    scriptInputText,
    isEditMode,
    formTitle,
    submitButtonText,
    proxies, // for <select>
    tags, // for <TagInput :available-tags="tags">
    isProxyLoading,
    proxyStoreError,
    isTagLoading,
    tagStoreError,
    handleSubmit,
    handleDeleteConnection,
    handleTestConnection,
    handleCreateTag,
    handleDeleteTag,
    latencyColor,
    testButtonText,
    advancedConnectionMode,
    addJumpHost,
    removeJumpHost,
    connections,
  };
}
