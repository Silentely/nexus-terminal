import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import { clientStates } from '../websocket/state';
import { getDbInstance, getDb as getDbRow, allDb } from '../database/connection';
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

type TimeRange = { start: number; end: number }; // Unix timestamp (seconds)
type CpuSample = { idle: number; total: number };
let lastCpuSample: CpuSample | null = null;

const getEffectiveTimeRange = (timeRange?: TimeRange): TimeRange => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (timeRange && timeRange.start > 0 && timeRange.end > 0 && timeRange.end >= timeRange.start) {
    return timeRange;
  }
  const start = Math.floor(nowSeconds / 86400) * 86400; // today 00:00:00
  return { start, end: nowSeconds };
};

const safeParseAuditDetails = (details: string | null): Record<string, any> | null => {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * 将 audit_logs.action_type 归一化为 Dashboard 时间线动作类型（前端用于图标 & i18n）
 */
const normalizeTimelineActionType = (rawActionType: string): string => {
  switch (rawActionType) {
    case 'SSH_CONNECT_SUCCESS':
      return 'connection_connected';
    case 'SSH_DISCONNECT':
      return 'connection_disconnected';
    case 'SSH_SESSION_SUSPENDED':
      return 'session_suspended';
    case 'LOGIN_SUCCESS':
      return 'auth_login_success';
    case 'LOGIN_FAILURE':
      return 'auth_login_failed';
    case 'COMMAND_BLOCKED':
      return 'command_blocked';
    case 'FILE_UPLOAD':
      return 'file_upload';
    case 'FILE_DOWNLOAD':
      return 'file_download';
    case 'PASSKEY_AUTH_FAILURE':
    case 'PASSKEY_DELETE_UNAUTHORIZED':
    case 'PASSKEY_NAME_UPDATE_UNAUTHORIZED':
      return 'alert_security';
    case 'SSH_CONNECT_FAILURE':
    case 'SSH_SHELL_FAILURE':
      return 'alert_error';
    default:
      return 'alert_error';
  }
};

const getTimelineActionLabelKey = (actionType: string): string => `dashboard.actions.${actionType}`;

/**
 * 审计动作类型映射 - 将显示类型转换为数据库值
 */
const actionTypeMappings: Record<string, AuditLogActionType[]> = {
  // 当前代码库会写入 audit_logs 的连接事件主要是 SSH_*；RDP/VNC 若未来接入可在此补齐
  connection_connected: ['SSH_CONNECT_SUCCESS'],
  connection_disconnected: ['SSH_DISCONNECT'],
  auth_login_success: ['LOGIN_SUCCESS'],
  auth_login_failed: ['LOGIN_FAILURE'],
  command_blocked: ['COMMAND_BLOCKED'],
  file_upload: ['FILE_UPLOAD'],
  file_download: ['FILE_DOWNLOAD'],
  // 当前项目没有统一 ALERT_*，用失败/未授权等事件代替
  alerts: [
    'SSH_CONNECT_FAILURE',
    'SSH_SHELL_FAILURE',
    'PASSKEY_AUTH_FAILURE',
    'PASSKEY_DELETE_UNAUTHORIZED',
    'PASSKEY_NAME_UPDATE_UNAUTHORIZED',
  ],
};

const countAuditLogs = async (
  db: any,
  timeRange: TimeRange,
  actionTypes: string[]
): Promise<number> => {
  if (actionTypes.length === 0) return 0;
  const placeholders = actionTypes.map(() => '?').join(', ');
  const result = await getDbRow<{ count: number }>(
    db,
    `SELECT COUNT(*) as count
         FROM audit_logs
         WHERE timestamp BETWEEN ? AND ? AND action_type IN (${placeholders})`,
    [timeRange.start, timeRange.end, ...actionTypes]
  );
  return result?.count || 0;
};

/**
 * 获取仪表盘统计数据
 */
export const getDashboardStats = async (timeRange?: { start: number; end: number }) => {
  const db = await getDbInstance();
  const effectiveRange = getEffectiveTimeRange(timeRange);

  // 活跃会话数
  const activeSessions = clientStates.size;

  // 连接数（默认“今日”，当传入 timeRange 时表示“时间范围内”）
  const rangeConnections = await countAuditLogs(
    db,
    effectiveRange,
    actionTypeMappings.connection_connected
  );

  // 会话时长分布：基于 connect/disconnect（若缺失 disconnect，则按时间范围 end 截断）
  const durationDist: Record<string, number> = {
    lt5min: 0, // < 5min
    '5min-30min': 0, // 5-30min
    '30min-1hr': 0, // 30-60min
    gt1hr: 0, // > 1hr
  };

  const connectEvents = await allDb<{ timestamp: number; details: string | null }>(
    db,
    `SELECT timestamp, details
         FROM audit_logs
         WHERE timestamp BETWEEN ? AND ? AND action_type IN (${actionTypeMappings.connection_connected.map(() => '?').join(', ')})
         ORDER BY timestamp ASC`,
    [effectiveRange.start, effectiveRange.end, ...actionTypeMappings.connection_connected]
  );

  const disconnectEvents = await allDb<{ timestamp: number; details: string | null }>(
    db,
    `SELECT timestamp, details
         FROM audit_logs
         WHERE timestamp BETWEEN ? AND ? AND action_type IN (${actionTypeMappings.connection_disconnected.map(() => '?').join(', ')})
         ORDER BY timestamp ASC`,
    [effectiveRange.start, effectiveRange.end, ...actionTypeMappings.connection_disconnected]
  );

  const disconnectBySessionId = new Map<string, number>();
  for (const e of disconnectEvents) {
    const details = safeParseAuditDetails(e.details);
    const sessionId = details?.sessionId;
    if (
      typeof sessionId === 'string' &&
      sessionId.length > 0 &&
      !disconnectBySessionId.has(sessionId)
    ) {
      disconnectBySessionId.set(sessionId, e.timestamp);
    }
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const durationSamples: number[] = [];
  for (const e of connectEvents) {
    const details = safeParseAuditDetails(e.details);
    const sessionId = details?.sessionId;
    const hasSessionId = typeof sessionId === 'string' && sessionId.length > 0;

    const disconnectAt = hasSessionId ? disconnectBySessionId.get(sessionId) : undefined;
    const endSeconds =
      typeof disconnectAt === 'number' && disconnectAt >= e.timestamp
        ? disconnectAt
        : hasSessionId && clientStates.has(sessionId)
          ? Math.min(nowSeconds, effectiveRange.end)
          : effectiveRange.end;

    const duration = Math.max(0, endSeconds - e.timestamp);
    durationSamples.push(duration);

    if (duration < 5 * 60) durationDist.lt5min += 1;
    else if (duration < 30 * 60) durationDist['5min-30min'] += 1;
    else if (duration < 60 * 60) durationDist['30min-1hr'] += 1;
    else durationDist.gt1hr += 1;
  }

  const avgDuration =
    durationSamples.length > 0
      ? Math.round(durationSamples.reduce((sum, v) => sum + v, 0) / durationSamples.length)
      : 0;

  // 登录失败次数
  const loginFailures = await countAuditLogs(
    db,
    effectiveRange,
    actionTypeMappings.auth_login_failed
  );

  // 命令拦截次数（当前若未实现拦截逻辑，该值自然为 0）
  const commandBlocks = await countAuditLogs(
    db,
    effectiveRange,
    actionTypeMappings.command_blocked
  );

  // 异常告警次数（失败/未授权等）
  const alerts = await countAuditLogs(db, effectiveRange, actionTypeMappings.alerts);

  return {
    range: effectiveRange,
    sessions: {
      active: activeSessions,
      todayConnections: rangeConnections,
      avgDuration,
      durationDistribution: durationDist,
    },
    security: {
      loginFailures,
      commandBlocks,
      alerts,
    },
    timestamp: Date.now(),
  };
};

/**
 * 获取资产健康状态
 */
interface AssetHealthCache {
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
  timestamp: number;
}

const ASSET_HEALTH_CACHE_TTL = 30000; // 30 秒
let assetHealthCache: AssetHealthCache | null = null;

const tcpProbe = async (
  host: string,
  port: number,
  timeoutMs: number
): Promise<{ ok: boolean; latency?: number }> => {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();

    const done = (ok: boolean) => {
      const latency = Date.now() - startedAt;
      try {
        socket.removeAllListeners();
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok ? { ok, latency } : { ok });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  let index = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
};

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
  const now = Date.now();
  if (assetHealthCache && now - assetHealthCache.timestamp < ASSET_HEALTH_CACHE_TTL) {
    return {
      total: assetHealthCache.total,
      healthy: assetHealthCache.healthy,
      unreachable: assetHealthCache.unreachable,
      assets: assetHealthCache.assets,
    };
  }

  const db = await getDbInstance();

  // 获取所有连接
  const connections = await allDb<{
    id: number;
    name: string | null;
    host: string;
    port: number;
    type: string;
  }>(db, `SELECT id, name, host, port, type FROM connections ORDER BY name ASC`);

  // 为避免刷新时阻塞：限制一次最多检查 100 个资产
  const limitedConnections = connections.slice(0, 100);
  const timeoutMs = 1500;

  const assets = await mapWithConcurrency(limitedConnections, 25, async (conn) => {
    const name = conn.name || `${conn.type || 'SSH'} ${conn.host}:${conn.port}`;
    const host = (conn.host || '').trim();
    const port = Number(conn.port);

    if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
      return {
        id: conn.id,
        name,
        host: conn.host,
        port: conn.port,
        status: 'unknown' as const,
        lastCheck: now,
      };
    }

    const probe = await tcpProbe(host, port, timeoutMs);
    return {
      id: conn.id,
      name,
      host: conn.host,
      port: conn.port,
      status: probe.ok ? ('online' as const) : ('offline' as const),
      latency: probe.latency,
      lastCheck: now,
    };
  });

  const healthy = assets.filter((a) => a.status === 'online').length;
  const unreachable = assets.filter((a) => a.status === 'offline').length;

  assetHealthCache = {
    total: assets.length,
    healthy,
    unreachable,
    assets,
    timestamp: now,
  };

  return {
    total: assetHealthCache.total,
    healthy: assetHealthCache.healthy,
    unreachable: assetHealthCache.unreachable,
    assets: assetHealthCache.assets,
  };
};

/**
 * 获取活动时间线
 */
export const getActivityTimeline = async (
  limit: number = 20,
  timeRange?: TimeRange
): Promise<
  Array<{
    id: number;
    timestamp: number;
    actionType: string;
    actionLabel: string;
    details?: string;
  }>
> => {
  const db = await getDbInstance();
  const effectiveRange =
    timeRange && timeRange.start > 0 && timeRange.end > 0 && timeRange.end >= timeRange.start
      ? timeRange
      : null;

  const events = await allDb<{
    id: number;
    timestamp: number;
    action_type: string;
    details: string | null;
  }>(
    db,
    effectiveRange
      ? `SELECT id, timestamp, action_type, details
               FROM audit_logs
               WHERE timestamp BETWEEN ? AND ?
               ORDER BY timestamp DESC
               LIMIT ?`
      : `SELECT id, timestamp, action_type, details
               FROM audit_logs
               ORDER BY timestamp DESC
               LIMIT ?`,
    effectiveRange ? [effectiveRange.start, effectiveRange.end, limit] : [limit]
  );

  return events.map((e) => {
    const actionType = normalizeTimelineActionType(e.action_type);
    return {
      id: e.id,
      timestamp: e.timestamp,
      actionType,
      actionLabel: getTimelineActionLabelKey(actionType),
      details: e.details || undefined,
    };
  });
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
  if (storageCache && now - storageCache.timestamp < STORAGE_CACHE_TTL) {
    return {
      recordingsSize: storageCache.recordingsSize,
      databaseSize: storageCache.databaseSize,
      uploadsSize: storageCache.uploadsSize,
      totalSize: storageCache.totalSize,
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
    timestamp: now,
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
  // CPU：基于两次采样差值，避免 process.cpuUsage() 的“自进程启动累计值”导致的失真
  const readCpuSample = (): CpuSample => {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
    }
    return { idle, total };
  };

  const sampleNow = readCpuSample();
  const prev = lastCpuSample;
  lastCpuSample = sampleNow;

  const cpuPercent = (() => {
    if (!prev) return 0;
    const idleDelta = sampleNow.idle - prev.idle;
    const totalDelta = sampleNow.total - prev.total;
    if (totalDelta <= 0) return 0;
    const used = 1 - idleDelta / totalDelta;
    return Math.max(0, Math.min(100, Math.round(used * 100)));
  })();

  // Memory：系统内存占用（不是 Node heap）
  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();
  const memPercent =
    memTotal > 0 ? Math.max(0, Math.min(100, Math.round((memUsed / memTotal) * 100))) : 0;

  // Disk：使用 statfs 获取真实文件系统空间（以 data 目录所在分区为准）
  const dataDir = path.resolve(__dirname, '../../data');
  let diskUsed = 0;
  let diskTotal = 0;
  try {
    if (fs.existsSync(dataDir) && typeof (fs as any).statfsSync === 'function') {
      const stat = (fs as any).statfsSync(dataDir);
      diskTotal = stat.blocks * stat.bsize;
      const diskFree = stat.bfree * stat.bsize;
      diskUsed = Math.max(0, diskTotal - diskFree);
    }
  } catch {
    // 忽略错误
  }
  const diskPercent =
    diskTotal > 0 ? Math.max(0, Math.min(100, Math.round((diskUsed / diskTotal) * 100))) : 0;

  return {
    cpuPercent,
    memPercent,
    memUsed,
    memTotal,
    diskPercent,
    diskUsed,
    diskTotal,
    loadAvg: os.loadavg(),
    timestamp: Date.now(),
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
