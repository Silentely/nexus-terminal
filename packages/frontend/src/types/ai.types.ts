/**
 * AI 智能运维前端类型定义
 */

// 消息角色
export type AIMessageRole = 'user' | 'assistant' | 'system';

// AI 消息
export interface AIMessage {
    id: string;
    sessionId: string;
    role: AIMessageRole;
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

// AI 会话
export interface AISession {
    sessionId: string;
    userId: number | string;
    title?: string;
    messages: AIMessage[];
    createdAt: Date;
    updatedAt: Date;
}

// AI 洞察严重程度
export type AIInsightSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

// AI 洞察类型
export type AIInsightType = 'security_alert' | 'performance_warning' | 'recommendation' | 'summary';

// AI 洞察
export interface AIInsight {
    type: AIInsightType;
    severity: AIInsightSeverity;
    title: string;
    description: string;
    actionable: boolean;
    suggestedAction?: string;
    data?: Record<string, any>;
    timestamp: Date;
}

// 查询上下文
export interface AIQueryContext {
    connectionIds?: number[];
    currentPath?: string;
}

// 查询请求
export interface AIQueryRequest {
    query: string;
    sessionId?: string;
    context?: AIQueryContext;
}

// 查询响应
export interface AIQueryResponse {
    success: boolean;
    sessionId: string;
    message: AIMessage;
    insights: AIInsight[];
    suggestions: string[];
}

// 会话列表响应
export interface AISessionsResponse {
    success: boolean;
    sessions: AISession[];
    limit: number;
    offset: number;
}

// 会话详情响应
export interface AISessionDetailsResponse {
    success: boolean;
    session: AISession;
}

// 系统健康摘要响应
export interface AIHealthSummaryResponse {
    success: boolean;
    summary: {
        overallStatus: 'healthy' | 'warning' | 'critical';
        activeConnections: number;
        failedLoginAttempts24h: number;
        sshFailures24h: number;
        commandsExecuted24h: number;
        topConnections: Array<{
            connectionId: number;
            name: string;
            commandCount: number;
        }>;
        recentAlerts: AIInsight[];
    };
}

// 命令模式分析响应
export interface AICommandPatternsResponse {
    success: boolean;
    analysis: {
        totalCommands: number;
        topCommands: Array<{
            command: string;
            count: number;
            percentage: number;
        }>;
        unusualCommands: string[];
        timeDistribution: Record<string, number>;
    };
}

// 清理会话响应
export interface AICleanupResponse {
    success: boolean;
    message: string;
    deletedCount: number;
    keepCount: number;
}
