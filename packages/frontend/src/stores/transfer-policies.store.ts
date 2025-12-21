import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../utils/apiClient';

export type PolicyScope = 'global' | 'user_group' | 'user' | 'connection' | 'group';
export type TransferDirection = 'upload' | 'download' | 'both' | 'none';

export interface TransferPolicy {
    id: string;
    name: string;
    scope: PolicyScope;
    scope_id: string | null;
    direction: TransferDirection;
    max_file_size: number | null;
    max_total_size: number | null;
    allowed_extensions: string[] | null;
    blocked_extensions: string[] | null;
    enabled: number;
    priority: number;
    created_at: number;
    updated_at: number;
}

export interface CreatePolicyData {
    name: string;
    scope: PolicyScope;
    scope_id?: string | null;
    direction?: TransferDirection;
    max_file_size?: number | null;
    max_total_size?: number | null;
    allowed_extensions?: string[] | null;
    blocked_extensions?: string[] | null;
    enabled?: number;
    priority?: number;
}

interface TransferPoliciesState {
    policies: TransferPolicy[];
    effectivePolicies: TransferPolicy[];
    isLoading: boolean;
    error: string | null;
}

export const useTransferPoliciesStore = defineStore('transferPolicies', () => {
    const state = ref<TransferPoliciesState>({
        policies: [],
        effectivePolicies: [],
        isLoading: false,
        error: null
    });

    const fetchPolicies = async (query?: { scope?: PolicyScope; enabled?: number }) => {
        state.value.isLoading = true;
        state.value.error = null;

        try {
            const params = new URLSearchParams();
            if (query?.scope) params.append('scope', query.scope);
            if (query?.enabled !== undefined) params.append('enabled', String(query.enabled));

            const response = await apiClient.get<{ policies: TransferPolicy[] }>(
                `/transfer-policies?${params.toString()}`
            );
            state.value.policies = response.data.policies || [];
        } catch (err: any) {
            console.error('获取传输策略列表失败:', err);
            state.value.error = err.response?.data?.message || '获取传输策略列表失败';
        } finally {
            state.value.isLoading = false;
        }
    };

    const fetchEffectivePolicies = async (connectionId?: number) => {
        state.value.isLoading = true;
        state.value.error = null;

        try {
            const params = connectionId ? `?connection_id=${connectionId}` : '';
            const response = await apiClient.get<{ policies: TransferPolicy[] }>(
                `/transfer-policies/effective${params}`
            );
            state.value.effectivePolicies = response.data.policies || [];
            return state.value.effectivePolicies;
        } catch (err: any) {
            console.error('获取有效策略失败:', err);
            state.value.error = err.response?.data?.message || '获取有效策略失败';
            return [];
        } finally {
            state.value.isLoading = false;
        }
    };

    const createPolicy = async (data: CreatePolicyData): Promise<string | null> => {
        state.value.isLoading = true;
        state.value.error = null;

        try {
            const response = await apiClient.post<{ id: string }>('/transfer-policies', data);
            await fetchPolicies();
            return response.data.id;
        } catch (err: any) {
            console.error('创建传输策略失败:', err);
            state.value.error = err.response?.data?.message || '创建传输策略失败';
            return null;
        } finally {
            state.value.isLoading = false;
        }
    };

    const updatePolicy = async (id: string, data: Partial<CreatePolicyData>): Promise<boolean> => {
        state.value.isLoading = true;
        state.value.error = null;

        try {
            await apiClient.put(`/transfer-policies/${id}`, data);
            await fetchPolicies();
            return true;
        } catch (err: any) {
            console.error('更新传输策略失败:', err);
            state.value.error = err.response?.data?.message || '更新传输策略失败';
            return false;
        } finally {
            state.value.isLoading = false;
        }
    };

    const deletePolicy = async (id: string): Promise<boolean> => {
        state.value.isLoading = true;
        state.value.error = null;

        try {
            await apiClient.delete(`/transfer-policies/${id}`);
            state.value.policies = state.value.policies.filter(p => p.id !== id);
            return true;
        } catch (err: any) {
            console.error('删除传输策略失败:', err);
            state.value.error = err.response?.data?.message || '删除传输策略失败';
            return false;
        } finally {
            state.value.isLoading = false;
        }
    };

    const validateTransfer = async (
        connectionId: number,
        direction: 'upload' | 'download',
        fileName: string,
        fileSize: number
    ): Promise<{ allowed: boolean; reason?: string }> => {
        try {
            const response = await apiClient.post<{
                allowed: boolean;
                reason?: string;
            }>('/transfer-policies/validate', {
                connection_id: connectionId,
                direction,
                file_name: fileName,
                file_size: fileSize
            });
            return {
                allowed: response.data.allowed,
                reason: response.data.reason
            };
        } catch (err: any) {
            console.error('验证传输失败:', err);
            return {
                allowed: false,
                reason: err.response?.data?.reason || '验证传输失败'
            };
        }
    };

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    const getScopeLabel = (scope: PolicyScope): string => {
        return `settings.transferPolicies.scope.${scope}`;
    };

    const getDirectionLabel = (direction: TransferDirection): string => {
        return `settings.transferPolicies.direction.${direction}`;
    };

    return {
        state: readonly(state),
        policies: computed(() => state.value.policies),
        effectivePolicies: computed(() => state.value.effectivePolicies),
        isLoading: computed(() => state.value.isLoading),
        error: computed(() => state.value.error),
        fetchPolicies,
        fetchEffectivePolicies,
        createPolicy,
        updatePolicy,
        deletePolicy,
        validateTransfer,
        formatBytes,
        getScopeLabel,
        getDirectionLabel
    };
});
