/**
 * 连接表单 - 提交与删除处理器模块
 * 职责：表单验证、批量 IP 创建、单条 CRUD 操作、删除连接
 */
import type { Ref, ComputedRef } from 'vue';
import type { ConnectionInfo, useConnectionsStore } from '../stores/connections.store';
import type { useProxiesStore } from '../stores/proxies.store';
import type { useUiNotificationsStore } from '../stores/uiNotifications.store';
import type { TranslateFn } from '../types/i18n.types';
import type { ConnectionPayload, ConnectionType, AuthMethod } from './useAddConnectionFormParsers';

/** 表单数据形状（仅包含提交处理器需要的字段） */
interface FormDataShape {
  type: ConnectionType;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: AuthMethod;
  password: string;
  selected_ssh_key_id: number | null;
  proxy_id: number | null;
  jump_chain: Array<number | null> | null;
  proxy_type: 'proxy' | 'jump' | null;
  tag_ids: number[];
  notes: string;
  vncPassword: string;
  force_keyboard_interactive: boolean;
}

/** 表单提交事件 */
type SubmitEmits = {
  (e: 'close'): void;
  (e: 'connection-added'): void;
  (e: 'connection-updated'): void;
  (e: 'connection-deleted'): void;
};

/** 提交处理器依赖 */
export interface SubmitDeps {
  formData: FormDataShape;
  isEditMode: ComputedRef<boolean>;
  connectionToEdit: Ref<ConnectionInfo | null>;
  isScriptModeActive: Ref<boolean>;
  handleScriptModeSubmit: () => Promise<void>;
  parseIpRange: (ipRangeStr: string) => string[] | { error: string };
  formError: Ref<string | null>;
  connectionsStore: ReturnType<typeof useConnectionsStore>;
  proxiesStore: ReturnType<typeof useProxiesStore>;
  uiNotificationsStore: ReturnType<typeof useUiNotificationsStore>;
  tags: Ref<Array<{ id: number }>>;
  emit: SubmitEmits;
  t: TranslateFn;
}

/** 删除处理器依赖 */
export interface DeleteDeps {
  isEditMode: ComputedRef<boolean>;
  connectionToEdit: Ref<ConnectionInfo | null>;
  showConfirmDialog: (opts: { message: string }) => Promise<boolean>;
  formError: Ref<string | null>;
  connectionsStore: ReturnType<typeof useConnectionsStore>;
  uiNotificationsStore: ReturnType<typeof useUiNotificationsStore>;
  emit: {
    (e: 'close'): void;
    (e: 'connection-deleted'): void;
  };
  t: TranslateFn;
}

/**
 * 创建表单提交处理器
 * 包含脚本模式委托、表单验证、批量 IP 创建、单条创建/更新
 */
export function createSubmitHandler(deps: SubmitDeps) {
  const {
    formData,
    isEditMode,
    connectionToEdit,
    isScriptModeActive,
    handleScriptModeSubmit,
    parseIpRange,
    t,
    formError,
    connectionsStore,
    proxiesStore,
    uiNotificationsStore,
    tags,
    emit,
  } = deps;

  return async () => {
    if (isScriptModeActive.value) {
      await handleScriptModeSubmit();
      return;
    }

    formError.value = null;
    connectionsStore.error = null;
    proxiesStore.error = null;

    const availableTagIds = tags.value.map((t_) => t_.id);
    const currentSelectedValidTagIds = formData.tag_ids.filter((id) =>
      availableTagIds.includes(id),
    );

    if (!formData.host || !formData.username) {
      uiNotificationsStore.showError(t('connections.form.errorRequiredFields'));
      return;
    }
    if (formData.port <= 0 || formData.port > 65535) {
      uiNotificationsStore.showError(t('connections.form.errorPort'));
      return;
    }

    if (formData.type === 'SSH') {
      if (!isEditMode.value) {
        if (
          formData.auth_method === 'password' &&
          !formData.password &&
          !formData.host.includes('~')
        ) {
          uiNotificationsStore.showError(t('connections.form.errorPasswordRequired'));
          return;
        }
        if (
          formData.auth_method === 'key' &&
          !formData.selected_ssh_key_id &&
          !formData.host.includes('~')
        ) {
          uiNotificationsStore.showError(t('connections.form.errorSshKeyRequired'));
          return;
        }
      } else {
        if (
          formData.auth_method === 'password' &&
          !formData.password &&
          connectionToEdit.value?.auth_method !== 'password'
        ) {
          uiNotificationsStore.showError(t('connections.form.errorPasswordRequiredOnSwitch'));
          return;
        }
        if (
          formData.auth_method === 'key' &&
          !formData.selected_ssh_key_id &&
          connectionToEdit.value?.auth_method !== 'key'
        ) {
          uiNotificationsStore.showError(t('connections.form.errorSshKeyRequiredOnSwitch'));
          return;
        }
      }
    } else if (formData.type === 'RDP') {
      if (!isEditMode.value && !formData.password && !formData.host.includes('~')) {
        uiNotificationsStore.showError(t('connections.form.errorPasswordRequired'));
        return;
      }
    } else if (formData.type === 'VNC') {
      if (!isEditMode.value && !formData.vncPassword && !formData.host.includes('~')) {
        uiNotificationsStore.showError(
          t('connections.form.errorVncPasswordRequired', 'VNC 密码是必填项。'),
        );
        return;
      }
    }

    if (!isEditMode.value && formData.host.includes('~')) {
      const parsedIpsResult = parseIpRange(formData.host);

      if (Array.isArray(parsedIpsResult)) {
        const ips = parsedIpsResult;
        if (
          formData.type === 'SSH' &&
          formData.auth_method === 'key' &&
          !formData.selected_ssh_key_id
        ) {
          uiNotificationsStore.showError(
            t(
              'connections.form.errorSshKeyRequiredForBatch',
              '批量添加 SSH (密钥认证) 连接时，必须选择一个 SSH 密钥。',
            ),
          );
          return;
        }
        if (formData.type === 'SSH' && formData.auth_method === 'password' && !formData.password) {
          uiNotificationsStore.showError(
            t(
              'connections.form.errorPasswordRequiredForBatchSSH',
              '批量添加 SSH (密码认证) 连接时，必须提供密码。',
            ),
          );
          return;
        }
        if (formData.type === 'RDP' && !formData.password) {
          uiNotificationsStore.showError(
            t(
              'connections.form.errorPasswordRequiredForBatchRDP',
              '批量添加 RDP 连接时，必须提供密码。',
            ),
          );
          return;
        }
        if (formData.type === 'VNC' && !formData.vncPassword) {
          uiNotificationsStore.showError(
            t(
              'connections.form.errorPasswordRequiredForBatchVNC',
              '批量添加 VNC 连接时，必须提供 VNC 密码。',
            ),
          );
          return;
        }

        let successCount = 0;
        let errorCount = 0;
        let firstErrorEncountered: string | null = null;

        for (let i = 0; i < ips.length; i++) {
          const currentIp = ips[i];
          const ipSuffix = currentIp.split('.').pop() || `${i + 1}`;

          const batchProxyId = formData.proxy_id || null;
          // 批量 IP 添加不带 jump_chain；无 proxy_id 时也不写 proxy
          let batchProxyType: 'proxy' | 'jump' | null = formData.proxy_type;
          if (batchProxyType === 'jump') {
            batchProxyType = null;
          } else if (batchProxyType === 'proxy' && !batchProxyId) {
            batchProxyType = null;
          }

          const dataForThisIp: ConnectionPayload = {
            type: formData.type,
            name: formData.name ? `${formData.name}-${ipSuffix}` : currentIp,
            host: currentIp,
            port: formData.port,
            username: formData.username,
            auth_method: formData.auth_method,
            notes: formData.notes,
            proxy_id: batchProxyId,
            tag_ids: currentSelectedValidTagIds,
            proxy_type: batchProxyType,
          };

          if (formData.type === 'SSH') {
            dataForThisIp.auth_method = formData.auth_method;
            if (formData.auth_method === 'password') {
              dataForThisIp.password = formData.password;
            } else if (formData.auth_method === 'key') {
              dataForThisIp.ssh_key_id = formData.selected_ssh_key_id;
            }
          } else if (formData.type === 'RDP') {
            dataForThisIp.password = formData.password;
          } else if (formData.type === 'VNC') {
            dataForThisIp.password = formData.vncPassword;
          } else if (formData.type === 'Telnet') {
            dataForThisIp.password = formData.password;
          }

          if (dataForThisIp.type !== 'SSH' || dataForThisIp.auth_method !== 'key')
            delete dataForThisIp.ssh_key_id;
          if (dataForThisIp.type === 'SSH' && dataForThisIp.auth_method === 'key')
            delete dataForThisIp.password;

          const success = await connectionsStore.addConnection(dataForThisIp);
          if (success) {
            successCount++;
          } else {
            errorCount++;
            if (!firstErrorEncountered) {
              firstErrorEncountered = connectionsStore.error || t('errors.unknown', '未知错误');
            }
          }
        }

        if (errorCount > 0) {
          const message = t('connections.form.errorBatchAddResult', {
            successCount,
            errorCount,
            firstErrorEncountered: firstErrorEncountered || t('errors.unknown', '未知错误'),
          });
          if (successCount > 0) {
            uiNotificationsStore.showWarning(message);
          } else {
            uiNotificationsStore.showError(message);
          }
        } else if (successCount > 0) {
          uiNotificationsStore.showSuccess(
            t('connections.form.successBatchAddResult', { successCount }),
          );
          emit('connection-added');
        }
        return;
      }
      if (parsedIpsResult.error && parsedIpsResult.error !== 'not_a_range') {
        uiNotificationsStore.showError(parsedIpsResult.error);
        return;
      }
    }

    if (isEditMode.value && formData.host.includes('~')) {
      uiNotificationsStore.showError(
        t(
          'connections.form.errorIpRangeNotAllowedInEditMode',
          '编辑模式下不支持 IP 范围。请使用单个 IP 地址。',
        ),
      );
      return;
    }

    // 提交前归一化：未选代理则不写 proxy；跳板链为空则不写 jump
    const resolvedProxyId = formData.proxy_id || null;
    const resolvedJumpChain = formData.jump_chain
      ? (JSON.parse(JSON.stringify(formData.jump_chain)) as number[] | null)
      : null;
    const hasValidJump =
      Array.isArray(resolvedJumpChain) &&
      resolvedJumpChain.some((id) => typeof id === 'number' && id > 0);
    let resolvedProxyType: 'proxy' | 'jump' | null = formData.proxy_type;
    if (resolvedProxyType === 'proxy' && !resolvedProxyId) {
      resolvedProxyType = null;
    } else if (resolvedProxyType === 'jump' && !hasValidJump) {
      resolvedProxyType = null;
    }

    const dataToSend: ConnectionPayload = {
      type: formData.type,
      name: formData.name,
      host: formData.host.trim(),
      port: formData.port,
      notes: formData.notes,
      username: formData.username,
      auth_method: formData.auth_method,
      proxy_id: resolvedProxyId,
      proxy_type: resolvedProxyType,
      tag_ids: currentSelectedValidTagIds,
      jump_chain: resolvedJumpChain,
      force_keyboard_interactive: formData.force_keyboard_interactive,
    };

    if (formData.type === 'SSH') {
      if (formData.auth_method === 'password') {
        if (formData.password) dataToSend.password = formData.password;
      } else if (formData.auth_method === 'key') {
        if (formData.selected_ssh_key_id) {
          dataToSend.ssh_key_id = formData.selected_ssh_key_id;
        }
      }
    } else if (formData.type === 'RDP') {
      if (formData.password) dataToSend.password = formData.password;
      delete dataToSend.force_keyboard_interactive;
    } else if (formData.type === 'VNC') {
      if (formData.vncPassword) dataToSend.password = formData.vncPassword;
      delete dataToSend.force_keyboard_interactive;
    }

    if (dataToSend.type !== 'SSH' || dataToSend.auth_method !== 'key') delete dataToSend.ssh_key_id;
    if (dataToSend.type === 'SSH' && dataToSend.auth_method === 'key') delete dataToSend.password;

    let success = false;
    if (isEditMode.value && connectionToEdit.value) {
      success = await connectionsStore.updateConnection(connectionToEdit.value.id, dataToSend);
      if (success) {
        emit('connection-updated');
      } else {
        uiNotificationsStore.showError(
          t('connections.form.errorUpdate', { error: connectionsStore.error || '未知错误' }),
        );
      }
    } else {
      success = await connectionsStore.addConnection(dataToSend);
      if (success) {
        emit('connection-added');
      } else {
        uiNotificationsStore.showError(
          t('connections.form.errorAdd', { error: connectionsStore.error || '未知错误' }),
        );
      }
    }
  };
}

/**
 * 创建删除连接处理器
 * 包含确认对话框、删除操作与错误处理
 */
export function createDeleteHandler(deps: DeleteDeps) {
  const {
    isEditMode,
    connectionToEdit,
    showConfirmDialog,
    formError,
    connectionsStore,
    uiNotificationsStore,
    emit,
    t,
  } = deps;

  return async () => {
    if (!isEditMode.value || !connectionToEdit.value) return;

    const connectionName = connectionToEdit.value.name || `ID: ${connectionToEdit.value.id}`;
    const confirmedDeleteConnection = await showConfirmDialog({
      message: t('connections.prompts.confirmDelete', { name: connectionName }),
    });
    if (!confirmedDeleteConnection) {
      return;
    }

    formError.value = null;
    connectionsStore.error = null;

    const success = await connectionsStore.deleteConnection(connectionToEdit.value.id);
    if (success) {
      emit('connection-deleted');
      emit('close');
    } else {
      uiNotificationsStore.showError(
        t('connections.form.errorDelete', {
          error: connectionsStore.error || t('errors.unknown', '未知错误'),
        }),
      );
    }
  };
}
