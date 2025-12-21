import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import apiClient from '../../utils/apiClient';

export function useAuditSettings() {
  const { t } = useI18n();

  // --- Audit Log Max Entries ---
  const auditLogMaxEntries = ref(50000);
  const auditLogMaxEntriesLoading = ref(false);
  const auditLogMaxEntriesMessage = ref('');
  const auditLogMaxEntriesSuccess = ref(false);

  const fetchAuditLogMaxEntries = async () => {
    try {
      const response = await apiClient.get('/settings/audit-log-max-entries');
      const maxEntries = response.data.maxEntries;
      if (Number.isInteger(maxEntries) && maxEntries > 0) {
        auditLogMaxEntries.value = maxEntries;
      }
    } catch (error) {
      console.error('获取审计日志最大保留条数失败:', error);
    }
  };

  const handleUpdateAuditLogMaxEntries = async () => {
    auditLogMaxEntriesLoading.value = true;
    auditLogMaxEntriesMessage.value = '';
    auditLogMaxEntriesSuccess.value = false;
    try {
      const value = auditLogMaxEntries.value;
      if (isNaN(value) || value < 100 || !Number.isInteger(value)) {
        throw new Error(t('settings.auditLog.error.invalidMaxEntries', '请输入大于等于100的整数'));
      }
      const response = await apiClient.put('/settings/audit-log-max-entries', { maxEntries: value });
      if (Number.isInteger(response.data?.maxEntries) && response.data.maxEntries > 0) {
        auditLogMaxEntries.value = response.data.maxEntries;
      }
      auditLogMaxEntriesMessage.value = t('settings.auditLog.success.maxEntriesSaved', '最大保留条数已保存');
      auditLogMaxEntriesSuccess.value = true;
    } catch (error: any) {
      console.error('更新审计日志最大保留条数失败:', error);
      auditLogMaxEntriesMessage.value =
        error.response?.data?.message || error.message || t('settings.auditLog.error.maxEntriesSaveFailed', '保存失败');
      auditLogMaxEntriesSuccess.value = false;
    } finally {
      auditLogMaxEntriesLoading.value = false;
    }
  };

  // --- Delete All Audit Logs ---
  const deleteAuditLogsLoading = ref(false);
  const deleteAuditLogsMessage = ref('');
  const deleteAuditLogsSuccess = ref(false);
  const auditLogCount = ref(0);
  const showDeleteConfirm = ref(false);

  const fetchAuditLogCount = async () => {
    try {
      const response = await apiClient.get('/audit-logs/count');
      auditLogCount.value = response.data.count || 0;
    } catch (error) {
      console.error('获取审计日志数量失败:', error);
    }
  };

  const handleDeleteAllAuditLogs = async () => {
    deleteAuditLogsLoading.value = true;
    deleteAuditLogsMessage.value = '';
    deleteAuditLogsSuccess.value = false;
    try {
      const response = await apiClient.delete('/audit-logs');
      const deletedCount = response.data?.deletedCount ?? 0;
      deleteAuditLogsMessage.value = t('settings.auditLog.success.deleted', { count: deletedCount });
      deleteAuditLogsSuccess.value = true;
      showDeleteConfirm.value = false;
      await fetchAuditLogCount();
    } catch (error: any) {
      console.error('删除审计日志失败:', error);
      deleteAuditLogsMessage.value = error.response?.data?.message || t('settings.auditLog.error.deleteFailed', '删除失败');
      deleteAuditLogsSuccess.value = false;
    } finally {
      deleteAuditLogsLoading.value = false;
    }
  };

  // Fetch audit log count on mount
  onMounted(() => {
    fetchAuditLogMaxEntries();
    fetchAuditLogCount();
  });

  return {
    // Audit Log Max Entries
    auditLogMaxEntries,
    auditLogMaxEntriesLoading,
    auditLogMaxEntriesMessage,
    auditLogMaxEntriesSuccess,
    handleUpdateAuditLogMaxEntries,

    // Delete All Audit Logs
    deleteAuditLogsLoading,
    deleteAuditLogsMessage,
    deleteAuditLogsSuccess,
    auditLogCount,
    showDeleteConfirm,
    fetchAuditLogMaxEntries,
    fetchAuditLogCount,
    handleDeleteAllAuditLogs,
  };
}
