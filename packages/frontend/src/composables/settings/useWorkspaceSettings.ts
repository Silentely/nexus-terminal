import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../../stores/settings.store';
import { extractErrorMessage } from '../../utils/errorExtractor';
import { log } from '@/utils/log';

export function useWorkspaceSettings() {
  const settingsStore = useSettingsStore();
  const { t } = useI18n();

  const {
    showPopupFileEditorBoolean,
    shareFileEditorTabsBoolean,
    autoCopyOnSelectBoolean,
    workspaceSidebarPersistentBoolean,
    commandInputSyncTarget,
    showConnectionTagsBoolean,
    showQuickCommandTagsBoolean,
    terminalScrollbackLimitNumber,
    terminalAutoWrapEnabledBoolean,
    sshSuspendKeepAliveSecondsNumber,
    fileManagerShowDeleteConfirmationBoolean,
    fileManagerSingleClickOpenFileBoolean,
    terminalEnableRightClickPasteBoolean,
    terminalEnableBracketedPasteBoolean,
    showPopupFileManagerBoolean,
    statusMonitorShowIpBoolean,
    terminalOutputEnhancerEnabledBoolean,
  } = storeToRefs(settingsStore);

  // --- Popup Editor ---
  const popupEditorEnabled = ref(true);
  const popupEditorLoading = ref(false);
  const popupEditorMessage = ref('');
  const popupEditorSuccess = ref(false);

  const handleUpdatePopupEditorSetting = async () => {
    popupEditorLoading.value = true;
    popupEditorMessage.value = '';
    popupEditorSuccess.value = false;
    try {
      const valueToSave = popupEditorEnabled.value ? 'true' : 'false';
      await settingsStore.updateSetting('showPopupFileEditor', valueToSave);
      popupEditorMessage.value = t('settings.popupEditor.success.saved');
      popupEditorSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新弹窗编辑器设置失败:', error);
      popupEditorEnabled.value = showPopupFileEditorBoolean.value;
      popupEditorMessage.value = extractErrorMessage(
        error,
        t('settings.popupEditor.error.saveFailed'),
      );
      popupEditorSuccess.value = false;
    } finally {
      popupEditorLoading.value = false;
    }
  };

  // --- Share Editor Tabs ---
  const shareTabsEnabled = ref(true);
  const shareTabsLoading = ref(false);
  const shareTabsMessage = ref('');
  const shareTabsSuccess = ref(false);

  const handleUpdateShareTabsSetting = async () => {
    shareTabsLoading.value = true;
    shareTabsMessage.value = '';
    shareTabsSuccess.value = false;
    try {
      const valueToSave = shareTabsEnabled.value ? 'true' : 'false';
      await settingsStore.updateSetting('shareFileEditorTabs', valueToSave);
      shareTabsMessage.value = t('settings.shareEditorTabs.success.saved');
      shareTabsSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新共享编辑器标签页设置失败:', error);
      shareTabsEnabled.value = shareFileEditorTabsBoolean.value;
      shareTabsMessage.value = extractErrorMessage(
        error,
        t('settings.shareEditorTabs.error.saveFailed'),
      );
      shareTabsSuccess.value = false;
    } finally {
      shareTabsLoading.value = false;
    }
  };

  // --- Auto Copy on Select ---
  const autoCopyEnabled = ref(false);
  const autoCopyLoading = ref(false);
  const autoCopyMessage = ref('');
  const autoCopySuccess = ref(false);

  const handleUpdateAutoCopySetting = async () => {
    autoCopyLoading.value = true;
    autoCopyMessage.value = '';
    autoCopySuccess.value = false;
    try {
      await settingsStore.updateSetting('autoCopyOnSelect', autoCopyEnabled.value);
      autoCopyMessage.value = t('settings.autoCopyOnSelect.success.saved');
      autoCopySuccess.value = true;
    } catch (error: unknown) {
      log.error('更新自动复制设置失败:', error);
      autoCopyEnabled.value = autoCopyOnSelectBoolean.value;
      autoCopyMessage.value = extractErrorMessage(
        error,
        t('settings.autoCopyOnSelect.error.saveFailed'),
      );
      autoCopySuccess.value = false;
    } finally {
      autoCopyLoading.value = false;
    }
  };

  // --- Workspace Sidebar Persistent ---
  const workspaceSidebarPersistentEnabled = ref(false);
  const workspaceSidebarPersistentLoading = ref(false);
  const workspaceSidebarPersistentMessage = ref('');
  const workspaceSidebarPersistentSuccess = ref(false);

  const handleUpdateWorkspaceSidebarSetting = async () => {
    workspaceSidebarPersistentLoading.value = true;
    workspaceSidebarPersistentMessage.value = '';
    workspaceSidebarPersistentSuccess.value = false;
    try {
      const valueToSave = workspaceSidebarPersistentEnabled.value ? 'true' : 'false';
      await settingsStore.updateSetting('workspaceSidebarPersistent', valueToSave);
      workspaceSidebarPersistentMessage.value = t(
        'settings.workspace.success.sidebarPersistentSaved',
      );
      workspaceSidebarPersistentSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新侧边栏固定设置失败:', error);
      workspaceSidebarPersistentEnabled.value = workspaceSidebarPersistentBoolean.value;
      workspaceSidebarPersistentMessage.value = extractErrorMessage(
        error,
        t('settings.workspace.error.sidebarPersistentSaveFailed'),
      );
      workspaceSidebarPersistentSuccess.value = false;
    } finally {
      workspaceSidebarPersistentLoading.value = false;
    }
  };

  // --- Command Input Sync Target ---
  const commandInputSyncTargetLocal = ref<'none' | 'quickCommands' | 'commandHistory'>('none');
  const commandInputSyncLoading = ref(false);
  const commandInputSyncMessage = ref('');
  const commandInputSyncSuccess = ref(false);

  const handleUpdateCommandInputSyncTarget = async () => {
    commandInputSyncLoading.value = true;
    commandInputSyncMessage.value = '';
    commandInputSyncSuccess.value = false;
    try {
      await settingsStore.updateSetting(
        'commandInputSyncTarget',
        commandInputSyncTargetLocal.value,
      );
      commandInputSyncMessage.value = t(
        'settings.commandInputSync.success.saved',
        '同步目标已保存',
      );
      commandInputSyncSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新命令输入同步目标失败:', error);
      commandInputSyncMessage.value = extractErrorMessage(
        error,
        t('settings.commandInputSync.error.saveFailed', '保存同步目标失败'),
      );
      commandInputSyncSuccess.value = false;
    } finally {
      commandInputSyncLoading.value = false;
    }
  };

  // --- Show Connection Tags ---
  const showConnectionTagsLocal = ref(true);
  const showConnectionTagsLoading = ref(false);
  const showConnectionTagsMessage = ref('');
  const showConnectionTagsSuccess = ref(false);

  const handleUpdateShowConnectionTags = async () => {
    showConnectionTagsLoading.value = true;
    showConnectionTagsMessage.value = '';
    showConnectionTagsSuccess.value = false;
    try {
      await settingsStore.updateSetting('showConnectionTags', showConnectionTagsLocal.value);
      showConnectionTagsMessage.value = t(
        'settings.workspace.success.showConnectionTagsSaved',
        '连接标签显示设置已保存',
      );
      showConnectionTagsSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新显示连接标签设置失败:', error);
      showConnectionTagsMessage.value = extractErrorMessage(
        error,
        t('settings.workspace.error.showConnectionTagsSaveFailed', '保存连接标签显示设置失败'),
      );
      showConnectionTagsSuccess.value = false;
    } finally {
      showConnectionTagsLoading.value = false;
    }
  };

  // --- Show Quick Command Tags ---
  const showQuickCommandTagsLocal = ref(true);
  const showQuickCommandTagsLoading = ref(false);
  const showQuickCommandTagsMessage = ref('');
  const showQuickCommandTagsSuccess = ref(false);

  const handleUpdateShowQuickCommandTags = async () => {
    showQuickCommandTagsLoading.value = true;
    showQuickCommandTagsMessage.value = '';
    showQuickCommandTagsSuccess.value = false;
    try {
      await settingsStore.updateSetting('showQuickCommandTags', showQuickCommandTagsLocal.value);
      showQuickCommandTagsMessage.value = t(
        'settings.workspace.success.showQuickCommandTagsSaved',
        '快捷指令标签显示设置已保存',
      );
      showQuickCommandTagsSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新显示快捷指令标签设置失败:', error);
      showQuickCommandTagsMessage.value = extractErrorMessage(
        error,
        t(
          'settings.workspace.error.showQuickCommandTagsSaveFailed',
          '保存快捷指令标签显示设置失败',
        ),
      );
      showQuickCommandTagsSuccess.value = false;
    } finally {
      showQuickCommandTagsLoading.value = false;
    }
  };

  // --- Terminal Scrollback Limit ---
  const terminalScrollbackLimitLocal = ref<number | null>(null);
  const terminalScrollbackLimitLoading = ref(false);
  const terminalScrollbackLimitMessage = ref('');
  const terminalScrollbackLimitSuccess = ref(false);

  const handleUpdateTerminalScrollbackLimit = async () => {
    terminalScrollbackLimitLoading.value = true;
    terminalScrollbackLimitMessage.value = '';
    terminalScrollbackLimitSuccess.value = false;
    try {
      const limitValue = terminalScrollbackLimitLocal.value;
      if (
        limitValue !== null &&
        limitValue !== undefined &&
        (Number.isNaN(limitValue) || !Number.isInteger(limitValue) || limitValue < 0)
      ) {
        throw new Error(
          t('settings.terminalScrollback.error.invalidInput', '请输入一个有效的非负整数。'),
        );
      }
      const valueToSave =
        limitValue === null || limitValue === undefined ? '5000' : String(limitValue);
      await settingsStore.updateSetting('terminalScrollbackLimit', valueToSave);
      terminalScrollbackLimitMessage.value = t(
        'settings.terminalScrollback.success.saved',
        '终端回滚行数设置已保存。',
      );
      terminalScrollbackLimitSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新终端回滚行数设置失败:', error);
      terminalScrollbackLimitMessage.value = extractErrorMessage(
        error,
        t('settings.terminalScrollback.error.saveFailed', '保存终端回滚行数设置失败。'),
      );
      terminalScrollbackLimitSuccess.value = false;
    } finally {
      terminalScrollbackLimitLoading.value = false;
    }
  };

  // --- Terminal Auto Wrap ---
  const terminalAutoWrapEnabled = ref(true);
  const terminalAutoWrapLoading = ref(false);
  const terminalAutoWrapMessage = ref('');
  const terminalAutoWrapSuccess = ref(false);

  const handleUpdateTerminalAutoWrapSetting = async () => {
    terminalAutoWrapLoading.value = true;
    terminalAutoWrapMessage.value = '';
    terminalAutoWrapSuccess.value = false;
    try {
      const valueToSave = terminalAutoWrapEnabled.value ? 'true' : 'false';
      await settingsStore.updateSetting('terminalAutoWrapEnabled', valueToSave);
      terminalAutoWrapMessage.value = t(
        'settings.workspace.terminalAutoWrapSuccess',
        '终端自动换行设置已保存。',
      );
      terminalAutoWrapSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新终端自动换行设置失败:', error);
      terminalAutoWrapEnabled.value = terminalAutoWrapEnabledBoolean.value;
      terminalAutoWrapMessage.value = extractErrorMessage(
        error,
        t('settings.workspace.terminalAutoWrapError', '保存终端自动换行设置失败。'),
      );
      terminalAutoWrapSuccess.value = false;
    } finally {
      terminalAutoWrapLoading.value = false;
    }
  };

  // --- SSH Suspend Keepalive Seconds ---
  const sshSuspendKeepAliveSecondsLocal = ref<number | null>(0);
  const sshSuspendKeepAliveSecondsLoading = ref(false);
  const sshSuspendKeepAliveSecondsMessage = ref('');
  const sshSuspendKeepAliveSecondsSuccess = ref(false);

  const handleUpdateSshSuspendKeepAliveSeconds = async () => {
    sshSuspendKeepAliveSecondsLoading.value = true;
    sshSuspendKeepAliveSecondsMessage.value = '';
    sshSuspendKeepAliveSecondsSuccess.value = false;
    try {
      const keepAliveValue = sshSuspendKeepAliveSecondsLocal.value;
      if (
        keepAliveValue !== null &&
        keepAliveValue !== undefined &&
        (Number.isNaN(keepAliveValue) || !Number.isInteger(keepAliveValue) || keepAliveValue < 0)
      ) {
        throw new Error(
          t(
            'settings.workspace.sshSuspendKeepAliveInvalidInput',
            '请输入一个有效的非负整数，0 表示永久保活。',
          ),
        );
      }
      const valueToSave =
        keepAliveValue === null || keepAliveValue === undefined ? '0' : String(keepAliveValue);
      await settingsStore.updateSetting('sshSuspendKeepAliveSeconds', valueToSave);
      sshSuspendKeepAliveSecondsMessage.value = t(
        'settings.workspace.sshSuspendKeepAliveSuccess',
        '挂起会话保活时长设置已保存。',
      );
      sshSuspendKeepAliveSecondsSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新挂起会话保活时长设置失败:', error);
      sshSuspendKeepAliveSecondsMessage.value = extractErrorMessage(
        error,
        t('settings.workspace.sshSuspendKeepAliveError', '保存挂起会话保活时长设置失败。'),
      );
      sshSuspendKeepAliveSecondsSuccess.value = false;
    } finally {
      sshSuspendKeepAliveSecondsLoading.value = false;
    }
  };

  // --- File Manager Delete Confirmation ---
  const fileManagerShowDeleteConfirmationLocal = ref(true);
  const fileManagerShowDeleteConfirmationLoading = ref(false);
  const fileManagerShowDeleteConfirmationMessage = ref('');
  const fileManagerShowDeleteConfirmationSuccess = ref(false);

  const handleUpdateFileManagerDeleteConfirmation = async () => {
    fileManagerShowDeleteConfirmationLoading.value = true;
    fileManagerShowDeleteConfirmationMessage.value = '';
    fileManagerShowDeleteConfirmationSuccess.value = false;
    try {
      const valueToSave = fileManagerShowDeleteConfirmationLocal.value ? 'true' : 'false';
      await settingsStore.updateSetting('fileManagerShowDeleteConfirmation', valueToSave);
      fileManagerShowDeleteConfirmationMessage.value = t(
        'settings.workspace.fileManagerDeleteConfirmSuccess',
        '文件管理器删除确认设置已保存。',
      );
      fileManagerShowDeleteConfirmationSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新文件管理器删除确认设置失败:', error);
      fileManagerShowDeleteConfirmationLocal.value = fileManagerShowDeleteConfirmationBoolean.value;
      fileManagerShowDeleteConfirmationMessage.value = extractErrorMessage(
        error,
        t('settings.workspace.fileManagerDeleteConfirmError', '保存文件管理器删除确认设置失败。'),
      );
      fileManagerShowDeleteConfirmationSuccess.value = false;
    } finally {
      fileManagerShowDeleteConfirmationLoading.value = false;
    }
  };

  // --- File Manager Single Click Open File ---
  const fileManagerSingleClickOpenFileLocal = ref(false);
  const fileManagerSingleClickOpenFileLoading = ref(false);
  const fileManagerSingleClickOpenFileMessage = ref('');
  const fileManagerSingleClickOpenFileSuccess = ref(false);

  const handleUpdateFileManagerSingleClickOpenFile = async () => {
    fileManagerSingleClickOpenFileLoading.value = true;
    fileManagerSingleClickOpenFileMessage.value = '';
    fileManagerSingleClickOpenFileSuccess.value = false;
    try {
      const valueToSave = fileManagerSingleClickOpenFileLocal.value ? 'true' : 'false';
      await settingsStore.updateSetting('fileManagerSingleClickOpenFile', valueToSave);
      fileManagerSingleClickOpenFileMessage.value = t(
        'settings.workspace.fileManagerSingleClickOpenFileSuccess',
        '文件管理器文件打开方式设置已保存。',
      );
      fileManagerSingleClickOpenFileSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新文件管理器文件打开方式设置失败:', error);
      fileManagerSingleClickOpenFileLocal.value = fileManagerSingleClickOpenFileBoolean.value;
      fileManagerSingleClickOpenFileMessage.value = extractErrorMessage(
        error,
        t(
          'settings.workspace.fileManagerSingleClickOpenFileError',
          '保存文件管理器文件打开方式设置失败。',
        ),
      );
      fileManagerSingleClickOpenFileSuccess.value = false;
    } finally {
      fileManagerSingleClickOpenFileLoading.value = false;
    }
  };

  // --- Terminal Right Click Paste ---
  const terminalEnableRightClickPasteLocal = ref(true);
  const terminalEnableRightClickPasteLoading = ref(false);
  const terminalEnableRightClickPasteMessage = ref('');
  const terminalEnableRightClickPasteSuccess = ref(false);

  const handleUpdateTerminalRightClickPasteSetting = async () => {
    terminalEnableRightClickPasteLoading.value = true;
    terminalEnableRightClickPasteMessage.value = '';
    terminalEnableRightClickPasteSuccess.value = false;
    try {
      const valueToSave = terminalEnableRightClickPasteLocal.value ? 'true' : 'false';
      await settingsStore.updateSetting('terminalEnableRightClickPaste', valueToSave);
      terminalEnableRightClickPasteMessage.value = t(
        'settings.workspace.terminalRightClickPasteSuccess',
        '终端右键粘贴设置已保存。',
      );
      terminalEnableRightClickPasteSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新终端右键粘贴设置失败:', error);
      terminalEnableRightClickPasteLocal.value = terminalEnableRightClickPasteBoolean.value;
      terminalEnableRightClickPasteMessage.value = extractErrorMessage(
        error,
        t('settings.workspace.terminalRightClickPasteError', '保存终端右键粘贴设置失败。'),
      );
      terminalEnableRightClickPasteSuccess.value = false;
    } finally {
      terminalEnableRightClickPasteLoading.value = false;
    }
  };

  // --- Terminal Bracketed Paste Mode ---
  const terminalEnableBracketedPasteLocal = ref(true);
  const terminalEnableBracketedPasteLoading = ref(false);
  const terminalEnableBracketedPasteMessage = ref('');
  const terminalEnableBracketedPasteSuccess = ref(false);

  const handleUpdateTerminalBracketedPasteSetting = async () => {
    terminalEnableBracketedPasteLoading.value = true;
    terminalEnableBracketedPasteMessage.value = '';
    terminalEnableBracketedPasteSuccess.value = false;
    try {
      const valueToSave = terminalEnableBracketedPasteLocal.value ? 'true' : 'false';
      await settingsStore.updateSetting('terminalEnableBracketedPaste', valueToSave);
      terminalEnableBracketedPasteMessage.value = t(
        'settings.workspace.terminalBracketedPasteSuccess',
        '终端粘贴模式设置已保存。',
      );
      terminalEnableBracketedPasteSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新终端粘贴模式设置失败:', error);
      terminalEnableBracketedPasteLocal.value = terminalEnableBracketedPasteBoolean.value;
      terminalEnableBracketedPasteMessage.value = extractErrorMessage(
        error,
        t('settings.workspace.terminalBracketedPasteError', '保存终端粘贴模式设置失败。'),
      );
      terminalEnableBracketedPasteSuccess.value = false;
    } finally {
      terminalEnableBracketedPasteLoading.value = false;
    }
  };

  // --- Popup File Manager ---
  const showPopupFileManagerLocal = ref(true);
  const showPopupFileManagerLoading = ref(false);
  const showPopupFileManagerMessage = ref('');
  const showPopupFileManagerSuccess = ref(false);

  const handleUpdateShowPopupFileManager = async () => {
    showPopupFileManagerLoading.value = true;
    showPopupFileManagerMessage.value = '';
    showPopupFileManagerSuccess.value = false;
    try {
      const valueToSave = showPopupFileManagerLocal.value ? 'true' : 'false';
      await settingsStore.updateSetting('showPopupFileManager', valueToSave);
      showPopupFileManagerMessage.value = t('settings.popupFileManager.success.saved');
      showPopupFileManagerSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新弹窗文件管理器设置失败:', error);
      showPopupFileManagerLocal.value = showPopupFileManagerBoolean.value;
      showPopupFileManagerMessage.value = extractErrorMessage(
        error,
        t('settings.popupFileManager.error.saveFailed'),
      );
      showPopupFileManagerSuccess.value = false;
    } finally {
      showPopupFileManagerLoading.value = false;
    }
  };

  // --- Status Monitor Show IP ---
  const statusMonitorShowIpEnabled = ref(false);
  const statusMonitorShowIpLoading = ref(false);
  const statusMonitorShowIpMessage = ref('');
  const statusMonitorShowIpSuccess = ref(false);

  const handleUpdateStatusMonitorShowIpSetting = async () => {
    statusMonitorShowIpLoading.value = true;
    statusMonitorShowIpMessage.value = '';
    statusMonitorShowIpSuccess.value = false;
    try {
      const valueToSave = statusMonitorShowIpEnabled.value ? 'true' : 'false';
      await settingsStore.updateSetting('showStatusMonitorIpAddress', valueToSave);
      statusMonitorShowIpMessage.value = t('common.saved');
      statusMonitorShowIpSuccess.value = true;
    } catch (error: unknown) {
      log.error('Failed to update status monitor IP display setting:', error);
      statusMonitorShowIpEnabled.value = statusMonitorShowIpBoolean.value;
      statusMonitorShowIpMessage.value = extractErrorMessage(
        error,
        t(
          'settings.statusMonitorShowIp.error.saveFailed',
          'Failed to save status monitor IP display setting.',
        ),
      ); //  需要添加相应的i18n键
      statusMonitorShowIpSuccess.value = false;
    } finally {
      statusMonitorShowIpLoading.value = false;
    }
  };

  // --- Terminal Output Enhancer ---
  const terminalOutputEnhancerEnabled = ref(true);
  const terminalOutputEnhancerLoading = ref(false);
  const terminalOutputEnhancerMessage = ref('');
  const terminalOutputEnhancerSuccess = ref(false);

  const handleUpdateTerminalOutputEnhancerSetting = async () => {
    terminalOutputEnhancerLoading.value = true;
    terminalOutputEnhancerMessage.value = '';
    terminalOutputEnhancerSuccess.value = false;
    try {
      const valueToSave = terminalOutputEnhancerEnabled.value ? 'true' : 'false';
      await settingsStore.updateSetting('terminalOutputEnhancerEnabled', valueToSave);
      terminalOutputEnhancerMessage.value = t('settings.terminalOutputEnhancer.success.saved');
      terminalOutputEnhancerSuccess.value = true;
    } catch (error: unknown) {
      log.error('更新终端输出增强器设置失败:', error);
      terminalOutputEnhancerEnabled.value = terminalOutputEnhancerEnabledBoolean.value;
      terminalOutputEnhancerMessage.value = extractErrorMessage(
        error,
        t('settings.terminalOutputEnhancer.error.saveFailed'),
      );
      terminalOutputEnhancerSuccess.value = false;
    } finally {
      terminalOutputEnhancerLoading.value = false;
    }
  };

  // Watchers to sync local state with store state
  watch(
    showPopupFileEditorBoolean,
    (newValue) => {
      popupEditorEnabled.value = newValue;
    },
    { immediate: true },
  );
  watch(
    shareFileEditorTabsBoolean,
    (newValue) => {
      shareTabsEnabled.value = newValue;
    },
    { immediate: true },
  );
  watch(
    autoCopyOnSelectBoolean,
    (newValue) => {
      autoCopyEnabled.value = newValue;
    },
    { immediate: true },
  );
  watch(
    workspaceSidebarPersistentBoolean,
    (newValue) => {
      workspaceSidebarPersistentEnabled.value = newValue;
    },
    { immediate: true },
  );
  watch(
    commandInputSyncTarget,
    (newValue) => {
      commandInputSyncTargetLocal.value = newValue;
    },
    { immediate: true },
  );
  watch(
    showConnectionTagsBoolean,
    (newValue) => {
      showConnectionTagsLocal.value = newValue;
    },
    { immediate: true },
  );
  watch(
    showQuickCommandTagsBoolean,
    (newValue) => {
      showQuickCommandTagsLocal.value = newValue;
    },
    { immediate: true },
  );
  watch(
    terminalScrollbackLimitNumber,
    (newValue) => {
      terminalScrollbackLimitLocal.value = newValue;
    },
    { immediate: true },
  );
  watch(
    terminalAutoWrapEnabledBoolean,
    (newValue) => {
      terminalAutoWrapEnabled.value = newValue;
    },
    { immediate: true },
  );
  watch(
    sshSuspendKeepAliveSecondsNumber,
    (newValue) => {
      sshSuspendKeepAliveSecondsLocal.value = newValue;
    },
    { immediate: true },
  );
  watch(
    fileManagerShowDeleteConfirmationBoolean,
    (newValue) => {
      fileManagerShowDeleteConfirmationLocal.value = newValue;
    },
    { immediate: true },
  );
  watch(
    fileManagerSingleClickOpenFileBoolean,
    (newValue) => {
      fileManagerSingleClickOpenFileLocal.value = newValue;
    },
    { immediate: true },
  );
  watch(
    terminalEnableRightClickPasteBoolean,
    (newValue) => {
      terminalEnableRightClickPasteLocal.value = newValue;
    },
    { immediate: true },
  );
  watch(
    terminalEnableBracketedPasteBoolean,
    (newValue) => {
      terminalEnableBracketedPasteLocal.value = newValue;
    },
    { immediate: true },
  );
  watch(
    showPopupFileManagerBoolean,
    (newValue) => {
      showPopupFileManagerLocal.value = newValue;
    },
    { immediate: true },
  ); // +++ Watch for popup file manager +++
  watch(
    statusMonitorShowIpBoolean,
    (newValue) => {
      statusMonitorShowIpEnabled.value = newValue;
    },
    { immediate: true },
  );
  watch(
    terminalOutputEnhancerEnabledBoolean,
    (newValue) => {
      terminalOutputEnhancerEnabled.value = newValue;
    },
    { immediate: true },
  );

  return {
    popupEditorEnabled,
    popupEditorLoading,
    popupEditorMessage,
    popupEditorSuccess,
    handleUpdatePopupEditorSetting,

    shareTabsEnabled,
    shareTabsLoading,
    shareTabsMessage,
    shareTabsSuccess,
    handleUpdateShareTabsSetting,

    autoCopyEnabled,
    autoCopyLoading,
    autoCopyMessage,
    autoCopySuccess,
    handleUpdateAutoCopySetting,

    workspaceSidebarPersistentEnabled,
    workspaceSidebarPersistentLoading,
    workspaceSidebarPersistentMessage,
    workspaceSidebarPersistentSuccess,
    handleUpdateWorkspaceSidebarSetting,

    commandInputSyncTargetLocal,
    commandInputSyncLoading,
    commandInputSyncMessage,
    commandInputSyncSuccess,
    handleUpdateCommandInputSyncTarget,

    showConnectionTagsLocal,
    showConnectionTagsLoading,
    showConnectionTagsMessage,
    showConnectionTagsSuccess,
    handleUpdateShowConnectionTags,

    showQuickCommandTagsLocal,
    showQuickCommandTagsLoading,
    showQuickCommandTagsMessage,
    showQuickCommandTagsSuccess,
    handleUpdateShowQuickCommandTags,

    terminalScrollbackLimitLocal,
    terminalScrollbackLimitLoading,
    terminalScrollbackLimitMessage,
    terminalScrollbackLimitSuccess,
    handleUpdateTerminalScrollbackLimit,
    terminalAutoWrapEnabled,
    terminalAutoWrapLoading,
    terminalAutoWrapMessage,
    terminalAutoWrapSuccess,
    handleUpdateTerminalAutoWrapSetting,
    sshSuspendKeepAliveSecondsLocal,
    sshSuspendKeepAliveSecondsLoading,
    sshSuspendKeepAliveSecondsMessage,
    sshSuspendKeepAliveSecondsSuccess,
    handleUpdateSshSuspendKeepAliveSeconds,

    fileManagerShowDeleteConfirmationLocal,
    fileManagerShowDeleteConfirmationLoading,
    fileManagerShowDeleteConfirmationMessage,
    fileManagerShowDeleteConfirmationSuccess,
    handleUpdateFileManagerDeleteConfirmation,
    fileManagerSingleClickOpenFileLocal,
    fileManagerSingleClickOpenFileLoading,
    fileManagerSingleClickOpenFileMessage,
    fileManagerSingleClickOpenFileSuccess,
    handleUpdateFileManagerSingleClickOpenFile,

    terminalEnableRightClickPasteLocal,
    terminalEnableRightClickPasteLoading,
    terminalEnableRightClickPasteMessage,
    terminalEnableRightClickPasteSuccess,
    handleUpdateTerminalRightClickPasteSetting,

    terminalEnableBracketedPasteLocal,
    terminalEnableBracketedPasteLoading,
    terminalEnableBracketedPasteMessage,
    terminalEnableBracketedPasteSuccess,
    handleUpdateTerminalBracketedPasteSetting,

    // Popup File Manager
    showPopupFileManagerLocal,
    showPopupFileManagerLoading,
    showPopupFileManagerMessage,
    showPopupFileManagerSuccess,
    handleUpdateShowPopupFileManager,

    statusMonitorShowIpEnabled,
    statusMonitorShowIpLoading,
    statusMonitorShowIpMessage,
    statusMonitorShowIpSuccess,
    handleUpdateStatusMonitorShowIpSetting,

    // Terminal Output Enhancer
    terminalOutputEnhancerEnabled,
    terminalOutputEnhancerLoading,
    terminalOutputEnhancerMessage,
    terminalOutputEnhancerSuccess,
    handleUpdateTerminalOutputEnhancerSetting,
  };
}
