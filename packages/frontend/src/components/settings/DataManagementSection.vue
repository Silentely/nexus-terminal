<template>
  <div
    v-if="settings"
    class="bg-background border border-border rounded-lg shadow-sm overflow-hidden"
  >
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      {{ t('settings.category.dataManagement', '数据管理') }}
    </h2>
    <div class="p-6 space-y-6">
      <!-- Docker Migration Hint -->
      <div class="settings-section-content">
        <div class="p-4 rounded-md border border-info/30 bg-info/5">
          <p class="text-sm text-info font-medium mb-1">
            {{ t('settings.dataManagement.dockerMigrationHint.title', '服务器间迁移推荐方式') }}
          </p>
          <p class="text-xs text-text-secondary">
            {{
              t(
                'settings.dataManagement.dockerMigrationHint.description',
                '如需在服务器间完整迁移，最简单的方式是直接复制宿主机的 ./data 目录及 data/.env 文件到新服务器，然后启动 Docker 容器即可。',
              )
            }}
          </p>
        </div>
      </div>

      <hr class="border-border/50" />

      <!-- Export Connections Section (CLI Migration) -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ t('settings.exportConnections.title', '导出连接数据') }}
        </h3>
        <p class="text-sm text-text-secondary mb-2">
          {{
            t(
              'settings.exportConnections.cliHint',
              '导出为 CLI 脚本格式（ZIP），用于在其他 Nexus Terminal 实例中通过命令行导入。',
            )
          }}
        </p>
        <p class="text-xs text-text-secondary mb-3">
          {{
            t(
              'settings.exportConnections.proxyNote',
              '注意：代理配置和按内容存储的 SSH 密钥不包含在导出中。',
            )
          }}
        </p>
        <form @submit.prevent="handleExportWithPassword" class="space-y-4">
          <div>
            <label for="exportPassword" class="block text-sm font-medium text-text-secondary mb-1">
              {{ t('settings.exportConnections.passwordLabel', '导出密码（可选）') }}
            </label>
            <input
              id="exportPassword"
              v-model="exportPassword"
              type="password"
              :placeholder="
                t('settings.exportConnections.passwordPlaceholder', '留空则使用 ENCRYPTION_KEY')
              "
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm"
            />
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              :disabled="exportConnectionsLoading"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium inline-flex items-center"
            >
              <svg
                v-if="exportConnectionsLoading"
                class="animate-spin -ml-1 mr-2 h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              {{
                exportConnectionsLoading
                  ? t('common.loading')
                  : t('settings.exportConnections.buttonText', '开始导出')
              }}
            </button>
            <p
              v-if="exportConnectionsMessage"
              :class="['text-sm', exportConnectionsSuccess ? 'text-success' : 'text-error']"
            >
              {{ exportConnectionsMessage }}
            </p>
          </div>
        </form>
      </div>

      <hr class="border-border/50" />

      <!-- Full Backup Export Section -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ t('settings.fullBackupExport.title', '完整数据备份') }}
        </h3>
        <p class="text-sm text-text-secondary mb-2">
          {{
            t(
              'settings.fullBackupExport.description',
              '导出全部核心业务数据为 JSON 文件，包含连接、标签、快捷指令、终端主题等。可用于跨实例完整恢复。',
            )
          }}
        </p>
        <p class="text-xs text-text-secondary mb-4">
          <span class="font-semibold text-warning">{{
            t(
              'settings.fullBackupExport.encryptionKeyWarning',
              '恢复时需使用与导出相同的 ENCRYPTION_KEY，否则连接密码和 SSH 密钥将无法解密。',
            )
          }}</span>
        </p>
        <form @submit.prevent="handleFullBackupExport" class="space-y-4">
          <div class="flex items-center justify-between">
            <button
              type="submit"
              :disabled="fullBackupLoading"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium inline-flex items-center"
            >
              <svg
                v-if="fullBackupLoading"
                class="animate-spin -ml-1 mr-2 h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              {{
                fullBackupLoading
                  ? t('common.loading')
                  : t('settings.fullBackupExport.buttonText', '导出备份文件')
              }}
            </button>
            <p
              v-if="fullBackupMessage"
              :class="['text-sm', fullBackupSuccess ? 'text-success' : 'text-error']"
            >
              {{ fullBackupMessage }}
            </p>
          </div>
        </form>
      </div>

      <hr class="border-border/50" />

      <!-- Import Connections Section -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ t('settings.importConnections.title', '导入连接数据') }}
        </h3>
        <p class="text-sm text-text-secondary mb-4">
          {{
            t(
              'settings.importConnections.description',
              '选择 JSON 格式的连接配置文件进行导入（仅支持连接数据，不含标签、主题等）。文件大小限制 5MB。',
            )
          }}
        </p>

        <!-- 导入确认对话框 -->
        <div
          v-if="showImportConfirm"
          class="space-y-3 mb-4 p-4 rounded-md border border-warning/30 bg-warning/5"
        >
          <p class="text-sm text-warning font-medium">
            {{ t('settings.importConnections.confirmText', '导入将覆盖当前设置，是否继续？') }}
          </p>
          <div class="flex items-center gap-3">
            <button
              type="button"
              @click="confirmImport"
              :disabled="importLoading"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium inline-flex items-center"
            >
              <svg
                v-if="importLoading"
                class="animate-spin -ml-1 mr-2 h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              {{
                importLoading
                  ? t('common.loading')
                  : t('settings.importConnections.confirmButton', '确认导入')
              }}
            </button>
            <button
              type="button"
              @click="cancelImport"
              :disabled="importLoading"
              class="px-4 py-2 bg-background text-foreground border border-border rounded-md shadow-sm hover:bg-header/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ t('common.cancel', '取消') }}
            </button>
          </div>
        </div>

        <!-- 文件选择按钮 -->
        <div v-if="!showImportConfirm" class="flex items-center justify-between">
          <button
            type="button"
            @click="triggerFileSelect"
            :disabled="importLoading"
            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium inline-flex items-center"
          >
            <svg
              v-if="importLoading"
              class="animate-spin -ml-1 mr-2 h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            {{
              importLoading
                ? t('common.loading')
                : t('settings.importConnections.buttonText', '选择文件导入')
            }}
          </button>
          <p
            v-if="importMessage"
            :class="['text-sm', importSuccess ? 'text-success' : 'text-error']"
          >
            {{ importMessage }}
          </p>
        </div>

        <!-- 导入结果详情 -->
        <div
          v-if="importResult && importResult.failureCount > 0"
          class="mt-3 p-3 rounded-md border border-error/30 bg-error/5 text-sm text-error"
        >
          <p class="font-medium mb-1">
            {{ t('settings.importConnections.errorDetails', '导入错误详情') }}:
          </p>
          <ul class="list-disc list-inside space-y-1">
            <li v-for="(err, idx) in importResult.errors" :key="idx">
              <span v-if="err.connectionName" class="font-medium">{{ err.connectionName }}:</span>
              {{ err.message }}
            </li>
          </ul>
        </div>

        <!-- 隐藏的文件输入 -->
        <input
          ref="fileInputRef"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="handleFileSelected"
        />
      </div>

      <hr class="border-border/50" />

      <!-- Audit Log Settings Section -->
      <div class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-3">
          {{ t('settings.auditLog.title', '审计日志') }}
        </h3>

        <!-- Max Entries Setting -->
        <form @submit.prevent="handleUpdateAuditLogMaxEntries" class="space-y-4 mb-6">
          <div>
            <label
              for="auditLogMaxEntries"
              class="block text-sm font-medium text-text-secondary mb-1"
            >
              {{ t('settings.auditLog.maxEntriesLabel', '最大保留条数') }}
            </label>
            <input
              id="auditLogMaxEntries"
              type="number"
              v-model.number="auditLogMaxEntries"
              min="100"
              step="100"
              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
            <small class="block mt-1 text-xs text-text-secondary">
              {{
                t(
                  'settings.auditLog.maxEntriesDescription',
                  '当日志条数超过此值时，系统将自动删除最旧的日志。最小值为100。',
                )
              }}
            </small>
          </div>
          <div class="flex items-center justify-between">
            <button
              type="submit"
              :disabled="auditLogMaxEntriesLoading"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ auditLogMaxEntriesLoading ? t('common.saving', '保存中...') : t('common.save') }}
            </button>
            <p
              v-if="auditLogMaxEntriesMessage"
              :class="['text-sm', auditLogMaxEntriesSuccess ? 'text-success' : 'text-error']"
            >
              {{ auditLogMaxEntriesMessage }}
            </p>
          </div>
        </form>

        <!-- Delete All Audit Logs -->
        <div class="pt-4 border-t border-border/50">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h4 class="text-sm font-medium text-foreground">
                {{ t('settings.auditLog.deleteTitle', '清空审计日志') }}
              </h4>
              <p class="text-xs text-text-secondary mt-1">
                {{ t('settings.auditLog.currentCount', '当前日志条数') }}:
                <span class="font-semibold">{{ auditLogCount }}</span>
              </p>
            </div>
          </div>

          <!-- Delete Confirmation -->
          <div v-if="!showDeleteConfirm">
            <button
              type="button"
              @click="showDeleteConfirm = true"
              class="px-4 py-2 bg-error/10 text-error border border-error/30 rounded-md shadow-sm hover:bg-error/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error transition duration-150 ease-in-out text-sm font-medium"
            >
              {{ t('settings.auditLog.deleteButton', '删除所有日志') }}
            </button>
          </div>
          <div v-else class="space-y-3">
            <p class="text-sm text-warning font-medium">
              {{
                t(
                  'settings.auditLog.deleteConfirmText',
                  '确定要删除所有审计日志吗？此操作不可撤销！',
                )
              }}
            </p>
            <div class="flex items-center gap-3">
              <button
                type="button"
                @click="handleDeleteAllAuditLogs"
                :disabled="deleteAuditLogsLoading"
                class="px-4 py-2 bg-error text-white rounded-md shadow-sm hover:bg-error/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium inline-flex items-center"
              >
                <svg
                  v-if="deleteAuditLogsLoading"
                  class="animate-spin -ml-1 mr-2 h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                {{
                  deleteAuditLogsLoading
                    ? t('common.deleting', '删除中...')
                    : t('settings.auditLog.confirmDelete', '确认删除')
                }}
              </button>
              <button
                type="button"
                @click="showDeleteConfirm = false"
                class="px-4 py-2 bg-background text-foreground border border-border rounded-md shadow-sm hover:bg-header/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium"
              >
                {{ t('common.cancel', '取消') }}
              </button>
            </div>
            <p
              v-if="deleteAuditLogsMessage"
              :class="['text-sm', deleteAuditLogsSuccess ? 'text-success' : 'text-error']"
            >
              {{ deleteAuditLogsMessage }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useSettingsStore } from '../../stores/settings.store';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useExportConnections } from '../../composables/settings/useExportConnections';
import { useImportConnections } from '../../composables/settings/useImportConnections';
import { useAuditSettings } from '../../composables/settings/useAuditSettings';
import apiClient from '../../utils/apiClient';
import { log } from '@/utils/log';
import { isAxiosError } from 'axios';

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);
const { t } = useI18n();

const {
  exportConnectionsLoading,
  exportConnectionsMessage,
  exportConnectionsSuccess,
  handleExportConnections,
} = useExportConnections();

// 自定义导出密码
const exportPassword = ref('');

const handleExportWithPassword = () => {
  handleExportConnections(exportPassword.value || undefined);
};

// 全量备份导出
const fullBackupLoading = ref(false);
const fullBackupMessage = ref('');
const fullBackupSuccess = ref(false);

const handleFullBackupExport = async () => {
  fullBackupLoading.value = true;
  fullBackupMessage.value = '';
  fullBackupSuccess.value = false;
  try {
    const response = await apiClient.post(
      '/backup/export',
      {},
      {
        responseType: 'blob',
      },
    );

    let filename = `nexus-terminal-backup-${Date.now()}.json`;
    const disposition = response.headers['content-disposition'];
    if (disposition && disposition.includes('attachment')) {
      const filenameRegex = /filename[^;=\n]*=(?:(['"])(.*?)\1|([^;\n]*))/;
      const matches = filenameRegex.exec(disposition);
      if (matches != null && (matches[2] || matches[3])) {
        filename = matches[2] || matches[3];
      }
    }

    const blob = new Blob([response.data], {
      type: (response.headers['content-type'] as string) || 'application/json',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    fullBackupMessage.value = t('settings.fullBackupExport.success', '备份文件已开始下载。');
    fullBackupSuccess.value = true;
  } catch (error: unknown) {
    log.error('导出备份失败:', error);
    let message = t('settings.fullBackupExport.error', '导出备份时发生错误。');
    if (isAxiosError(error) && error.response?.data) {
      const data = error.response.data;
      if (data instanceof Blob && data.type.toLowerCase().includes('json')) {
        try {
          const errorJson = JSON.parse(await data.text());
          message = errorJson.message || errorJson.error || message;
        } catch {
          // Blob 非 JSON 格式，使用默认消息
        }
      } else if (typeof data === 'object' && data !== null) {
        message =
          (data as { message?: string; error?: string }).message ||
          (data as { error?: string }).error ||
          message;
      } else if (typeof data === 'string') {
        message = data;
      }
    } else if (error instanceof Error && error.message) {
      message = error.message;
    }
    fullBackupMessage.value = message;
    fullBackupSuccess.value = false;
  } finally {
    fullBackupLoading.value = false;
  }
};

// 导入功能
const {
  importLoading,
  importMessage,
  importSuccess,
  importResult,
  handleImportConnections,
  resetImportState,
} = useImportConnections();

const fileInputRef = ref<HTMLInputElement | null>(null);
const showImportConfirm = ref(false);
const pendingFile = ref<File | null>(null);

/** 触发文件选择器 */
const triggerFileSelect = () => {
  resetImportState();
  fileInputRef.value?.click();
};

/** 文件选择后的回调，弹出确认对话框 */
const handleFileSelected = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  // 验证文件类型
  if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
    importMessage.value = t(
      'settings.importConnections.invalidFileType',
      '请选择 JSON 格式的文件。',
    );
    importSuccess.value = false;
    target.value = '';
    return;
  }

  // 验证文件大小（5MB）
  if (file.size > 5 * 1024 * 1024) {
    importMessage.value = t('settings.importConnections.fileTooLarge', '文件大小超过 5MB 限制。');
    importSuccess.value = false;
    target.value = '';
    return;
  }

  pendingFile.value = file;
  showImportConfirm.value = true;
  target.value = '';
};

/** 确认导入 */
const confirmImport = async () => {
  if (!pendingFile.value) return;
  showImportConfirm.value = false;
  await handleImportConnections(pendingFile.value);
  pendingFile.value = null;
};

/** 取消导入 */
const cancelImport = () => {
  showImportConfirm.value = false;
  pendingFile.value = null;
  resetImportState();
};

const {
  auditLogMaxEntries,
  auditLogMaxEntriesLoading,
  auditLogMaxEntriesMessage,
  auditLogMaxEntriesSuccess,
  handleUpdateAuditLogMaxEntries,
  deleteAuditLogsLoading,
  deleteAuditLogsMessage,
  deleteAuditLogsSuccess,
  auditLogCount,
  showDeleteConfirm,
  handleDeleteAllAuditLogs,
} = useAuditSettings();
</script>
