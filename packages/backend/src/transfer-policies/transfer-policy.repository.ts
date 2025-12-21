import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import {
    TransferPolicyDbRow,
    CreateTransferPolicyData,
    UpdateTransferPolicyData,
    PolicyListQuery
} from './transfer-policy.types';
import { randomUUID } from 'crypto';

/**
 * 生成策略 ID
 */
export const generatePolicyId = (): string => {
    return randomUUID();
};

/**
 * 获取所有策略列表
 */
export const getAllPolicies = async (
    query?: PolicyListQuery
): Promise<TransferPolicyDbRow[]> => {
    const db = await getDbInstance();
    let sql = `SELECT * FROM transfer_policies WHERE 1=1`;
    const params: any[] = [];

    if (query?.scope) {
        sql += ` AND scope = ?`;
        params.push(query.scope);
    }

    if (query?.scope_id) {
        sql += ` AND scope_id = ?`;
        params.push(query.scope_id);
    }

    if (query?.enabled !== undefined) {
        sql += ` AND enabled = ?`;
        params.push(query.enabled);
    }

    sql += ` ORDER BY priority DESC, created_at DESC`;

    return allDb<TransferPolicyDbRow>(db, sql, params);
};

/**
 * 根据 ID 获取策略
 */
export const getPolicyById = async (
    id: string
): Promise<TransferPolicyDbRow | undefined> => {
    const db = await getDbInstance();
    return getDbRow<TransferPolicyDbRow>(
        db,
        `SELECT * FROM transfer_policies WHERE id = ?`,
        [id]
    );
};

/**
 * 创建策略
 */
export const createPolicy = async (
    data: CreateTransferPolicyData
): Promise<string> => {
    const db = await getDbInstance();
    const id = generatePolicyId();
    const now = Math.floor(Date.now() / 1000);

    const sql = `
        INSERT INTO transfer_policies (
            id, name, scope, scope_id, direction,
            max_file_size, max_total_size,
            allowed_extensions, blocked_extensions,
            enabled, priority, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
        id,
        data.name,
        data.scope,
        data.scope_id || null,
        data.direction || 'both',
        data.max_file_size || null,
        data.max_total_size || null,
        data.allowed_extensions ? JSON.stringify(data.allowed_extensions) : null,
        data.blocked_extensions ? JSON.stringify(data.blocked_extensions) : null,
        data.enabled ?? 1,
        data.priority ?? 0,
        now,
        now
    ];

    await runDb(db, sql, params);
    return id;
};

/**
 * 更新策略
 */
export const updatePolicy = async (
    data: UpdateTransferPolicyData
): Promise<boolean> => {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);

    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) {
        updates.push('name = ?');
        params.push(data.name);
    }
    if (data.scope !== undefined) {
        updates.push('scope = ?');
        params.push(data.scope);
    }
    if (data.scope_id !== undefined) {
        updates.push('scope_id = ?');
        params.push(data.scope_id);
    }
    if (data.direction !== undefined) {
        updates.push('direction = ?');
        params.push(data.direction);
    }
    if (data.max_file_size !== undefined) {
        updates.push('max_file_size = ?');
        params.push(data.max_file_size);
    }
    if (data.max_total_size !== undefined) {
        updates.push('max_total_size = ?');
        params.push(data.max_total_size);
    }
    if (data.allowed_extensions !== undefined) {
        updates.push('allowed_extensions = ?');
        params.push(data.allowed_extensions ? JSON.stringify(data.allowed_extensions) : null);
    }
    if (data.blocked_extensions !== undefined) {
        updates.push('blocked_extensions = ?');
        params.push(data.blocked_extensions ? JSON.stringify(data.blocked_extensions) : null);
    }
    if (data.enabled !== undefined) {
        updates.push('enabled = ?');
        params.push(data.enabled);
    }
    if (data.priority !== undefined) {
        updates.push('priority = ?');
        params.push(data.priority);
    }

    updates.push('updated_at = ?');
    params.push(now);

    params.push(data.id);

    const sql = `UPDATE transfer_policies SET ${updates.join(', ')} WHERE id = ?`;
    const result = await runDb(db, sql, params);

    return result.changes > 0;
};

/**
 * 删除策略
 */
export const deletePolicy = async (id: string): Promise<boolean> => {
    const db = await getDbInstance();
    const result = await runDb(
        db,
        `DELETE FROM transfer_policies WHERE id = ?`,
        [id]
    );
    return result.changes > 0;
};

/**
 * 获取有效策略（按优先级排序）
 * 用于评估传输请求时获取适用的策略
 *
 * 策略匹配逻辑：只返回符合以下任一条件的策略
 * 1. 全局策略 (scope = 'global')
 * 2. 针对当前用户的策略 (scope = 'user' AND scope_id = 用户ID)
 * 3. 针对当前连接的策略 (scope = 'connection' AND scope_id = 连接ID)
 * 4. 针对用户所属分组的策略 (scope = 'group' AND scope_id IN 分组ID列表)
 */
export const getEffectivePolicies = async (
    userId: number,
    connectionId?: number | null,
    groupIds?: number[]
): Promise<TransferPolicyDbRow[]> => {
    const db = await getDbInstance();
    const conditions: string[] = [];
    const params: any[] = [];

    // Global policy
    conditions.push(`(scope = 'global')`);

    // User-specific policy
    conditions.push(`(scope = 'user' AND scope_id = ?)`);
    params.push(String(userId));

    // Connection-specific policy (显式检查 null/undefined，避免 0 被当作有效值)
    if (connectionId !== undefined && connectionId !== null && connectionId > 0) {
        conditions.push(`(scope = 'connection' AND scope_id = ?)`);
        params.push(String(connectionId));
    }

    // Group-specific policies
    if (groupIds && groupIds.length > 0) {
        const groupPlaceholders = groupIds.map(() => '?').join(', ');
        conditions.push(`(scope = 'group' AND scope_id IN (${groupPlaceholders}))`);
        params.push(...groupIds.map(id => String(id)));
    }

    // User group policies - removed until user_groups table is implemented
    // Currently returning only global/user/connection/group policies

    const sql = `
        SELECT * FROM transfer_policies
        WHERE enabled = 1 AND (${conditions.join(' OR ')})
        ORDER BY priority DESC, scope ASC
    `;

    return allDb<TransferPolicyDbRow>(db, sql, params);
};

/**
 * 检查策略名称是否存在
 */
export const isPolicyNameExists = async (
    name: string,
    excludeId?: string
): Promise<boolean> => {
    const db = await getDbInstance();
    let sql = `SELECT COUNT(*) as count FROM transfer_policies WHERE name = ?`;
    const params: any[] = [name];

    if (excludeId) {
        sql += ` AND id != ?`;
        params.push(excludeId);
    }

    const result = await getDbRow<{ count: number }>(db, sql, params);
    return (result?.count || 0) > 0;
};
