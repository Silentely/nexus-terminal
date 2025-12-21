import * as Repository from './transfer-policy.repository';
import {
    TransferPolicyDbRow,
    CreateTransferPolicyData,
    UpdateTransferPolicyData,
    PolicyListQuery,
    PolicyListItem,
    TransferContext,
    PolicyEvaluationResult
} from './transfer-policy.types';

/**
 * 获取策略列表
 */
export const getPolicyList = async (
    query?: PolicyListQuery
): Promise<PolicyListItem[]> => {
    const policies = await Repository.getAllPolicies(query);
    return policies.map(parsePolicyRow);
};

/**
 * 获取单个策略
 */
export const getPolicyById = async (
    id: string
): Promise<PolicyListItem | null> => {
    const policy = await Repository.getPolicyById(id);
    if (!policy) return null;
    return parsePolicyRow(policy);
};

/**
 * 创建策略
 */
export const createPolicy = async (
    data: CreateTransferPolicyData
): Promise<{ id: string }> => {
    // 检查名称是否重复
    if (await Repository.isPolicyNameExists(data.name)) {
        throw new Error('策略名称已存在');
    }

    // 验证 scope 和 scope_id 的一致性
    validateScope(data.scope, data.scope_id);

    const id = await Repository.createPolicy(data);
    return { id };
};

/**
 * 更新策略
 */
export const updatePolicy = async (
    data: UpdateTransferPolicyData
): Promise<boolean> => {
    const existing = await Repository.getPolicyById(data.id);
    if (!existing) {
        throw new Error('策略不存在');
    }

    // 检查名称是否重复
    if (data.name && data.name !== existing.name) {
        if (await Repository.isPolicyNameExists(data.name, data.id)) {
            throw new Error('策略名称已存在');
        }
    }

    // 验证 scope 和 scope_id 的一致性
    if (data.scope) {
        validateScope(data.scope, data.scope_id ?? null);
    }

    return Repository.updatePolicy(data);
};

/**
 * 删除策略
 */
export const deletePolicy = async (id: string): Promise<boolean> => {
    const existing = await Repository.getPolicyById(id);
    if (!existing) {
        throw new Error('策略不存在');
    }

    // 不能删除全局策略
    if (existing.scope === 'global') {
        throw new Error('不能删除全局策略');
    }

    return Repository.deletePolicy(id);
}

/**
 * 评估传输请求
 * 返回是否允许以及拒绝原因
 */
export const evaluateTransfer = async (
    context: TransferContext
): Promise<PolicyEvaluationResult> => {
    const policies = await Repository.getEffectivePolicies(
        context.userId,
        context.connectionId,
        context.groupIds
    );

    // 按优先级排序，优先级高的策略优先应用
    policies.sort((a, b) => b.priority - a.priority);

    for (const policy of policies) {
        const result = applyPolicy(policy, context);
        if (!result.allowed) {
            return {
                allowed: false,
                reason: result.reason,
                policy
            };
        }
    }

    return { allowed: true };
};

/**
 * 获取有效策略列表（用于前端显示）
 */
export const getEffectivePoliciesForDisplay = async (
    userId: number,
    connectionId?: number
): Promise<PolicyListItem[]> => {
    // 获取用户的分组 ID
    const groupIds: number[] = [];

    const policies = await Repository.getEffectivePolicies(userId, connectionId, groupIds);
    return policies.map(parsePolicyRow);
};

// ============ 私有辅助函数 ============

/**
 * 安全解析 JSON 数组字段
 */
const parseJsonArray = (jsonString: string | null): string[] | null => {
    if (!jsonString) return null;
    try {
        const parsed = JSON.parse(jsonString);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        console.warn(`[TransferPolicy] 解析 JSON 字段失败: ${jsonString}`);
        return null;
    }
};

/**
 * 解析数据库记录为 API 响应格式
 */
const parsePolicyRow = (row: TransferPolicyDbRow): PolicyListItem => ({
    id: row.id,
    name: row.name,
    scope: row.scope,
    scope_id: row.scope_id,
    direction: row.direction,
    max_file_size: row.max_file_size,
    max_total_size: row.max_total_size,
    allowed_extensions: parseJsonArray(row.allowed_extensions),
    blocked_extensions: parseJsonArray(row.blocked_extensions),
    enabled: row.enabled,
    priority: row.priority,
    created_at: row.created_at,
    updated_at: row.updated_at
});

/**
 * 验证 scope 和 scope_id 的关系
 */
const validateScope = (scope: string, scopeId: string | null | undefined): void => {
    const scopeNeedsId = ['user', 'connection', 'group', 'user_group'];
    const scopeNoId = ['global'];

    if (scopeNeedsId.includes(scope)) {
        if (!scopeId) {
            throw new Error(`作用域为 ${scope} 时必须指定 scope_id`);
        }
    } else if (scopeNoId.includes(scope)) {
        if (scopeId) {
            throw new Error(`作用域为 ${scope} 时不能指定 scope_id`);
        }
    }
};

/**
 * 应用单个策略到传输上下文
 */
const applyPolicy = (
    policy: TransferPolicyDbRow,
    context: TransferContext
): { allowed: boolean; reason?: string } => {
    // 1. 检查方向
    if (policy.direction !== 'both' && policy.direction !== context.direction) {
        return {
            allowed: false,
            reason: `传输方向 ${context.direction} 被策略 "${policy.name}" 禁止`
        };
    }

    // 2. 检查文件大小
    if (policy.max_file_size && context.fileSize > policy.max_file_size) {
        return {
            allowed: false,
            reason: `文件大小 ${formatBytes(context.fileSize)} 超过策略 "${policy.name}" 限制 ${formatBytes(policy.max_file_size)}`
        };
    }

    // 3. 检查扩展名白名单
    if (policy.allowed_extensions) {
        try {
            const allowed = JSON.parse(policy.allowed_extensions) as string[];
            const ext = context.fileName.split('.').pop()?.toLowerCase();
            if (ext && allowed.length > 0 && !allowed.includes(ext)) {
                return {
                    allowed: false,
                    reason: `文件扩展名 .${ext} 不在策略 "${policy.name}" 的允许列表中`
                };
            }
        } catch {
            // JSON 解析失败，跳过白名单检查
        }
    }

    // 4. 检查扩展名黑名单
    if (policy.blocked_extensions) {
        try {
            const blocked = JSON.parse(policy.blocked_extensions) as string[];
            const ext = context.fileName.split('.').pop()?.toLowerCase();
            if (ext && blocked.includes(ext)) {
                return {
                    allowed: false,
                    reason: `文件扩展名 .${ext} 被策略 "${policy.name}" 禁止`
                };
            }
        } catch {
            // JSON 解析失败，跳过黑名单检查
        }
    }

    return { allowed: true };
};

/**
 * 格式化字节为可读字符串
 */
const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};
