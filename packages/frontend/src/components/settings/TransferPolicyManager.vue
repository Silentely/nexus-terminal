<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
    useTransferPoliciesStore,
    type TransferPolicy,
    type CreatePolicyData
} from '../../stores/transfer-policies.store';

const { t } = useI18n();
const store = useTransferPoliciesStore();

const dialogVisible = ref(false);
const editingPolicy = ref<TransferPolicy | null>(null);
const formRef = ref();

const form = ref<CreatePolicyData>({
    name: '',
    scope: 'global',
    scope_id: null,
    direction: 'both',
    max_file_size: null,
    max_total_size: null, // 保留字段但不显示在 UI 中（评估逻辑未实现）
    allowed_extensions: null,
    blocked_extensions: null,
    enabled: 1,
    priority: 0
});

const extensionsInput = ref('');
const blockedExtensionsInput = ref('');

const resetForm = () => {
    form.value = {
        name: '',
        scope: 'global',
        scope_id: null,
        direction: 'both',
        max_file_size: null,
        max_total_size: null,
        allowed_extensions: null,
        blocked_extensions: null,
        enabled: 1,
        priority: 0
    };
    extensionsInput.value = '';
    blockedExtensionsInput.value = '';
    editingPolicy.value = null;
};

const handleAdd = () => {
    resetForm();
    dialogVisible.value = true;
};

const handleEdit = (policy: TransferPolicy) => {
    editingPolicy.value = policy;
    form.value = {
        name: policy.name,
        scope: policy.scope,
        scope_id: policy.scope_id,
        direction: policy.direction,
        max_file_size: policy.max_file_size,
        max_total_size: policy.max_total_size,
        allowed_extensions: null,
        blocked_extensions: null,
        enabled: policy.enabled,
        priority: policy.priority
    };
    extensionsInput.value = policy.allowed_extensions?.join(', ') || '';
    blockedExtensionsInput.value = policy.blocked_extensions?.join(', ') || '';
    dialogVisible.value = true;
};

const handleDelete = async (policy: TransferPolicy) => {
    try {
        await ElMessageBox.confirm(
            t('settings.transferPolicies.deleteConfirm', { name: policy.name }),
            t('common.warning'),
            { type: 'warning' }
        );
        const success = await store.deletePolicy(policy.id);
        if (success) {
            ElMessage.success(t('settings.transferPolicies.deleted'));
        } else {
            ElMessage.error(store.error || t('settings.transferPolicies.deleteFailed'));
        }
    } catch {
        // User cancelled
    }
};

const handleSave = async () => {
    try {
        // Parse extensions
        const allowedExts = extensionsInput.value
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(e => e.length > 0);
        const blockedExts = blockedExtensionsInput.value
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(e => e.length > 0);

        const data: CreatePolicyData = {
            ...form.value,
            allowed_extensions: allowedExts.length > 0 ? allowedExts : null,
            blocked_extensions: blockedExts.length > 0 ? blockedExts : null
        };

        let success: boolean;
        if (editingPolicy.value) {
            success = await store.updatePolicy(editingPolicy.value.id, data);
        } else {
            const id = await store.createPolicy(data);
            success = !!id;
        }

        if (success) {
            ElMessage.success(t('settings.transferPolicies.saved'));
            dialogVisible.value = false;
            resetForm();
        } else {
            ElMessage.error(store.error || t('settings.transferPolicies.saveFailed'));
        }
    } catch (err: any) {
        ElMessage.error(err.message || t('settings.transferPolicies.saveFailed'));
    }
};

const scopeOptions = computed(() => [
    { value: 'global', label: t('settings.transferPolicies.scope.global') },
    { value: 'user_group', label: t('settings.transferPolicies.scope.user_group') },
    { value: 'user', label: t('settings.transferPolicies.scope.user') },
    { value: 'connection', label: t('settings.transferPolicies.scope.connection') },
    { value: 'group', label: t('settings.transferPolicies.scope.group') }
]);

const directionOptions = computed(() => [
    { value: 'upload', label: t('settings.transferPolicies.direction.upload') },
    { value: 'download', label: t('settings.transferPolicies.direction.download') },
    { value: 'both', label: t('settings.transferPolicies.direction.both') },
    { value: 'none', label: t('settings.transferPolicies.direction.none') }
]);

const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
};

const formatSize = (bytes: number | null) => {
    if (bytes === null) return '-';
    return store.formatBytes(bytes);
};

const enabledStatus = (enabled: number) => {
    return enabled === 1 ? 'success' : 'info';
};

const enabledText = (enabled: number) => {
    return enabled === 1 ? t('common.enabled') : t('common.disabled');
};

onMounted(() => {
    store.fetchPolicies();
});
</script>

<template>
    <div class="transfer-policy-manager">
        <div class="header">
            <h3>{{ t('settings.transferPolicies.title') }}</h3>
            <el-button type="primary" @click="handleAdd">
                {{ t('settings.transferPolicies.add') }}
            </el-button>
        </div>

        <el-table
            :data="store.policies"
            v-loading="store.isLoading"
            style="width: 100%"
            stripe
        >
            <el-table-column prop="name" :label="t('settings.transferPolicies.name')" min-width="150" />
            <el-table-column :label="t('settings.transferPolicies.scope')" width="120">
                <template #default="{ row }">
                    <el-tag>{{ t(store.getScopeLabel(row.scope)) }}</el-tag>
                </template>
            </el-table-column>
            <el-table-column :label="t('settings.transferPolicies.direction')" width="100">
                <template #default="{ row }">
                    <el-tag type="primary">{{ t(store.getDirectionLabel(row.direction)) }}</el-tag>
                </template>
            </el-table-column>
            <el-table-column :label="t('settings.transferPolicies.maxFileSize')" width="120">
                <template #default="{ row }">
                    {{ formatSize(row.max_file_size) }}
                </template>
            </el-table-column>
            <el-table-column :label="t('settings.transferPolicies.extensions')" min-width="150">
                <template #default="{ row }">
                    <template v-if="row.allowed_extensions?.length">
                        <el-tag
                            v-for="ext in row.allowed_extensions.slice(0, 3)"
                            :key="ext"
                            size="small"
                            type="success"
                            class="mr-1"
                        >.{{ ext }}</el-tag>
                        <el-tag v-if="row.allowed_extensions.length > 3" size="small">
                            +{{ row.allowed_extensions.length - 3 }}
                        </el-tag>
                    </template>
                    <template v-else-if="row.blocked_extensions?.length">
                        <el-tag
                            v-for="ext in row.blocked_extensions.slice(0, 3)"
                            :key="ext"
                            size="small"
                            type="danger"
                            class="mr-1"
                        >.{{ ext }}</el-tag>
                        <el-tag v-if="row.blocked_extensions.length > 3" size="small">
                            +{{ row.blocked_extensions.length - 3 }}
                        </el-tag>
                    </template>
                    <span v-else>-</span>
                </template>
            </el-table-column>
            <el-table-column :label="t('settings.transferPolicies.status')" width="100">
                <template #default="{ row }">
                    <el-tag :type="enabledStatus(row.enabled)">
                        {{ enabledText(row.enabled) }}
                    </el-tag>
                </template>
            </el-table-column>
            <el-table-column :label="t('settings.transferPolicies.priority')" width="80" prop="priority" />
            <el-table-column :label="t('settings.transferPolicies.createdAt')" width="160">
                <template #default="{ row }">
                    {{ formatTime(row.created_at) }}
                </template>
            </el-table-column>
            <el-table-column :label="t('common.actions')" width="150" fixed="right">
                <template #default="{ row }">
                    <el-button size="small" @click="handleEdit(row)">
                        {{ t('common.edit') }}
                    </el-button>
                    <el-popconfirm
                        :title="t('settings.transferPolicies.deleteConfirm', { name: row.name })"
                        @confirm="handleDelete(row)"
                    >
                        <template #reference>
                            <el-button
                                size="small"
                                type="danger"
                                :disabled="row.scope === 'global'"
                            >
                                {{ t('common.delete') }}
                            </el-button>
                        </template>
                    </el-popconfirm>
                </template>
            </el-table-column>
        </el-table>

        <el-dialog
            v-model="dialogVisible"
            :title="editingPolicy ? t('settings.transferPolicies.edit') : t('settings.transferPolicies.add')"
            width="600px"
        >
            <el-form ref="formRef" :model="form" label-width="120px">
                <el-form-item :label="t('settings.transferPolicies.name')" required>
                    <el-input v-model="form.name" :placeholder="t('settings.transferPolicies.namePlaceholder')" />
                </el-form-item>

                <el-form-item :label="t('settings.transferPolicies.scope')" required>
                    <el-select v-model="form.scope" style="width: 100%">
                        <el-option
                            v-for="opt in scopeOptions"
                            :key="opt.value"
                            :label="opt.label"
                            :value="opt.value"
                        />
                    </el-select>
                </el-form-item>

                <el-form-item :label="t('settings.transferPolicies.direction')">
                    <el-select v-model="form.direction" style="width: 100%">
                        <el-option
                            v-for="opt in directionOptions"
                            :key="opt.value"
                            :label="opt.label"
                            :value="opt.value"
                        />
                    </el-select>
                </el-form-item>

                <el-form-item :label="t('settings.transferPolicies.maxFileSize')">
                    <el-input-number v-model="form.max_file_size" :min="0" :placeholder="t('settings.transferPolicies.maxFileSizePlaceholder')" />
                    <span class="ml-2">bytes</span>
                </el-form-item>

                <el-form-item :label="t('settings.transferPolicies.allowedExtensions')">
                    <el-input
                        v-model="extensionsInput"
                        type="textarea"
                        :rows="2"
                        :placeholder="t('settings.transferPolicies.extensionsPlaceholder')"
                    />
                    <div class="form-tip">{{ t('settings.transferPolicies.extensionsTip') }}</div>
                </el-form-item>

                <el-form-item :label="t('settings.transferPolicies.blockedExtensions')">
                    <el-input
                        v-model="blockedExtensionsInput"
                        type="textarea"
                        :rows="2"
                        :placeholder="t('settings.transferPolicies.blockedExtensionsPlaceholder')"
                    />
                </el-form-item>

                <el-form-item :label="t('settings.transferPolicies.priority')">
                    <el-input-number v-model="form.priority" :min="0" :max="100" />
                </el-form-item>

                <el-form-item :label="t('settings.transferPolicies.status')">
                    <el-switch v-model="form.enabled" :active-value="1" :inactive-value="0" />
                </el-form-item>
            </el-form>

            <template #footer>
                <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
                <el-button type="primary" @click="handleSave" :loading="store.isLoading">
                    {{ t('common.save') }}
                </el-button>
            </template>
        </el-dialog>
    </div>
</template>

<style scoped>
.transfer-policy-manager {
    padding: 20px;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
}

.form-tip {
    font-size: 12px;
    color: #909399;
    margin-top: 4px;
}

.mr-1 {
    margin-right: 4px;
}

.ml-2 {
    margin-left: 8px;
}
</style>