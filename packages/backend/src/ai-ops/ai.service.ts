/**
 * AI 智能运维 Service 层
 * 提供系统健康分析、命令模式分析和智能问答功能
 */

import { v4 as uuidv4 } from 'uuid';
import { getDbInstance, allDb, getDb } from '../database/connection';
import {
    AISession,
    AIMessage,
    AIQueryRequest,
    AIQueryResponse,
    AIInsight,
    AIInsightSeverity,
    SystemHealthSummary,
    CommandPatternAnalysis
} from './ai.types';
import * as AIRepository from './ai.repository';
import { clientStates, userSockets } from '../websocket/state';

// 24小时的秒数
const SECONDS_24H = 24 * 60 * 60;

/**
 * 创建新会话或获取现有会话
 */
export async function getOrCreateSession(
    userId: number | string,
    sessionId?: string
): Promise<AISession> {
    if (sessionId) {
        const session = await AIRepository.getSession(sessionId);
        if (session) {
            // 验证会话属于该用户
            if (String(session.userId) === String(userId)) {
                return session;
            }
        }
    }

    // 创建新会话
    const newSessionId = uuidv4();
    return AIRepository.createSession(newSessionId, userId, '新对话');
}

/**
 * 处理 AI 查询请求
 */
export async function processQuery(
    userId: number | string,
    request: AIQueryRequest
): Promise<AIQueryResponse> {
    // 获取或创建会话
    const session = await getOrCreateSession(userId, request.sessionId);

    // 存储用户消息
    const userMessageId = uuidv4();
    await AIRepository.addMessage(
        userMessageId,
        session.sessionId,
        'user',
        request.query,
        { context: request.context }
    );

    // 分析查询类型并生成响应
    const analysis = await analyzeQuery(request.query, userId, request.context);

    // 存储助手响应
    const assistantMessageId = uuidv4();
    const assistantMessage = await AIRepository.addMessage(
        assistantMessageId,
        session.sessionId,
        'assistant',
        analysis.response,
        { insights: analysis.insights }
    );

    // 如果是首条消息，生成会话标题
    const messages = await AIRepository.getMessages(session.sessionId, 3);
    if (messages.length <= 2) {
        const title = generateSessionTitle(request.query);
        await AIRepository.updateSessionTitle(session.sessionId, title);
    }

    return {
        success: true,
        sessionId: session.sessionId,
        message: assistantMessage,
        insights: analysis.insights,
        suggestions: analysis.suggestions
    };
}

/**
 * 分析查询并生成响应
 */
async function analyzeQuery(
    query: string,
    userId: number | string,
    context?: AIQueryRequest['context']
): Promise<{
    response: string;
    insights: AIInsight[];
    suggestions: string[];
}> {
    const queryLower = query.toLowerCase();
    const insights: AIInsight[] = [];
    const suggestions: string[] = [];

    // 根据查询类型分发处理
    if (queryLower.includes('健康') || queryLower.includes('状态') || queryLower.includes('概览')) {
        // 系统健康状态查询（传入 userId 过滤用户相关数据）
        const health = await getSystemHealthSummary(userId);
        const response = formatHealthSummaryResponse(health);
        insights.push(...health.recentAlerts);
        suggestions.push('查看详细审计日志', '检查失败连接', '分析命令执行模式');
        return { response, insights, suggestions };
    }

    if (queryLower.includes('命令') || queryLower.includes('执行') || queryLower.includes('模式')) {
        // 命令模式分析（传入 userId 过滤用户相关数据）
        const analysis = await analyzeCommandPatterns(userId);
        const response = formatCommandPatternResponse(analysis);
        suggestions.push('导出命令历史', '设置命令别名', '创建快捷指令');
        return { response, insights, suggestions };
    }

    if (queryLower.includes('登录') || queryLower.includes('认证') || queryLower.includes('安全')) {
        // 安全相关查询（传入 userId 过滤用户相关数据）
        const securityInsights = await analyzeSecurityEvents(userId);
        insights.push(...securityInsights);
        const response = formatSecurityResponse(securityInsights);
        suggestions.push('启用双因素认证', '检查 IP 黑名单', '查看活跃会话');
        return { response, insights, suggestions };
    }

    if (queryLower.includes('连接') || queryLower.includes('ssh') || queryLower.includes('服务器')) {
        // 连接相关查询（传入 userId 过滤用户相关数据）
        const connectionStats = await analyzeConnectionStats(userId);
        const response = formatConnectionResponse(connectionStats);
        suggestions.push('测试连接', '更新凭证', '检查代理配置');
        return { response, insights, suggestions };
    }

    // 默认响应：通用帮助
    return {
        response: generateHelpResponse(query),
        insights: [],
        suggestions: [
            '查询系统健康状态',
            '分析命令执行模式',
            '查看安全事件统计',
            '检查连接状态'
        ]
    };
}

/**
 * 获取系统健康摘要
 * @param userId 用户 ID，用于过滤该用户相关的数据
 */
export async function getSystemHealthSummary(userId?: number | string): Promise<SystemHealthSummary> {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - SECONDS_24H;

    // 活跃连接数（通过 WebSocket 状态获取，仅统计当前用户）
    let activeConnections = 0;
    if (userId !== undefined && userId !== null) {
        const userKey = Number(userId);
        const userSocketSet = userSockets.get(userKey);
        if (userSocketSet) {
            userSocketSet.forEach(ws => {
                const state = ws.sessionId ? clientStates.get(ws.sessionId) : undefined;
                if (state?.sshClient) activeConnections++;
            });
        }
    } else {
        clientStates.forEach((state) => {
            if (state.sshClient) activeConnections++;
        });
    }

    // 24小时内失败登录次数（按用户过滤）
    const failedLogins = await getDb<{ count: number }>(db,
        userId
            ? `SELECT COUNT(*) as count FROM audit_logs WHERE action_type = 'LOGIN_FAILURE' AND timestamp >= ? AND user_id = ?`
            : `SELECT COUNT(*) as count FROM audit_logs WHERE action_type = 'LOGIN_FAILURE' AND timestamp >= ?`,
        userId ? [oneDayAgo, userId] : [oneDayAgo]
    );

    // 24小时内 SSH 失败次数（按用户过滤）
    const sshFailures = await getDb<{ count: number }>(db,
        userId
            ? `SELECT COUNT(*) as count FROM audit_logs WHERE action_type = 'SSH_CONNECT_FAILURE' AND timestamp >= ? AND user_id = ?`
            : `SELECT COUNT(*) as count FROM audit_logs WHERE action_type = 'SSH_CONNECT_FAILURE' AND timestamp >= ?`,
        userId ? [oneDayAgo, userId] : [oneDayAgo]
    );

    // 24小时内执行的命令数量（按用户过滤）
    const commandsExecuted = await getDb<{ count: number }>(db,
        userId
            ? `SELECT COUNT(*) as count FROM command_history WHERE timestamp >= ? AND user_id = ?`
            : `SELECT COUNT(*) as count FROM command_history WHERE timestamp >= ?`,
        userId ? [oneDayAgo, userId] : [oneDayAgo]
    );

    // 热门连接（基于 SSH 成功连接，按用户过滤）
    const topConnectionsData = await allDb<{ connection_id: number; count: number }>(db,
        userId
            ? `SELECT json_extract(details, '$.connectionId') as connection_id, COUNT(*) as count
               FROM audit_logs
               WHERE action_type = 'SSH_CONNECT_SUCCESS' AND timestamp >= ? AND user_id = ?
                 AND json_extract(details, '$.connectionId') IS NOT NULL
               GROUP BY connection_id ORDER BY count DESC LIMIT 5`
            : `SELECT json_extract(details, '$.connectionId') as connection_id, COUNT(*) as count
               FROM audit_logs
               WHERE action_type = 'SSH_CONNECT_SUCCESS' AND timestamp >= ?
                 AND json_extract(details, '$.connectionId') IS NOT NULL
               GROUP BY connection_id ORDER BY count DESC LIMIT 5`,
        userId ? [oneDayAgo, userId] : [oneDayAgo]
    );

    // 获取连接名称
    const topConnections = await Promise.all(
        topConnectionsData.map(async (item) => {
            const conn = await getDb<{ name: string }>(db, `
                SELECT name FROM connections WHERE id = ?
            `, [item.connection_id]);
            return {
                connectionId: item.connection_id,
                name: conn?.name || `连接 #${item.connection_id}`,
                commandCount: item.count
            };
        })
    );

    // 确定整体状态
    const failedLoginCount = failedLogins?.count || 0;
    const sshFailureCount = sshFailures?.count || 0;

    let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
    const recentAlerts: AIInsight[] = [];

    if (failedLoginCount > 10) {
        overallStatus = 'critical';
        recentAlerts.push({
            type: 'security_alert',
            severity: 'high',
            title: '登录失败次数过多',
            description: `过去24小时内检测到 ${failedLoginCount} 次登录失败，可能存在暴力破解尝试。`,
            actionable: true,
            suggestedAction: '检查 IP 黑名单并考虑启用更严格的认证策略',
            timestamp: new Date()
        });
    } else if (failedLoginCount > 5) {
        overallStatus = 'warning';
        recentAlerts.push({
            type: 'security_alert',
            severity: 'medium',
            title: '登录失败次数增加',
            description: `过去24小时内有 ${failedLoginCount} 次登录失败。`,
            actionable: true,
            suggestedAction: '审查登录失败的来源 IP',
            timestamp: new Date()
        });
    }

    if (sshFailureCount > 5) {
        if (overallStatus === 'healthy') overallStatus = 'warning';
        recentAlerts.push({
            type: 'performance_warning',
            severity: 'medium',
            title: 'SSH 连接失败',
            description: `过去24小时内有 ${sshFailureCount} 次 SSH 连接失败。`,
            actionable: true,
            suggestedAction: '检查目标服务器状态和网络连接',
            timestamp: new Date()
        });
    }

    return {
        overallStatus,
        activeConnections,
        failedLoginAttempts24h: failedLoginCount,
        sshFailures24h: sshFailureCount,
        commandsExecuted24h: commandsExecuted?.count || 0,
        topConnections,
        recentAlerts
    };
}

/**
 * 分析命令执行模式
 * @param userId 用户 ID，用于过滤该用户的命令历史
 */
export async function analyzeCommandPatterns(userId?: number | string): Promise<CommandPatternAnalysis> {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - SECONDS_24H;

    // 总命令数（按用户过滤）
    const totalResult = await getDb<{ count: number }>(db,
        userId
            ? `SELECT COUNT(*) as count FROM command_history WHERE timestamp >= ? AND user_id = ?`
            : `SELECT COUNT(*) as count FROM command_history WHERE timestamp >= ?`,
        userId ? [oneDayAgo, userId] : [oneDayAgo]
    );
    const totalCommands = totalResult?.count || 0;

    // 热门命令（提取命令名称，不含参数，按用户过滤）
    const topCommandsData = await allDb<{ cmd_name: string; count: number }>(db,
        userId
            ? `SELECT SUBSTR(command, 1, INSTR(command || ' ', ' ') - 1) as cmd_name, COUNT(*) as count
               FROM command_history WHERE timestamp >= ? AND user_id = ?
               GROUP BY cmd_name ORDER BY count DESC LIMIT 10`
            : `SELECT SUBSTR(command, 1, INSTR(command || ' ', ' ') - 1) as cmd_name, COUNT(*) as count
               FROM command_history WHERE timestamp >= ?
               GROUP BY cmd_name ORDER BY count DESC LIMIT 10`,
        userId ? [oneDayAgo, userId] : [oneDayAgo]
    );

    const topCommands = topCommandsData.map(item => ({
        command: item.cmd_name || 'unknown',
        count: item.count,
        percentage: totalCommands > 0 ? Math.round((item.count / totalCommands) * 100) : 0
    }));

    // 时间分布（按小时，按用户过滤）
    const timeDistData = await allDb<{ hour: number; count: number }>(db,
        userId
            ? `SELECT (timestamp % 86400) / 3600 as hour, COUNT(*) as count
               FROM command_history WHERE timestamp >= ? AND user_id = ?
               GROUP BY hour ORDER BY hour`
            : `SELECT (timestamp % 86400) / 3600 as hour, COUNT(*) as count
               FROM command_history WHERE timestamp >= ?
               GROUP BY hour ORDER BY hour`,
        userId ? [oneDayAgo, userId] : [oneDayAgo]
    );

    const timeDistribution: Record<string, number> = {};
    timeDistData.forEach(item => {
        timeDistribution[`${item.hour}:00`] = item.count;
    });

    // 检测异常命令（包含危险关键字，按用户过滤）
    const dangerousKeywords = ['rm -rf', 'dd if=', 'mkfs', ':(){', '> /dev/sd', 'chmod 777'];
    const unusualCommands: string[] = [];

    for (const keyword of dangerousKeywords) {
        const found = await allDb<{ command: string }>(db,
            userId
                ? `SELECT DISTINCT command FROM command_history WHERE timestamp >= ? AND user_id = ? AND command LIKE ? LIMIT 3`
                : `SELECT DISTINCT command FROM command_history WHERE timestamp >= ? AND command LIKE ? LIMIT 3`,
            userId ? [oneDayAgo, userId, `%${keyword}%`] : [oneDayAgo, `%${keyword}%`]
        );
        unusualCommands.push(...found.map(f => f.command));
    }

    return {
        totalCommands,
        topCommands,
        unusualCommands: unusualCommands.slice(0, 5),
        timeDistribution
    };
}

/**
 * 分析安全事件
 * @param userId 用户 ID，用于过滤该用户的安全事件
 */
async function analyzeSecurityEvents(userId?: number | string): Promise<AIInsight[]> {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - SECONDS_24H;
    const insights: AIInsight[] = [];

    // 检查登录失败（按用户过滤）
    const failedLogins = await allDb<{ details: string; timestamp: number }>(db,
        userId
            ? `SELECT details, timestamp FROM audit_logs
               WHERE action_type = 'LOGIN_FAILURE' AND timestamp >= ? AND user_id = ?
               ORDER BY timestamp DESC LIMIT 10`
            : `SELECT details, timestamp FROM audit_logs
               WHERE action_type = 'LOGIN_FAILURE' AND timestamp >= ?
               ORDER BY timestamp DESC LIMIT 10`,
        userId ? [oneDayAgo, userId] : [oneDayAgo]
    );

    if (failedLogins.length > 0) {
        const ipCounts = new Map<string, number>();
        failedLogins.forEach(log => {
            try {
                const details = JSON.parse(log.details || '{}');
                const ip = details.ip || 'unknown';
                ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
            } catch {}
        });

        const topIp = [...ipCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        if (topIp && topIp[1] > 3) {
            insights.push({
                type: 'security_alert',
                severity: 'high' as AIInsightSeverity,
                title: '可疑 IP 地址检测',
                description: `IP ${topIp[0]} 在24小时内有 ${topIp[1]} 次登录失败尝试。`,
                actionable: true,
                suggestedAction: '考虑将此 IP 加入黑名单',
                data: { ip: topIp[0], attempts: topIp[1] },
                timestamp: new Date()
            });
        }
    }

    // 检查 2FA 状态变更（按用户过滤）
    const twoFactorChanges = await getDb<{ count: number }>(db,
        userId
            ? `SELECT COUNT(*) as count FROM audit_logs
               WHERE action_type IN ('2FA_ENABLED', '2FA_DISABLED') AND timestamp >= ? AND user_id = ?`
            : `SELECT COUNT(*) as count FROM audit_logs
               WHERE action_type IN ('2FA_ENABLED', '2FA_DISABLED') AND timestamp >= ?`,
        userId ? [oneDayAgo, userId] : [oneDayAgo]
    );

    if ((twoFactorChanges?.count || 0) > 0) {
        insights.push({
            type: 'security_alert',
            severity: 'info' as AIInsightSeverity,
            title: '双因素认证变更',
            description: `过去24小时内有 ${twoFactorChanges?.count} 次双因素认证设置变更。`,
            actionable: false,
            timestamp: new Date()
        });
    }

    // 如果没有异常
    if (insights.length === 0) {
        insights.push({
            type: 'summary',
            severity: 'info' as AIInsightSeverity,
            title: '安全状态良好',
            description: '过去24小时内未检测到明显的安全异常。',
            actionable: false,
            timestamp: new Date()
        });
    }

    return insights;
}

/**
 * 分析连接统计
 * @param userId 用户 ID，用于过滤该用户的连接数据
 */
async function analyzeConnectionStats(userId?: number | string): Promise<{
    totalConnections: number;
    activeConnections: number;
    sshConnections: number;
    rdpConnections: number;
    vncConnections: number;
    recentlyUsed: Array<{ id: number; name: string; lastUsed: Date | null }>;
}> {
    const db = await getDbInstance();

    // 总连接数（按用户过滤）
    const total = await getDb<{ count: number }>(db,
        userId
            ? `SELECT COUNT(*) as count FROM connections WHERE user_id = ?`
            : `SELECT COUNT(*) as count FROM connections`,
        userId ? [userId] : []
    );

    // 按类型统计（按用户过滤）
    const byType = await allDb<{ type: string; count: number }>(db,
        userId
            ? `SELECT type, COUNT(*) as count FROM connections WHERE user_id = ? GROUP BY type`
            : `SELECT type, COUNT(*) as count FROM connections GROUP BY type`,
        userId ? [userId] : []
    );

    let sshConnections = 0;
    let rdpConnections = 0;
    let vncConnections = 0;
    byType.forEach(item => {
        if (item.type === 'SSH') sshConnections = item.count;
        else if (item.type === 'RDP') rdpConnections = item.count;
        else if (item.type === 'VNC') vncConnections = item.count;
    });

    // 当前活跃（按用户过滤）
    let activeConnections = 0;
    if (userId !== undefined && userId !== null) {
        const userKey = Number(userId);
        const userSocketSet = userSockets.get(userKey);
        if (userSocketSet) {
            userSocketSet.forEach(ws => {
                const state = ws.sessionId ? clientStates.get(ws.sessionId) : undefined;
                if (state?.sshClient) activeConnections++;
            });
        }
    } else {
        clientStates.forEach((state) => {
            if (state.sshClient) activeConnections++;
        });
    }

    // 最近使用的连接（按用户过滤）
    const recentlyUsedData = await allDb<{ id: number; name: string; last_connected_at: number | null }>(db,
        userId
            ? `SELECT id, name, last_connected_at FROM connections WHERE user_id = ?
               ORDER BY last_connected_at DESC NULLS LAST LIMIT 5`
            : `SELECT id, name, last_connected_at FROM connections
               ORDER BY last_connected_at DESC NULLS LAST LIMIT 5`,
        userId ? [userId] : []
    );

    const recentlyUsed = recentlyUsedData.map(item => ({
        id: item.id,
        name: item.name || `连接 #${item.id}`,
        lastUsed: item.last_connected_at ? new Date(item.last_connected_at * 1000) : null
    }));

    return {
        totalConnections: total?.count || 0,
        activeConnections,
        sshConnections,
        rdpConnections,
        vncConnections,
        recentlyUsed
    };
}

// === 响应格式化函数 ===

function formatHealthSummaryResponse(health: SystemHealthSummary): string {
    const statusEmoji = health.overallStatus === 'healthy' ? '✅' :
                        health.overallStatus === 'warning' ? '⚠️' : '🚨';

    let response = `## 系统健康摘要 ${statusEmoji}\n\n`;
    response += `**整体状态**: ${health.overallStatus === 'healthy' ? '健康' :
                                health.overallStatus === 'warning' ? '警告' : '严重'}\n\n`;

    response += `### 关键指标\n`;
    response += `- 活跃连接: ${health.activeConnections}\n`;
    response += `- 24h 登录失败: ${health.failedLoginAttempts24h}\n`;
    response += `- 24h SSH 失败: ${health.sshFailures24h}\n`;
    response += `- 24h 命令执行: ${health.commandsExecuted24h}\n\n`;

    if (health.topConnections.length > 0) {
        response += `### 热门连接\n`;
        health.topConnections.forEach((conn, i) => {
            response += `${i + 1}. ${conn.name} (${conn.commandCount} 次连接)\n`;
        });
        response += '\n';
    }

    if (health.recentAlerts.length > 0) {
        response += `### 最近告警\n`;
        health.recentAlerts.forEach(alert => {
            response += `- **${alert.title}**: ${alert.description}\n`;
        });
    }

    return response;
}

function formatCommandPatternResponse(analysis: CommandPatternAnalysis): string {
    let response = `## 命令执行分析 📊\n\n`;
    response += `**24小时内总执行**: ${analysis.totalCommands} 次\n\n`;

    if (analysis.topCommands.length > 0) {
        response += `### 最常用命令\n`;
        analysis.topCommands.slice(0, 5).forEach((cmd, i) => {
            response += `${i + 1}. \`${cmd.command}\` - ${cmd.count} 次 (${cmd.percentage}%)\n`;
        });
        response += '\n';
    }

    if (analysis.unusualCommands && analysis.unusualCommands.length > 0) {
        response += `### ⚠️ 检测到潜在危险命令\n`;
        analysis.unusualCommands.forEach(cmd => {
            response += `- \`${cmd.substring(0, 50)}${cmd.length > 50 ? '...' : ''}\`\n`;
        });
        response += '\n';
    }

    return response;
}

function formatSecurityResponse(insights: AIInsight[]): string {
    let response = `## 安全状态分析 🔒\n\n`;

    insights.forEach(insight => {
        const severityIcon = insight.severity === 'critical' ? '🚨' :
                             insight.severity === 'high' ? '⚠️' :
                             insight.severity === 'medium' ? '📋' : 'ℹ️';
        response += `### ${severityIcon} ${insight.title}\n`;
        response += `${insight.description}\n`;
        if (insight.suggestedAction) {
            response += `**建议操作**: ${insight.suggestedAction}\n`;
        }
        response += '\n';
    });

    return response;
}

function formatConnectionResponse(stats: {
    totalConnections: number;
    activeConnections: number;
    sshConnections: number;
    rdpConnections: number;
    vncConnections: number;
    recentlyUsed: Array<{ id: number; name: string; lastUsed: Date | null }>;
}): string {
    let response = `## 连接状态分析 🖥️\n\n`;
    response += `**总连接数**: ${stats.totalConnections}\n`;
    response += `**当前活跃**: ${stats.activeConnections}\n\n`;

    response += `### 按类型统计\n`;
    response += `- SSH: ${stats.sshConnections}\n`;
    response += `- RDP: ${stats.rdpConnections}\n`;
    response += `- VNC: ${stats.vncConnections}\n\n`;

    if (stats.recentlyUsed.length > 0) {
        response += `### 最近使用\n`;
        stats.recentlyUsed.forEach((conn, i) => {
            const lastUsedStr = conn.lastUsed ?
                conn.lastUsed.toLocaleString('zh-CN') : '从未使用';
            response += `${i + 1}. ${conn.name} - ${lastUsedStr}\n`;
        });
    }

    return response;
}

function generateHelpResponse(query: string): string {
    return `## 智能助手 🤖\n\n` +
           `我可以帮助您分析和了解系统状态。您可以尝试询问：\n\n` +
           `- "系统健康状态如何？"\n` +
           `- "分析最近的命令执行模式"\n` +
           `- "查看安全事件统计"\n` +
           `- "连接使用情况怎样？"\n\n` +
           `您的问题："${query}"\n\n` +
           `请尝试用上述方式重新描述您的需求，我会尽力为您提供帮助。`;
}

function generateSessionTitle(query: string): string {
    // 简单的标题生成：截取查询的前 20 个字符
    const cleaned = query.replace(/\n/g, ' ').trim();
    if (cleaned.length <= 20) return cleaned;
    return cleaned.substring(0, 20) + '...';
}

// === 会话管理函数 ===

/**
 * 获取用户会话列表
 */
export async function getUserSessions(
    userId: number | string,
    limit: number = 50,
    offset: number = 0
): Promise<AISession[]> {
    return AIRepository.getSessionsByUser(userId, limit, offset);
}

/**
 * 获取会话详情（含消息）
 */
export async function getSessionDetails(
    sessionId: string,
    userId: number | string
): Promise<AISession | null> {
    const isOwner = await AIRepository.isSessionOwnedByUser(sessionId, userId);
    if (!isOwner) return null;
    return AIRepository.getSession(sessionId);
}

/**
 * 删除会话
 */
export async function deleteSession(
    sessionId: string,
    userId: number | string
): Promise<boolean> {
    const isOwner = await AIRepository.isSessionOwnedByUser(sessionId, userId);
    if (!isOwner) return false;
    await AIRepository.deleteSession(sessionId);
    return true;
}

/**
 * 清理用户旧会话
 */
export async function cleanupUserSessions(
    userId: number | string,
    keepCount: number = 50
): Promise<number> {
    return AIRepository.cleanupOldSessions(userId, keepCount);
}
