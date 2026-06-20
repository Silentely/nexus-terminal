/**
 * 审计分析 Prompt 模板
 * 用于 AI 分析审计数据
 */

import type { AuditDataSummary, ReportType } from '../ai-audit.types';

/**
 * 构建命令分析 Prompt
 */
export function buildCommandAnalysisPrompt(summary: AuditDataSummary): string {
  const topCommands = summary.topCommands
    .slice(0, 10)
    .map((c) => `  - ${c.command}: ${c.count} 次`)
    .join('\n');

  return `你是一名资深安全审计专家，专注于终端命令行为分析。

请分析以下命令执行历史数据，识别潜在的安全风险和异常模式：

时间范围: ${new Date(summary.timeRange.start * 1000).toLocaleString()} - ${new Date(summary.timeRange.end * 1000).toLocaleString()}
总命令数: ${summary.totalCommands}
总连接数: ${summary.totalConnections}

热门命令 (Top 10):
${topCommands || '  无数据'}

请提供:
1. 安全风险评估 (1-10分，10分为最安全)
2. 检测到的异常模式列表（如有）
3. 改进建议

以 JSON 格式返回:
{
  "riskScore": <number>,
  "anomalies": [{"title": "...", "description": "...", "severity": "high|medium|low"}],
  "recommendations": ["建议1", "建议2"]
}`;
}

/**
 * 构建登录分析 Prompt
 */
export function buildLoginAnalysisPrompt(summary: AuditDataSummary): string {
  const loginByHourStr = Object.entries(summary.loginByHour)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([hour, count]) => `  ${hour}:00 - ${count} 次`)
    .join('\n');

  return `你是一名网络安全分析师，专注于认证行为分析。

请分析以下登录/认证事件数据：

时间范围: ${new Date(summary.timeRange.start * 1000).toLocaleString()} - ${new Date(summary.timeRange.end * 1000).toLocaleString()}
总登录次数: ${summary.totalLogins}
失败登录: ${summary.failedLogins}
唯一 IP 数: ${summary.uniqueIps}

登录时间分布:
${loginByHourStr || '  无数据'}

请评估:
1. 安全威胁等级 (1-10分，10分为最安全)
2. 可疑 IP 分析（如有）
3. 认证策略建议

以 JSON 格式返回:
{
  "riskScore": <number>,
  "anomalies": [{"title": "...", "description": "...", "severity": "high|medium|low"}],
  "recommendations": ["建议1", "建议2"]
}`;
}

/**
 * 构建全量审计 Prompt
 */
export function buildFullAuditPrompt(
  commandSummary: AuditDataSummary,
  loginSummary: AuditDataSummary,
): string {
  return `你是一名高级安全审计师，负责对远程终端访问进行全面安全审计。

请综合分析以下数据，生成完整的安全审计报告：

## 命令执行数据
时间范围: ${new Date(commandSummary.timeRange.start * 1000).toLocaleString()} - ${new Date(commandSummary.timeRange.end * 1000).toLocaleString()}
总命令数: ${commandSummary.totalCommands}
热门命令: ${
    commandSummary.topCommands
      .slice(0, 5)
      .map((c) => c.command)
      .join(', ') || '无'
  }

## 登录认证数据
总登录次数: ${loginSummary.totalLogins}
失败登录: ${loginSummary.failedLogins}
唯一 IP 数: ${loginSummary.uniqueIps}

请生成:
1. 整体安全评分 (0-100)
2. 关键发现 (按严重程度排序)
3. 风险缓解建议
4. 合规性检查结果

以 JSON 格式返回:
{
  "overallScore": <number>,
  "keyFindings": [{"title": "...", "description": "...", "severity": "critical|high|medium|low"}],
  "recommendations": ["建议1", "建议2"],
  "complianceChecks": [{"item": "...", "status": "pass|fail|warning"}]
}`;
}

/**
 * 获取 Prompt 构建函数
 */
export function getPromptBuilder(
  reportType: ReportType,
): (summary: AuditDataSummary, loginSummary?: AuditDataSummary) => string {
  switch (reportType) {
    case 'command_analysis':
      return buildCommandAnalysisPrompt;
    case 'login_analysis':
      return buildLoginAnalysisPrompt;
    case 'full_audit':
      return (summary, loginSummary) => buildFullAuditPrompt(summary, loginSummary || summary);
    default:
      return buildCommandAnalysisPrompt;
  }
}
