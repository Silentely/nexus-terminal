/**
 * ai-audit/rules/anomaly-rules 单元测试
 * 覆盖 AI 审计规则引擎的暴力破解、危险命令、提权、异常时段等检测
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runDetectionRules, getDetectionRules } from './anomaly-rules';

const T0 = 1_700_000_000; // 基准时间戳（秒）

function baseData(overrides: Record<string, unknown> = {}) {
  return {
    loginEvents: [],
    commands: [],
    connectionEvents: [],
    timeRangeStart: T0 - 3600,
    timeRangeEnd: T0 + 3600,
    ...overrides,
  };
}

describe('anomaly-rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getDetectionRules 应返回全部规则', () => {
    const rules = getDetectionRules();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    const ids = rules.map((r) => r.id);
    expect(ids).toContain('brute_force_login');
    expect(ids).toContain('dangerous_commands');
    expect(ids).toContain('privilege_escalation');
  });

  it('暴力破解：1 小时内 5 次失败应触发', async () => {
    const loginEvents = Array.from({ length: 5 }, (_, i) => ({
      ip: '1.2.3.4',
      success: false,
      timestamp: T0 + i * 60, // 5 分钟内 5 次
    }));
    const results = await runDetectionRules(baseData({ loginEvents }));

    const brute = results.find((r) => r.ruleId === 'brute_force_login');
    expect(brute?.detected).toBe(true);
    expect(brute?.anomalies[0].severity).toBe('critical');
  });

  it('暴力破解：少于 5 次失败不应触发', async () => {
    const loginEvents = Array.from({ length: 4 }, (_, i) => ({
      ip: '1.2.3.4',
      success: false,
      timestamp: T0 + i * 60,
    }));
    const results = await runDetectionRules(baseData({ loginEvents }));

    const brute = results.find((r) => r.ruleId === 'brute_force_login');
    expect(brute?.detected).toBe(false);
  });

  it('暴力破解：成功登录不应计入失败窗口', async () => {
    const loginEvents = [
      ...Array.from({ length: 5 }, (_, i) => ({
        ip: '1.2.3.4',
        success: false,
        timestamp: T0 + i * 60,
      })),
      { ip: '1.2.3.4', success: true, timestamp: T0 + 300 },
    ];
    const results = await runDetectionRules(baseData({ loginEvents }));
    expect(results.find((r) => r.ruleId === 'brute_force_login')?.detected).toBe(true);
  });

  it('危险命令：rm -rf 应触发', async () => {
    const commands = [{ command: 'rm -rf /var/lib', timestamp: T0 }];
    const results = await runDetectionRules(baseData({ commands }));

    const danger = results.find((r) => r.ruleId === 'dangerous_commands');
    expect(danger?.detected).toBe(true);
  });

  it('危险命令：普通命令不应触发', async () => {
    const commands = [{ command: 'ls -la', timestamp: T0 }];
    const results = await runDetectionRules(baseData({ commands }));

    expect(results.find((r) => r.ruleId === 'dangerous_commands')?.detected).toBe(false);
  });

  it('提权：10 分钟内 3 次 sudo 应触发', async () => {
    const commands = [
      { command: 'sudo systemctl restart nginx', timestamp: T0 },
      { command: 'sudo su -', timestamp: T0 + 120 },
      { command: 'sudo visudo', timestamp: T0 + 300 },
    ];
    const results = await runDetectionRules(baseData({ commands }));

    expect(results.find((r) => r.ruleId === 'privilege_escalation')?.detected).toBe(true);
  });

  it('提权：少于 3 次 sudo 不应触发', async () => {
    const commands = [
      { command: 'sudo ls', timestamp: T0 },
      { command: 'su -', timestamp: T0 + 60 },
    ];
    const results = await runDetectionRules(baseData({ commands }));

    expect(results.find((r) => r.ruleId === 'privilege_escalation')?.detected).toBe(false);
  });

  it('异常时段：深夜登录应触发', async () => {
    // 凌晨 3 点 = 基准时间戳偏移到 03:00
    const midNight = T0 - (T0 % 86400) + 3 * 3600;
    const loginEvents = [{ ip: '5.6.7.8', success: true, timestamp: midNight }];
    const results = await runDetectionRules({
      ...baseData(),
      loginEvents,
      timeRangeStart: midNight - 3600,
      timeRangeEnd: midNight + 3600,
    });

    expect(results.find((r) => r.ruleId === 'unusual_hours')?.detected).toBe(true);
  });

  it('空数据不应触发任何规则', async () => {
    const results = await runDetectionRules(baseData());
    // 所有规则 detected 均为 false（无异常数据）
    results.forEach((r) => {
      expect(r.detected).toBe(false);
    });
  });
});
