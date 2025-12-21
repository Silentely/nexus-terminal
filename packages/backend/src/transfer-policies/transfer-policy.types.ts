/**
 * 文件传输策略类型定义
 */

// 策略适用范围
export type PolicyScope = 'global' | 'user_group' | 'user' | 'connection' | 'group';

// 传输方向
export type TransferDirection = 'upload' | 'download' | 'both' | 'none';

// 传输策略数据库记录
export interface TransferPolicyDbRow {
    id: string;
    name: string;
    scope: PolicyScope;
    scope_id: string | null;
    direction: TransferDirection;
    max_file_size: number | null;
    max_total_size: number | null;
    allowed_extensions: string | null;
    blocked_extensions: string | null;
    enabled: number;
    priority: number;
    created_at: number;
    updated_at: number;
}

// 创建策略请求
export interface CreateTransferPolicyData {
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

// 更新策略请求
export interface UpdateTransferPolicyData extends Partial<CreateTransferPolicyData> {
    id: string;
}

// 策略列表查询参数
export interface PolicyListQuery {
    scope?: PolicyScope;
    scope_id?: string;
    enabled?: number;
}

// 传输上下文（用于策略评估）
export interface TransferContext {
    userId: number;
    connectionId?: number;
    groupIds?: number[];
    direction: 'upload' | 'download';
    fileName: string;
    fileSize: number;
}

// 策略评估结果
export interface PolicyEvaluationResult {
    allowed: boolean;
    reason?: string;
    policy?: TransferPolicyDbRow;
}

// 策略列表响应
export interface PolicyListItem {
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
