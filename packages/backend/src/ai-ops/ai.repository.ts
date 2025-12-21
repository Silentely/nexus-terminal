/**
 * AI 智能运维 Repository 层
 * 处理 AI 会话和消息的数据库操作
 */

import { getDbInstance, runDb, allDb, getDb } from '../database/connection';
import {
    AISession,
    AIMessage,
    AIMessageRole,
    AISessionRow,
    AIMessageRow
} from './ai.types';

// 会话行数据转换为 AISession 对象
const rowToSession = (row: AISessionRow, messages: AIMessage[] = []): AISession => ({
    sessionId: row.id,
    userId: row.user_id,
    title: row.title || undefined,
    messages,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
});

// 消息行数据转换为 AIMessage 对象
const rowToMessage = (row: AIMessageRow): AIMessage => {
    let metadata: Record<string, any> | undefined;
    if (row.metadata_json) {
        try {
            metadata = JSON.parse(row.metadata_json);
        } catch {
            // 无效 JSON，忽略 metadata
            metadata = undefined;
        }
    }
    return {
        id: row.id,
        sessionId: row.session_id,
        role: row.role,
        content: row.content,
        timestamp: new Date(row.timestamp * 1000),
        metadata,
    };
};

/**
 * 创建 AI 会话
 */
export const createSession = async (
    sessionId: string,
    userId: number | string,
    title?: string
): Promise<AISession> => {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);

    await runDb(db, `
        INSERT INTO ai_sessions (id, user_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
    `, [sessionId, userId, title || null, now, now]);

    return {
        sessionId,
        userId,
        title,
        messages: [],
        createdAt: new Date(now * 1000),
        updatedAt: new Date(now * 1000),
    };
};

/**
 * 获取会话（包含消息，支持分页）
 */
export const getSession = async (
    sessionId: string,
    messageLimit: number = 100,
    messageOffset: number = 0
): Promise<AISession | null> => {
    const db = await getDbInstance();
    const sessionRow = await getDb<AISessionRow>(db, `
        SELECT * FROM ai_sessions WHERE id = ?
    `, [sessionId]);

    if (!sessionRow) return null;

    const messageRows = await allDb<AIMessageRow>(db, `
        SELECT * FROM ai_messages WHERE session_id = ?
        ORDER BY timestamp ASC
        LIMIT ? OFFSET ?
    `, [sessionId, messageLimit, messageOffset]);

    const messages = messageRows.map(rowToMessage);
    return rowToSession(sessionRow, messages);
};

/**
 * 获取用户的会话列表（不含消息内容）
 */
export const getSessionsByUser = async (
    userId: number | string,
    limit: number = 50,
    offset: number = 0
): Promise<AISession[]> => {
    const db = await getDbInstance();
    const sessionRows = await allDb<AISessionRow>(db, `
        SELECT * FROM ai_sessions
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    return sessionRows.map(row => rowToSession(row, []));
};

/**
 * 更新会话标题
 */
export const updateSessionTitle = async (
    sessionId: string,
    title: string
): Promise<void> => {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);

    await runDb(db, `
        UPDATE ai_sessions SET title = ?, updated_at = ? WHERE id = ?
    `, [title, now, sessionId]);
};

/**
 * 更新会话的 updated_at 时间戳
 */
export const touchSession = async (sessionId: string): Promise<void> => {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);

    await runDb(db, `
        UPDATE ai_sessions SET updated_at = ? WHERE id = ?
    `, [now, sessionId]);
};

/**
 * 删除会话（级联删除消息）
 */
export const deleteSession = async (sessionId: string): Promise<void> => {
    const db = await getDbInstance();
    await runDb(db, 'DELETE FROM ai_sessions WHERE id = ?', [sessionId]);
};

/**
 * 添加消息到会话
 */
export const addMessage = async (
    messageId: string,
    sessionId: string,
    role: AIMessageRole,
    content: string,
    metadata?: Record<string, any>
): Promise<AIMessage> => {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);

    await runDb(db, `
        INSERT INTO ai_messages (id, session_id, role, content, timestamp, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [
        messageId,
        sessionId,
        role,
        content,
        now,
        metadata ? JSON.stringify(metadata) : null
    ]);

    // 更新会话时间戳
    await touchSession(sessionId);

    return {
        id: messageId,
        sessionId,
        role,
        content,
        timestamp: new Date(now * 1000),
        metadata,
    };
};

/**
 * 获取会话的消息列表
 */
export const getMessages = async (
    sessionId: string,
    limit: number = 100,
    offset: number = 0
): Promise<AIMessage[]> => {
    const db = await getDbInstance();
    const rows = await allDb<AIMessageRow>(db, `
        SELECT * FROM ai_messages
        WHERE session_id = ?
        ORDER BY timestamp ASC
        LIMIT ? OFFSET ?
    `, [sessionId, limit, offset]);

    return rows.map(rowToMessage);
};

/**
 * 获取会话的最新 N 条消息（用于上下文构建）
 */
export const getRecentMessages = async (
    sessionId: string,
    count: number = 10
): Promise<AIMessage[]> => {
    const db = await getDbInstance();
    const rows = await allDb<AIMessageRow>(db, `
        SELECT * FROM (
            SELECT * FROM ai_messages
            WHERE session_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        ) ORDER BY timestamp ASC
    `, [sessionId, count]);

    return rows.map(rowToMessage);
};

/**
 * 删除消息
 */
export const deleteMessage = async (messageId: string): Promise<void> => {
    const db = await getDbInstance();
    await runDb(db, 'DELETE FROM ai_messages WHERE id = ?', [messageId]);
};

/**
 * 获取用户的会话数量
 */
export const getSessionCount = async (userId: number | string): Promise<number> => {
    const db = await getDbInstance();
    const result = await getDb<{ count: number }>(db, `
        SELECT COUNT(*) as count FROM ai_sessions WHERE user_id = ?
    `, [userId]);
    return result?.count || 0;
};

/**
 * 清理用户的旧会话（保留最近 N 个）
 */
export const cleanupOldSessions = async (
    userId: number | string,
    keepCount: number = 50
): Promise<number> => {
    const db = await getDbInstance();

    // 获取要保留的会话 ID
    const keepSessions = await allDb<{ id: string }>(db, `
        SELECT id FROM ai_sessions
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
    `, [userId, keepCount]);

    if (keepSessions.length === 0) return 0;

    // 使用参数化查询，避免 SQL 注入风险
    const placeholders = keepSessions.map(() => '?').join(',');
    const keepIds = keepSessions.map(s => s.id);

    const result = await runDb(db, `
        DELETE FROM ai_sessions
        WHERE user_id = ? AND id NOT IN (${placeholders})
    `, [userId, ...keepIds]);

    return (result as any).changes || 0;
};

/**
 * 检查会话是否属于用户
 */
export const isSessionOwnedByUser = async (
    sessionId: string,
    userId: number | string
): Promise<boolean> => {
    const db = await getDbInstance();
    const result = await getDb<{ count: number }>(db, `
        SELECT COUNT(*) as count FROM ai_sessions
        WHERE id = ? AND user_id = ?
    `, [sessionId, userId]);
    return (result?.count || 0) > 0;
};
