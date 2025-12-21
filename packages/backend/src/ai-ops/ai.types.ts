/**
 * AI 智能运维模块类型定义
 * @module ai-ops/ai.types
 */

// AI 会话消息角色
export type AIMessageRole = 'user' | 'assistant' | 'system';

// AI 会话消息
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

// AI 查询请求
export interface AIQueryRequest {
    query: string;
    sessionId?: string;
    context?: {
        connectionIds?: number[];
        timeRange?: {
            start: Date;
            end: Date;
        };
    };
}

// AI 查询响应
export interface AIQueryResponse {
    success: boolean;
    sessionId: string;
    message: AIMessage;
    insights?: AIInsight[];
    suggestions?: string[];
}

// AI 洞察类型
export type AIInsightType =
    | 'security_alert'      // 安全告警
    | 'performance_warning' // 性能警告
    | 'pattern_detected'    // 模式检测
    | 'anomaly_detected'    // 异常检测
    | 'recommendation'      // 建议
    | 'summary';            // 摘要

// AI 洞察严重程度
export type AIInsightSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// AI 洞察
export interface AIInsight {
    type: AIInsightType;
    severity: AIInsightSeverity;
    title: string;
    description: string;
    data?: Record<string, any>;
    actionable?: boolean;
    suggestedAction?: string;
    timestamp: Date;
}

// 系统健康摘要
export interface SystemHealthSummary {
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
}

// 审计日志分析请求
export interface AuditAnalysisRequest {
    timeRange?: {
        start: Date;
        end: Date;
    };
    actionTypes?: string[];
    limit?: number;
}

// 命令模式分析结果
export interface CommandPatternAnalysis {
    totalCommands: number;
    topCommands: Array<{
        command: string;
        count: number;
        percentage: number;
    }>;
    unusualCommands?: string[];
    timeDistribution?: Record<string, number>;
}

// 数据库行类型
export interface AISessionRow {
    id: string;
    user_id: number;
    title: string | null;
    created_at: number;
    updated_at: number;
}

export interface AIMessageRow {
    id: string;
    session_id: string;
    role: AIMessageRole;
    content: string;
    timestamp: number;
    metadata_json: string | null;
}

// API 响应类型
export interface AISessionListResponse {
    success: boolean;
    sessions: AISession[];
}

export interface AIInsightsResponse {
    success: boolean;
    summary: SystemHealthSummary;
    insights: AIInsight[];
}

// WebSocket 事件
export type AIWsEventType =
    | 'ai:response'
    | 'ai:typing'
    | 'ai:insight'
    | 'ai:error';

export interface AIWsMessage {
    type: AIWsEventType;
    payload: {
        sessionId?: string;
        messageId?: string;
        content?: string;
        insight?: AIInsight;
        error?: string;
    };
}
