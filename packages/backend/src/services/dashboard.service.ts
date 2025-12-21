import { getDbInstance, getDb as getDbRow, allDb } from '../database/connection';
import { clientStates } from '../websocket/state';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AuditLogActionType } from '../types/audit.types';

/**
 * 存储统计缓存 - 避免频繁同步遍历目录阻塞事件循环
 * 推荐的生产环境改进：使用后台定时任务维护，接口仅返回缓存值
 */
interface StorageCache {
    recordingsSize: number;
    databaseSize: number;
    uploadsSize: number;
    totalSize: number;
    timestamp: number;
}

const STORAGE_CACHE_TTL = 60000; // 缓存 60 秒
let storageCache: StorageCache | null = null;

/**
 * 审计动作类型映射 - 将内部枚举转换为显示标签
 */
const getActionLabel = (actionType: string): string => {
    const labels: Record<string, string> = {
        'SSH_CONNECT': 'SSH 连接',
        'SSH_DISCONNECT': 'SSH 断开',
        'RDP_CONNECT': 'RDP 连接',
        'RDP_DISCONNECT': 'RDP 断开',
        'VNC_CONNECT': 'VNC 连接',
        'VNC_DISCONNECT': 'VNC 断开',
        'LOGIN_SUCCESS': '登录成功',
        'LOGIN_FAILURE': '登录失败',
        'COMMAND_EXECUTED': '命令执行',
        'COMMAND_BLOCKED': '命令被拦截',
        'FILE_UPLOAD': '文件上传',
        'FILE_DOWNLOAD': '文件下载',
        'ALERT_SECURITY': '安全告警',
        'ALERT_ERROR': '错误告警',
        'SESSION_SUSPEND': '会话挂起',
        'SESSION_RESUME': '会话恢复'
    };
    return labels[actionType] || actionType;
};

/**
 * 审计动作类型映射 - 将显示类型转换为数据库值
 */
const actionTypeMappings: Record<string, string[]> = {
    'connection_connected': ['SSH_CONNECT', 'RDP_CONNECT', 'VNC_CONNECT'],
    'connection_disconnected': ['SSH_DISCONNECT', 'RDP_DISCONNECT', 'VNC_DISCONNECT'],
    'auth_login_success': ['LOGIN_SUCCESS'],
    'auth_login_failed': ['LOGIN_FAILURE'],
    'command_executed': ['COMMAND_EXECUTED'],
    'command_blocked': ['COMMAND_BLOCKED'],
    'file_upload': ['FILE_UPLOAD'],
    'file_download': ['FILE_DOWNLOAD'],
    'alert_security': ['ALERT_SECURITY'],
    'alert_error': ['ALERT_ERROR']
};

/**
 * 获取条件 SQL 和参数
 */
const buildActionTypeCondition = (actionType: string): { sql: string; params: number[] } => {
    const mappedTypes = actionTypeMappings[actionType];
    if (mappedTypes && mappedTypes.length > 0) {
        const placeholders = mappedTypes.map(() => '?').join(', ');
        return {
            sql: `action_type IN (${placeholders})`,
            params: mappedTypes as unknown as number[]
        };
    }
    return { sql: 'action_type = ?', params: [actionType as unknown as number] };
};

/**
 * 获取仪表盘统计数据
 */
export const getDashboardStats = async (timeRange?: { start: number; end: number }) => {
    const db = await getDbInstance();

    // 活跃会话数
    const activeSessions = clientStates.size;

    // 今日连接数
    const today = Math.floor(Date.now() / 1000 / 86400) * 86400;

    // 使用映射后的 action_type
    const connTypes = actionTypeMappings['connection_connected'];
    const connPlaceholders = connTypes.map(() => '?').join(', ');
    const todayConnectionsResult = await getDbRow<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM audit_logs WHERE timestamp >= ? AND action_type IN (${connPlaceholders})`,
        [today, ...connTypes]
    );
    const todayConnections = todayConnectionsResult?.count || 0;

    // 移除 duration 相关的查询 - audit_logs 表没有 duration 字段
    // 改为返回零值，后续可通过连接/断开日志的时间差计算
    // 使用更友好的 key 命名，与前端一致
    const durationDist = {
        lt5min: 0,      // 少于 5 分钟
        '5min-30min': 0, // 5-30 分钟
        '30min-1hr': 0, // 30 分钟到 1 小时
        gt1hr: 0        // 超过 1 小时
    };

    // 登录失败次数
    const failTypes = actionTypeMappings['auth_login_failed'];
    const failPlaceholders = failTypes.map(() => '?').join(', ');
    const loginFailuresResult = await getDbRow<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM audit_logs WHERE timestamp >= ? AND action_type IN (${failPlaceholders})`,
        [today, ...failTypes]
    );
    const loginFailures = loginFailuresResult?.count || 0;

    // 命令拦截次数
    const blockTypes = actionTypeMappings['command_blocked'];
    const blockPlaceholders = blockTypes.map(() => '?').join(', ');
    const commandBlocksResult = await getDbRow<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM audit_logs WHERE timestamp >= ? AND action_type IN (${blockPlaceholders})`,
        [today, ...blockTypes]
    );
    const commandBlocks = commandBlocksResult?.count || 0;

    // 异常告警次数
    const alertsResult = await getDbRow<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM audit_logs WHERE timestamp >= ? AND action_type LIKE ?`,
        [today, 'ALERT_%']
    );
    const alerts = alertsResult?.count || 0;

    return {
        sessions: {
            active: activeSessions,
            todayConnections,
            avgDuration: 0,
            durationDistribution: durationDist
        },
        security: {
            loginFailures,
            commandBlocks,
            alerts
        },
        timestamp: Date.now()
    };
};

/**
 * 获取资产健康状态
 *
 * 安全说明：出于安全考虑，不再对连接进行实时网络探测。
 * 实时探测存在 SSRF 风险（可被利用进行内网端口扫描）。
 * 如需实现资产健康检测，建议：
 * 1. 使用后台定时任务定期探测并缓存结果
 * 2. 基于 WebSocket 连接状态判断（用户在连接时自然产生）
 * 3. 限制仅管理员可访问此接口
 */
export const getAssetHealth = async (): Promise<{
    total: number;
    healthy: number;
    unreachable: number;
    assets: Array<{
        id: number;
        name: string;
        host: string;
        port: number;
        status: 'online' | 'offline' | 'unknown';
        latency?: number;
        lastCheck: number;
    }>;
}> => {
    const db = await getDbInstance();

    // 获取所有连接
    const connections = await allDb<{ id: number; name: string | null; host: string; port: number; type: string }>(
        db,
        `SELECT id, name, host, port, type FROM connections ORDER BY name ASC`
    );

    // 返回 unknown 状态，不进行真实网络探测
    const assets = connections.map((conn) => ({
        id: conn.id,
        name: conn.name || `${conn.type || 'SSH'} ${conn.host}:${conn.port}`,
        host: conn.host,
        port: conn.port,
        status: 'unknown' as const,
        lastCheck: Date.now()
    }));

    return {
        total: assets.length,
        healthy: 0, // 未知状态，不计入健康
        unreachable: 0, // 未知状态，不计入离线
        assets
    };
};

/**
 * 获取活动时间线
 */
export const getActivityTimeline = async (limit: number = 20): Promise<Array<{
    id: number;
    timestamp: number;
    actionType: string;
    actionLabel: string;
    details?: string;
}>> => {
    const db = await getDbInstance();

    const events = await allDb<{
        id: number;
        timestamp: number;
        action_type: string;
        details: string | null;
    }>(
        db,
        `SELECT id, timestamp, action_type, details
         FROM audit_logs
         ORDER BY timestamp DESC
         LIMIT ?`,
        [limit]
    );

    return events.map(e => ({
        id: e.id,
        timestamp: e.timestamp,
        actionType: e.action_type,
        actionLabel: getActionLabel(e.action_type),
        details: e.details || undefined
    }));
};

/**
 * 获取存储统计
 *
 * 性能优化：使用 60 秒缓存，避免频繁同步遍历目录阻塞事件循环
 */
export const getStorageStats = async (): Promise<{
    recordingsSize: number;
    databaseSize: number;
    uploadsSize: number;
    totalSize: number;
}> => {
    const now = Date.now();

    // 检查缓存是否有效
    if (storageCache && (now - storageCache.timestamp) < STORAGE_CACHE_TTL) {
        return {
            recordingsSize: storageCache.recordingsSize,
            databaseSize: storageCache.databaseSize,
            uploadsSize: storageCache.uploadsSize,
            totalSize: storageCache.totalSize
        };
    }

    const dataDir = path.resolve(__dirname, '../../data');

    let recordingsSize = 0;
    let uploadsSize = 0;
    let databaseSize = 0;

    // 计算录像文件大小
    const recordingsDir = path.join(dataDir, 'sessions');
    if (fs.existsSync(recordingsDir)) {
        recordingsSize = getDirSize(recordingsDir);
    }

    // 计算上传文件大小
    const uploadsDir = path.join(dataDir, 'uploads');
    if (fs.existsSync(uploadsDir)) {
        uploadsSize = getDirSize(uploadsDir);
    }

    // 计算数据库大小
    const dbPath = path.join(dataDir, 'nexus-terminal.db');
    if (fs.existsSync(dbPath)) {
        databaseSize = fs.statSync(dbPath).size;
    }

    // 更新缓存
    storageCache = {
        recordingsSize,
        databaseSize,
        uploadsSize,
        totalSize: recordingsSize + uploadsSize + databaseSize,
        timestamp: now
    };

    return storageCache;
};

/**
 * 获取目录总大小
 */
const getDirSize = (dir: string): number => {
    let total = 0;

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                total += getDirSize(fullPath);
            } else if (entry.isFile()) {
                try {
                    total += fs.statSync(fullPath).size;
                } catch {
                    // 忽略读取错误
                }
            }
        }
    } catch {
        // 忽略访问错误
    }

    return total;
};

/**
 * 获取系统资源使用情况
 */
export const getSystemResources = async (): Promise<{
    cpuPercent: number;
    memPercent: number;
    memUsed: number;
    memTotal: number;
    diskPercent: number;
    diskUsed: number;
    diskTotal: number;
    loadAvg: number[];
    timestamp: number;
}> => {
    const cpuUsage = process.cpuUsage();
    const totalCpuTime = cpuUsage.user + cpuUsage.system;
    const cpuPercent = Math.round((totalCpuTime / 10000000) * 100); // 粗略估算

    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const memUsed = memUsage.heapUsed;
    const memPercent = Math.round((memUsed / totalMem) * 100);

    // 磁盘使用情况
    const dataDir = path.resolve(__dirname, '../../data');
    let diskUsed = 0;
    let diskTotal = 0;

    try {
        if (fs.existsSync(dataDir)) {
            diskUsed = getDirSize(dataDir);
        }
        // 估算总磁盘空间（简化处理）
        diskTotal = 10 * 1024 * 1024 * 1024; // 假设10GB
    } catch {
        // 忽略错误
    }

    const diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;

    return {
        cpuPercent: Math.min(cpuPercent, 100),
        memPercent: Math.min(memPercent, 100),
        memUsed,
        memTotal: totalMem,
        diskPercent: Math.min(diskPercent, 100),
        diskUsed,
        diskTotal,
        loadAvg: os.loadavg(),
        timestamp: Date.now()
    };
};

/**
 * 格式化字节为可读字符串
 */
export const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
