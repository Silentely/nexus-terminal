/**
 * 异常检测规则引擎
 * 基于预定义规则检测安全异常
 */

import { logger } from '../../utils/logger';
import type { DetectionRule, RuleDetectionResult } from '../ai-audit.types';

// 检测规则定义
export const DETECTION_RULES: DetectionRule[] = [
  {
    id: 'brute_force_login',
    name: '暴力破解登录',
    description: '同 IP 多次登录失败',
    severity: 'critical',
    enabled: true,
  },
  {
    id: 'unusual_hours',
    name: '非工作时间访问',
    description: '在非常规时间（0:00-5:00）的活动',
    severity: 'medium',
    enabled: true,
  },
  {
    id: 'command_frequency_spike',
    name: '命令频率异常',
    description: '命令执行频率超过均值 3 倍',
    severity: 'high',
    enabled: true,
  },
  {
    id: 'dangerous_commands',
    name: '危险命令检测',
    description: '检测到危险命令（rm -rf, dd, mkfs 等）',
    severity: 'critical',
    enabled: true,
  },
  {
    id: 'privilege_escalation',
    name: '权限提升模式',
    description: '频繁使用 sudo/su',
    severity: 'high',
    enabled: true,
  },
  {
    id: 'connection_churn',
    name: '连接频繁切换',
    description: '快速连接/断开循环',
    severity: 'medium',
    enabled: true,
  },
  {
    id: 'failed_connection_cluster',
    name: '连接失败聚集',
    description: '短时间内多次连接失败',
    severity: 'high',
    enabled: true,
  },
  {
    id: 'large_file_transfer',
    name: '大文件传输',
    description: '单次传输超过 100MB',
    severity: 'medium',
    enabled: true,
  },
  {
    id: 'session_duration_anomaly',
    name: '会话时长异常',
    description: '会话时长显著偏离平均值',
    severity: 'low',
    enabled: true,
  },
  {
    id: 'new_connection_first_use',
    name: '首次连接',
    description: '首次连接到某服务器',
    severity: 'info',
    enabled: true,
  },
];

// 危险命令模式
const DANGEROUS_COMMAND_PATTERNS = [
  /rm\s+-rf\s+\//, // rm -rf /
  /mkfs\./, // 格式化文件系统
  /dd\s+if=/, // dd 命令
  />\s*\/dev\/sd/, // 写入磁盘设备
  /chmod\s+777/, // 权限过于宽松
  /:\(\)\{.*\|.*&\}/, // Fork Bomb
  /curl.*\|\s*sh/, // 管道执行脚本
  /wget.*\|\s*bash/, // 管道执行脚本
];

// 权限提升命令模式
const PRIVILEGE_ESCALATION_PATTERNS = [
  /\bsudo\b/,
  /\bsu\s+-/,
  /\bsu\s+root/,
  /visudo/,
  /chmod\s+[0-7]*7[0-7]*\s+\/etc\//,
];

/**
 * 检测暴力破解登录
 */
function detectBruteForceLogin(
  loginEvents: Array<{ ip: string; success: boolean; timestamp: number }>,
  timeRangeStart: number,
  timeRangeEnd: number,
): RuleDetectionResult {
  const anomalies: RuleDetectionResult['anomalies'] = [];
  const oneHour = 3600; // 1 小时秒数（与数据库时间戳单位一致）

  // 按 IP 分组失败登录
  const failuresByIp = new Map<string, number[]>();
  for (const event of loginEvents) {
    if (!event.success && event.timestamp >= timeRangeStart && event.timestamp <= timeRangeEnd) {
      const timestamps = failuresByIp.get(event.ip) || [];
      timestamps.push(event.timestamp);
      failuresByIp.set(event.ip, timestamps);
    }
  }

  // 检测 1 小时内 >= 5 次失败
  for (const [ip, timestamps] of failuresByIp) {
    // 滑动窗口检测
    for (let i = 0; i < timestamps.length; i++) {
      const windowStart = timestamps[i];
      const windowEnd = windowStart + oneHour;
      const countInWindow = timestamps.filter((t) => t >= windowStart && t < windowEnd).length;

      if (countInWindow >= 5) {
        anomalies.push({
          rule_id: 'brute_force_login',
          severity: 'critical',
          title: `暴力破解检测: ${ip}`,
          description: `IP ${ip} 在 1 小时内尝试登录 ${countInWindow} 次`,
          evidence_json: JSON.stringify({
            ip,
            count: countInWindow,
            timestamps: timestamps.slice(0, 10),
          }),
        });
        break; // 每个 IP 只报告一次
      }
    }
  }

  return {
    ruleId: 'brute_force_login',
    detected: anomalies.length > 0,
    anomalies,
  };
}

/**
 * 检测危险命令
 */
function detectDangerousCommands(
  commands: Array<{ command: string; timestamp: number }>,
): RuleDetectionResult {
  const anomalies: RuleDetectionResult['anomalies'] = [];

  for (const { command, timestamp } of commands) {
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        anomalies.push({
          rule_id: 'dangerous_commands',
          severity: 'critical',
          title: `危险命令检测`,
          description: `检测到危险命令: ${command.substring(0, 100)}`,
          evidence_json: JSON.stringify({ command, timestamp }),
        });
        break; // 每个命令只报告一次
      }
    }
  }

  return {
    ruleId: 'dangerous_commands',
    detected: anomalies.length > 0,
    anomalies,
  };
}

/**
 * 检测非工作时间访问
 */
function detectUnusualHours(
  events: Array<{ timestamp: number }>,
  timeRangeStart: number,
  timeRangeEnd: number,
): RuleDetectionResult {
  const anomalies: RuleDetectionResult['anomalies'] = [];
  const suspiciousHours = [0, 1, 2, 3, 4]; // 0:00-4:59

  const suspiciousEvents = events.filter((e) => {
    if (e.timestamp < timeRangeStart || e.timestamp > timeRangeEnd) return false;
    // 使用 UTC 小时，避免服务器时区差异导致误报
    const date = new Date(e.timestamp * 1000);
    const hour = date.getUTCHours();
    return suspiciousHours.includes(hour);
  });

  if (suspiciousEvents.length > 0) {
    anomalies.push({
      rule_id: 'unusual_hours',
      severity: 'medium',
      title: `非工作时间访问`,
      description: `检测到 ${suspiciousEvents.length} 次在 0:00-5:00 时段的活动`,
      evidence_json: JSON.stringify({
        count: suspiciousEvents.length,
        timestamps: suspiciousEvents.slice(0, 5).map((e) => e.timestamp),
      }),
    });
  }

  return {
    ruleId: 'unusual_hours',
    detected: anomalies.length > 0,
    anomalies,
  };
}

/**
 * 检测权限提升模式
 */
function detectPrivilegeEscalation(
  commands: Array<{ command: string; timestamp: number }>,
): RuleDetectionResult {
  const anomalies: RuleDetectionResult['anomalies'] = [];
  const tenMinutes = 600; // 10 分钟秒数（与数据库时间戳单位一致）

  // 找出所有权限提升命令
  const escalationCommands = commands.filter(({ command }) =>
    PRIVILEGE_ESCALATION_PATTERNS.some((p) => p.test(command)),
  );

  // 检测 10 分钟内 >= 3 次
  for (let i = 0; i < escalationCommands.length; i++) {
    const windowStart = escalationCommands[i].timestamp;
    const windowEnd = windowStart + tenMinutes;
    const countInWindow = escalationCommands.filter(
      (c) => c.timestamp >= windowStart && c.timestamp < windowEnd,
    ).length;

    if (countInWindow >= 3) {
      anomalies.push({
        rule_id: 'privilege_escalation',
        severity: 'high',
        title: `频繁权限提升`,
        description: `10 分钟内检测到 ${countInWindow} 次 sudo/su 操作`,
        evidence_json: JSON.stringify({ count: countInWindow, timestamp: windowStart }),
      });
      break;
    }
  }

  return {
    ruleId: 'privilege_escalation',
    detected: anomalies.length > 0,
    anomalies,
  };
}

/**
 * 检测命令频率异常
 */
function detectCommandFrequencySpike(
  commands: Array<{ command: string; timestamp: number }>,
  timeRangeStart: number,
  timeRangeEnd: number,
): RuleDetectionResult {
  const anomalies: RuleDetectionResult['anomalies'] = [];
  const fiveMinutes = 300; // 5 分钟秒数

  // 按 5 分钟窗口统计命令频率
  const windowCounts = new Map<number, number>();
  for (const cmd of commands) {
    if (cmd.timestamp >= timeRangeStart && cmd.timestamp <= timeRangeEnd) {
      const windowStart = Math.floor(cmd.timestamp / fiveMinutes) * fiveMinutes;
      windowCounts.set(windowStart, (windowCounts.get(windowStart) || 0) + 1);
    }
  }

  // 计算平均值
  const counts = Array.from(windowCounts.values());
  if (counts.length < 2) {
    return { ruleId: 'command_frequency_spike', detected: false, anomalies: [] };
  }
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;

  // 检测超过 3 倍均值的窗口
  for (const [windowStart, count] of windowCounts) {
    if (count > avg * 3 && count >= 10) {
      anomalies.push({
        rule_id: 'command_frequency_spike',
        severity: 'high',
        title: '命令频率异常',
        description: `5 分钟内执行 ${count} 条命令，超过均值 ${Math.round(avg)} 的 3 倍`,
        evidence_json: JSON.stringify({ windowStart, count, avg: Math.round(avg) }),
      });
      break; // 只报告一次
    }
  }

  return {
    ruleId: 'command_frequency_spike',
    detected: anomalies.length > 0,
    anomalies,
  };
}

/**
 * 检测连接频繁切换
 */
function detectConnectionChurn(
  connectionEvents: Array<{ type: string; timestamp: number }>,
  timeRangeStart: number,
  timeRangeEnd: number,
): RuleDetectionResult {
  const anomalies: RuleDetectionResult['anomalies'] = [];
  const fiveMinutes = 300; // 5 分钟秒数

  // 统计 5 分钟窗口内的连接事件数
  const connectEvents = connectionEvents.filter(
    (e) => e.timestamp >= timeRangeStart && e.timestamp <= timeRangeEnd,
  );

  const windowCounts = new Map<number, number>();
  for (const event of connectEvents) {
    const windowStart = Math.floor(event.timestamp / fiveMinutes) * fiveMinutes;
    windowCounts.set(windowStart, (windowCounts.get(windowStart) || 0) + 1);
  }

  // 检测频繁连接/断开
  for (const [windowStart, count] of windowCounts) {
    if (count >= 5) {
      anomalies.push({
        rule_id: 'connection_churn',
        severity: 'medium',
        title: '连接频繁切换',
        description: `5 分钟内发生 ${count} 次连接事件`,
        evidence_json: JSON.stringify({ windowStart, count }),
      });
      break;
    }
  }

  return {
    ruleId: 'connection_churn',
    detected: anomalies.length > 0,
    anomalies,
  };
}

/**
 * 检测连接失败聚集
 */
function detectFailedConnectionCluster(
  connectionEvents: Array<{ type: string; timestamp: number }>,
  timeRangeStart: number,
  timeRangeEnd: number,
): RuleDetectionResult {
  const anomalies: RuleDetectionResult['anomalies'] = [];
  const oneHour = 3600; // 1 小时秒数

  // 筛选连接失败事件
  const failedEvents = connectionEvents.filter(
    (e) =>
      e.type === 'SSH_CONNECT_FAILURE' &&
      e.timestamp >= timeRangeStart &&
      e.timestamp <= timeRangeEnd,
  );

  // 按小时窗口统计
  const windowCounts = new Map<number, number>();
  for (const event of failedEvents) {
    const windowStart = Math.floor(event.timestamp / oneHour) * oneHour;
    windowCounts.set(windowStart, (windowCounts.get(windowStart) || 0) + 1);
  }

  // 检测 1 小时内 >= 3 次失败
  for (const [windowStart, count] of windowCounts) {
    if (count >= 3) {
      anomalies.push({
        rule_id: 'failed_connection_cluster',
        severity: 'high',
        title: '连接失败聚集',
        description: `1 小时内发生 ${count} 次连接失败`,
        evidence_json: JSON.stringify({ windowStart, count }),
      });
      break;
    }
  }

  return {
    ruleId: 'failed_connection_cluster',
    detected: anomalies.length > 0,
    anomalies,
  };
}

/**
 * 检测首次连接（按 IP 去重，只报告首次出现的来源）
 */
function detectNewConnectionFirstUse(
  loginEvents: Array<{ ip: string; success: boolean; timestamp: number }>,
  timeRangeStart: number,
  timeRangeEnd: number,
): RuleDetectionResult {
  const anomalies: RuleDetectionResult['anomalies'] = [];

  // 只看成功的登录事件
  const successfulLogins = loginEvents.filter(
    (e) => e.success && e.timestamp >= timeRangeStart && e.timestamp <= timeRangeEnd,
  );

  if (successfulLogins.length === 0) {
    return { ruleId: 'new_connection_first_use', detected: false, anomalies: [] };
  }

  // 按 IP 去重，只保留每个 IP 的首次出现
  const firstSeenByIp = new Map<string, number>();
  for (const event of successfulLogins) {
    if (!firstSeenByIp.has(event.ip)) {
      firstSeenByIp.set(event.ip, event.timestamp);
    }
  }

  // 只报告首次出现的 IP（简化实现：每个 IP 首次出现即为"新连接"）
  if (firstSeenByIp.size > 0) {
    const ipList = Array.from(firstSeenByIp.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([ip]) => ip);

    anomalies.push({
      rule_id: 'new_connection_first_use',
      severity: 'info',
      title: '新来源连接',
      description: `检测到 ${ipList.length} 个不同来源的连接：${ipList.join(', ')}`,
      evidence_json: JSON.stringify({
        uniqueIps: ipList.length,
        ips: ipList,
        totalLogins: successfulLogins.length,
      }),
    });
  }

  return {
    ruleId: 'new_connection_first_use',
    detected: anomalies.length > 0,
    anomalies,
  };
}

/**
 * 运行所有启用的规则检测
 */
export async function runDetectionRules(data: {
  loginEvents: Array<{ ip: string; success: boolean; timestamp: number }>;
  commands: Array<{ command: string; timestamp: number }>;
  connectionEvents: Array<{ type: string; timestamp: number }>;
  timeRangeStart: number;
  timeRangeEnd: number;
}): Promise<RuleDetectionResult[]> {
  const results: RuleDetectionResult[] = [];

  // 过滤启用的规则
  const enabledRules = DETECTION_RULES.filter((r) => r.enabled);

  for (const rule of enabledRules) {
    try {
      let result: RuleDetectionResult;

      switch (rule.id) {
        case 'brute_force_login':
          result = detectBruteForceLogin(data.loginEvents, data.timeRangeStart, data.timeRangeEnd);
          break;
        case 'dangerous_commands':
          result = detectDangerousCommands(data.commands);
          break;
        case 'unusual_hours':
          result = detectUnusualHours(
            [...data.loginEvents, ...data.connectionEvents],
            data.timeRangeStart,
            data.timeRangeEnd,
          );
          break;
        case 'privilege_escalation':
          result = detectPrivilegeEscalation(data.commands);
          break;
        case 'command_frequency_spike':
          result = detectCommandFrequencySpike(
            data.commands,
            data.timeRangeStart,
            data.timeRangeEnd,
          );
          break;
        case 'connection_churn':
          result = detectConnectionChurn(
            data.connectionEvents,
            data.timeRangeStart,
            data.timeRangeEnd,
          );
          break;
        case 'failed_connection_cluster':
          result = detectFailedConnectionCluster(
            data.connectionEvents,
            data.timeRangeStart,
            data.timeRangeEnd,
          );
          break;
        case 'new_connection_first_use':
          result = detectNewConnectionFirstUse(
            data.loginEvents,
            data.timeRangeStart,
            data.timeRangeEnd,
          );
          break;
        default:
          result = { ruleId: rule.id, detected: false, anomalies: [] };
      }

      results.push(result);
    } catch (err) {
      logger.error({ ruleId: rule.id, error: err }, '规则检测失败');
    }
  }

  return results;
}

/**
 * 获取所有检测规则
 */
export function getDetectionRules(): DetectionRule[] {
  return DETECTION_RULES;
}
