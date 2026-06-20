/**
 * 连接表单 - 脚本模式子模块
 * 职责：批量连接创建（解析逻辑复用 useAddConnectionFormParsers）
 */
import type { Ref } from 'vue';
import type { useConnectionsStore } from '../stores/connections.store';
import type { useProxiesStore } from '../stores/proxies.store';
import type { useTagsStore } from '../stores/tags.store';
import type { useSshKeysStore } from '../stores/sshKeys.store';
import type { useUiNotificationsStore } from '../stores/uiNotifications.store';
import type { TranslateFn } from '../types/i18n.types';
import { type ConnectionPayload, parseScriptLine } from './useAddConnectionFormParsers';

interface ScriptConnectionDraft extends ConnectionPayload {
  tag_names?: string[];
  proxy_name?: string | null;
  ssh_key_name?: string;
}

/** 脚本模式子模块依赖 */
export interface ScriptModeDeps {
  scriptInputText: { value: string };
  emit: (e: 'connection-added') => void;
  connectionsStore: ReturnType<typeof useConnectionsStore>;
  proxiesStore: ReturnType<typeof useProxiesStore>;
  tagsStore: ReturnType<typeof useTagsStore>;
  sshKeysStore: ReturnType<typeof useSshKeysStore>;
  uiNotificationsStore: ReturnType<typeof useUiNotificationsStore>;
  proxies: Ref<Array<{ id: number; name: string; host: string; port: number; type: string }>>;
  tags: Ref<Array<{ id: number; name: string }>>;
  sshKeys: Ref<Array<{ id: number; name: string }>>;
  t: TranslateFn;
}

/**
 * 创建脚本模式提交处理器
 */
export function createScriptModeSubmit(deps: ScriptModeDeps) {
  const {
    scriptInputText,
    emit,
    connectionsStore,
    tagsStore,
    sshKeysStore: _sshKeysStore,
    t,
    proxiesStore: _proxiesStore,
    uiNotificationsStore,
    proxies,
    tags,
    sshKeys,
  } = deps;

  return async () => {
    const lines = scriptInputText.value.split('\n').filter((line) => line.trim() !== '');

    if (lines.length === 0) {
      uiNotificationsStore.showError(t('connections.form.scriptModeEmpty', '脚本输入不能为空。'));
      return;
    }

    let allConnectionsValid = true;
    const connectionsToAdd: ScriptConnectionDraft[] = [];

    for (const line of lines) {
      const parsed = parseScriptLine(line, t);
      if (parsed.error) {
        uiNotificationsStore.showError(
          t('connections.form.scriptErrorInLine', { line, error: parsed.error }),
        );
        allConnectionsValid = false;
        break;
      }

      if (!parsed.type) {
        uiNotificationsStore.showError(t('connections.form.scriptErrorMissingType', { line }));
        allConnectionsValid = false;
        break;
      }

      const [userHost, portStr] = parsed.userHostPort.split(':');
      const [username, host] = userHost.split('@');
      let defaultPort = 22;
      let defaultPortLabel = '22';
      if (parsed.type === 'RDP') {
        defaultPort = 3389;
        defaultPortLabel = '3389';
      } else if (parsed.type === 'VNC') {
        defaultPort = 5900;
        defaultPortLabel = '5900';
      } else if (parsed.type === 'Telnet') {
        defaultPort = 23;
        defaultPortLabel = '23';
      }
      const port = portStr ? parseInt(portStr, 10) : defaultPort;

      if (!username || !host) {
        uiNotificationsStore.showError(
          t('connections.form.scriptErrorInvalidUserHostFormat', { line }),
        );
        allConnectionsValid = false;
        break;
      }
      if (Number.isNaN(port) || port <= 0 || port > 65535) {
        uiNotificationsStore.showError(
          t('connections.form.scriptErrorInvalidPort', {
            line,
            port: portStr || defaultPortLabel,
          }),
        );
        allConnectionsValid = false;
        break;
      }

      const connectionData: ScriptConnectionDraft = {
        type: parsed.type,
        name: parsed.name || `${username}@${host}`,
        host,
        port,
        username,
        auth_method: parsed.type === 'SSH' && parsed.keyName ? 'key' : 'password',
        notes: parsed.note || '',
        tag_names: parsed.tags,
        proxy_name: parsed.proxyName,
      };

      if (parsed.type === 'SSH') {
        if (connectionData.auth_method === 'password') {
          if (!parsed.password) {
            uiNotificationsStore.showError(
              t('connections.form.scriptErrorMissingPasswordForSsh', { line }),
            );
            allConnectionsValid = false;
            break;
          }
          connectionData.password = parsed.password;
        } else {
          if (!parsed.keyName) {
            uiNotificationsStore.showError(
              t('connections.form.scriptErrorMissingKeyNameForSsh', { line }),
            );
            allConnectionsValid = false;
            break;
          }
          connectionData.ssh_key_name = parsed.keyName;
        }
      } else if (parsed.type === 'RDP' || parsed.type === 'VNC') {
        if (!parsed.password) {
          uiNotificationsStore.showError(
            t('connections.form.scriptErrorMissingPasswordForType', { line, type: parsed.type }),
          );
          allConnectionsValid = false;
          break;
        }
        connectionData.password = parsed.password;
      }
      connectionsToAdd.push(connectionData);
    }

    if (!allConnectionsValid || connectionsToAdd.length === 0) {
      return;
    }

    const fullyProcessedConnections: ConnectionPayload[] = [];
    let resolutionErrorOccurred = false;

    for (const connData of connectionsToAdd) {
      if (connData.tag_names && connData.tag_names.length > 0) {
        const tagIds = [];
        for (const tagName of connData.tag_names) {
          let foundTag = tags.value.find((t_) => t_.name === tagName);
          if (!foundTag) {
            const newTag = await tagsStore.addTag(tagName);
            if (newTag) {
              foundTag = newTag;
              uiNotificationsStore.showInfo(t('connections.form.scriptTagCreated', { tagName }));
              await tagsStore.fetchTags();
            } else {
              uiNotificationsStore.showError(
                t('connections.form.scriptErrorTagCreationFailed', { tagName }),
              );
              resolutionErrorOccurred = true;
              break;
            }
          }
          tagIds.push(foundTag.id);
        }
        if (resolutionErrorOccurred) break;
        connData.tag_ids = tagIds;
      } else {
        connData.tag_ids = [];
      }
      delete connData.tag_names;

      if (connData.type === 'Telnet') {
        // Telnet 使用密码认证
        if (!connData.password) {
          uiNotificationsStore.showError(
            t('connections.form.scriptErrorMissingPasswordForTelnet', { host: connData.host }),
          );
          allConnectionsValid = false;
        }
      } else if (
        connData.type === 'SSH' &&
        connData.auth_method === 'key' &&
        connData.ssh_key_name
      ) {
        const foundKey = sshKeys.value.find((k) => k.name === connData.ssh_key_name);
        if (foundKey) {
          connData.ssh_key_id = foundKey.id;
        } else {
          uiNotificationsStore.showError(
            t('connections.form.scriptErrorSshKeyNotFound', { keyName: connData.ssh_key_name }),
          );
          resolutionErrorOccurred = true;
          break;
        }
        delete connData.ssh_key_name;
      }

      if (connData.proxy_name) {
        const foundProxy = proxies.value.find((p) => p.name === connData.proxy_name);
        if (foundProxy) {
          connData.proxy_id = foundProxy.id;
        } else {
          uiNotificationsStore.showError(
            t('proxies.errors.notFound', { name: connData.proxy_name }),
          );
          resolutionErrorOccurred = true;
          break;
        }
        delete connData.proxy_name;
      }

      if (connData.type !== 'SSH' || connData.auth_method !== 'key') delete connData.ssh_key_id;
      if (connData.type === 'SSH' && connData.auth_method === 'key') delete connData.password;

      fullyProcessedConnections.push(connData);
    }

    if (resolutionErrorOccurred || (fullyProcessedConnections.length === 0 && lines.length > 0)) {
      return;
    }

    if (fullyProcessedConnections.length === 0) {
      return;
    }

    uiNotificationsStore.showInfo(
      t('connections.form.scriptModeAddingConnections', {
        count: fullyProcessedConnections.length,
      }),
    );

    let successCount = 0;
    let errorCount = 0;
    let firstErrorEncountered: string | null = null;

    for (const finalConnectionData of fullyProcessedConnections) {
      const success = await connectionsStore.addConnection(finalConnectionData);
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
    }

    if (successCount > 0) {
      if (errorCount === 0) {
        uiNotificationsStore.showSuccess(
          t('connections.form.successBatchAddResult', { successCount }),
        );
      }
      emit('connection-added');
      if (errorCount === 0) {
        scriptInputText.value = '';
      }
    }
  };
}
