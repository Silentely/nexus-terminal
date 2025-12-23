/**
 * AI Types 单元测试
 */
import { describe, it, expect } from 'vitest';
import type {
  AIMessageRole,
  AIMessage,
  AISession,
  AIQueryRequest,
  AIQueryResponse,
  AIInsightType,
  AIInsightSeverity,
  AIInsight,
  SystemHealthSummary,
  CommandPatternAnalysis,
} from './ai.types';

describe('AI Types', () => {
  describe('AIMessageRole', () => {
    it('应定义所有有效的消息角色', () => {
      const validRoles: AIMessageRole[] = ['user', 'assistant', 'system'];
      expect(validRoles.length).toBe(3);
    });
  });

  describe('AIMessage', () => {
    it('应正确创建消息对象', () => {
      const message: AIMessage = {
        id: 'msg-001',
        sessionId: 'session-001',
        role: 'user',
        content: 'What is the system health?',
        timestamp: new Date(),
      };
      expect(message.id).toBe('msg-001');
      expect(message.role).toBe('user');
      expect(message.timestamp).toBeInstanceOf(Date);
    });

    it('应支持可选的 metadata', () => {
      const message: AIMessage = {
        id: 'msg-002',
        sessionId: 'session-001',
        role: 'assistant',
        content: 'System is healthy',
        timestamp: new Date(),
        metadata: { confidence: 0.95, source: 'audit_logs' },
      };
      expect(message.metadata?.confidence).toBe(0.95);
    });
  });

  describe('AISession', () => {
    it('应正确创建会话对象', () => {
      const session: AISession = {
        sessionId: 'session-001',
        userId: 1,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(session.sessionId).toBe('session-001');
      expect(session.messages).toHaveLength(0);
    });

    it('应支持可选的标题', () => {
      const session: AISession = {
        sessionId: 'session-002',
        userId: 1,
        title: 'Security Analysis',
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(session.title).toBe('Security Analysis');
    });
  });

  describe('AIQueryRequest', () => {
    it('应正确创建查询请求', () => {
      const request: AIQueryRequest = {
        query: 'Show me recent security events',
      };
      expect(request.query).toBeDefined();
      expect(request.sessionId).toBeUndefined();
    });

    it('应支持上下文参数', () => {
      const request: AIQueryRequest = {
        query: 'Analyze connection patterns',
        sessionId: 'session-001',
        context: {
          connectionIds: [1, 2, 3],
          timeRange: {
            start: new Date('2025-01-01'),
            end: new Date('2025-01-31'),
          },
        },
      };
      expect(request.context?.connectionIds).toHaveLength(3);
      expect(request.context?.timeRange?.start).toBeInstanceOf(Date);
    });
  });

  describe('AIInsightType', () => {
    it('应定义所有有效的洞察类型', () => {
      const validTypes: AIInsightType[] = [
        'security_alert',
        'performance_warning',
        'pattern_detected',
        'anomaly_detected',
        'recommendation',
        'summary',
      ];
      expect(validTypes.length).toBe(6);
    });
  });

  describe('AIInsightSeverity', () => {
    it('应定义所有有效的严重程度', () => {
      const validSeverities: AIInsightSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
      expect(validSeverities.length).toBe(5);
    });
  });

  describe('AIInsight', () => {
    it('应正确创建洞察对象', () => {
      const insight: AIInsight = {
        type: 'security_alert',
        severity: 'high',
        title: 'Multiple Failed Login Attempts',
        description: 'Detected 10 failed login attempts in the last hour',
        timestamp: new Date(),
      };
      expect(insight.type).toBe('security_alert');
      expect(insight.severity).toBe('high');
    });

    it('应支持可操作建议', () => {
      const insight: AIInsight = {
        type: 'recommendation',
        severity: 'medium',
        title: 'Consider IP Blocking',
        description: 'IP 192.168.1.100 has suspicious activity',
        actionable: true,
        suggestedAction: 'Add IP to blacklist',
        data: { ip: '192.168.1.100', attempts: 15 },
        timestamp: new Date(),
      };
      expect(insight.actionable).toBe(true);
      expect(insight.suggestedAction).toBeDefined();
      expect(insight.data?.ip).toBe('192.168.1.100');
    });
  });

  describe('SystemHealthSummary', () => {
    it('应正确创建健康摘要', () => {
      const summary: SystemHealthSummary = {
        overallStatus: 'healthy',
        activeConnections: 5,
        failedLoginAttempts24h: 2,
        sshFailures24h: 0,
        commandsExecuted24h: 150,
        topConnections: [{ connectionId: 1, name: 'prod-server', commandCount: 50 }],
        recentAlerts: [],
      };
      expect(summary.overallStatus).toBe('healthy');
      expect(summary.activeConnections).toBe(5);
      expect(summary.topConnections).toHaveLength(1);
    });

    it('应正确表示警告状态', () => {
      const summary: SystemHealthSummary = {
        overallStatus: 'warning',
        activeConnections: 10,
        failedLoginAttempts24h: 20,
        sshFailures24h: 5,
        commandsExecuted24h: 500,
        topConnections: [],
        recentAlerts: [
          {
            type: 'security_alert',
            severity: 'high',
            title: 'High Failed Logins',
            description: 'Too many failed login attempts',
            timestamp: new Date(),
          },
        ],
      };
      expect(summary.overallStatus).toBe('warning');
      expect(summary.recentAlerts).toHaveLength(1);
    });
  });

  describe('CommandPatternAnalysis', () => {
    it('应正确创建命令模式分析结果', () => {
      const analysis: CommandPatternAnalysis = {
        totalCommands: 100,
        topCommands: [
          { command: 'ls', count: 30, percentage: 30 },
          { command: 'cd', count: 20, percentage: 20 },
          { command: 'cat', count: 15, percentage: 15 },
        ],
      };
      expect(analysis.totalCommands).toBe(100);
      expect(analysis.topCommands).toHaveLength(3);
      expect(analysis.topCommands[0].percentage).toBe(30);
    });

    it('应支持异常命令和时间分布', () => {
      const analysis: CommandPatternAnalysis = {
        totalCommands: 200,
        topCommands: [],
        unusualCommands: ['rm -rf /', 'chmod 777'],
        timeDistribution: {
          '00:00-06:00': 10,
          '06:00-12:00': 80,
          '12:00-18:00': 90,
          '18:00-24:00': 20,
        },
      };
      expect(analysis.unusualCommands).toHaveLength(2);
      expect(analysis.timeDistribution?.['06:00-12:00']).toBe(80);
    });
  });

  describe('AIQueryResponse', () => {
    it('应正确创建查询响应', () => {
      const response: AIQueryResponse = {
        success: true,
        sessionId: 'session-001',
        message: {
          id: 'msg-001',
          sessionId: 'session-001',
          role: 'assistant',
          content: 'Analysis complete',
          timestamp: new Date(),
        },
      };
      expect(response.success).toBe(true);
      expect(response.message.role).toBe('assistant');
    });

    it('应支持洞察和建议', () => {
      const response: AIQueryResponse = {
        success: true,
        sessionId: 'session-001',
        message: {
          id: 'msg-002',
          sessionId: 'session-001',
          role: 'assistant',
          content: 'Found security issues',
          timestamp: new Date(),
        },
        insights: [
          {
            type: 'security_alert',
            severity: 'high',
            title: 'Security Alert',
            description: 'Suspicious activity detected',
            timestamp: new Date(),
          },
        ],
        suggestions: ['Review access logs', 'Update firewall rules'],
      };
      expect(response.insights).toHaveLength(1);
      expect(response.suggestions).toHaveLength(2);
    });
  });
});
