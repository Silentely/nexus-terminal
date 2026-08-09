/**
 * ai-audit/ai-audit.service 单元测试
 * 覆盖审计报告的创建、查询、删除、异常统计与确认
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockRepository = vi.hoisted(() => ({
  createReport: vi.fn(),
  updateReportStatus: vi.fn(),
  getDataSummary: vi.fn(),
  createAnomalies: vi.fn(),
  updateReportAiAnalysis: vi.fn(),
  updateReportStatusCompleted: vi.fn(),
  getReports: vi.fn(),
  getReportById: vi.fn(),
  getAnomalies: vi.fn(),
  deleteReport: vi.fn(),
  getAnomalyStats: vi.fn(),
  acknowledgeAnomaly: vi.fn(),
}));

vi.mock('./ai-audit.repository', () => ({
  AiAuditRepository: class {
    constructor() {
      return mockRepository;
    }
  },
}));

vi.mock('./rules/anomaly-rules', () => ({
  runDetectionRules: vi.fn().mockResolvedValue([]),
}));

vi.mock('./prompts/audit-prompts', () => ({
  getPromptBuilder: vi.fn().mockReturnValue({ build: vi.fn().mockReturnValue('prompt') }),
}));

vi.mock('../ai-ops/nl2cmd.service', () => ({
  getAISettings: vi.fn().mockResolvedValue(null),
}));

vi.mock('../utils/ssrf-guard', () => ({
  safeHttpPost: vi.fn().mockResolvedValue({ success: true, analysis: 'ok' }),
}));

import { AiAuditService } from './ai-audit.service';

describe('AiAuditService', () => {
  let service: AiAuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AiAuditService();
  });

  describe('createReport', () => {
    it('应创建报告并返回 pending 状态', async () => {
      mockRepository.createReport.mockResolvedValue(42);
      const result = await service.createReport(1, {
        reportType: 'full',
        timeRangeStart: 1000,
        timeRangeEnd: 2000,
      });

      expect(mockRepository.createReport).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, reportType: 'full' }),
      );
      expect(result).toEqual({
        success: true,
        report: { id: 42, status: 'pending', reportType: 'full' },
      });
    });
  });

  describe('查询类方法（薄委托）', () => {
    it('getReports 应委托 repository', async () => {
      mockRepository.getReports.mockResolvedValue([]);
      const result = await service.getReports(1, { page: 1, pageSize: 20 });

      expect(mockRepository.getReports).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, page: 1, pageSize: 20 }),
      );
      expect(result).toEqual([]);
    });

    it('getReportById 应委托 repository', async () => {
      mockRepository.getReportById.mockResolvedValue({ id: 1 });
      expect(await service.getReportById(1)).toEqual({ id: 1 });
      expect(mockRepository.getReportById).toHaveBeenCalledWith(1);
    });

    it('getAnomalies 应委托 repository', async () => {
      mockRepository.getAnomalies.mockResolvedValue([]);
      await service.getAnomalies({ page: 1, pageSize: 10, severity: 'high' });

      expect(mockRepository.getAnomalies).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, pageSize: 10, severity: 'high' }),
      );
    });
  });

  describe('deleteReport', () => {
    it('应委托 repository 并返回布尔', async () => {
      mockRepository.deleteReport.mockResolvedValue(true);
      expect(await service.deleteReport(7, 1)).toBe(true);
      expect(mockRepository.deleteReport).toHaveBeenCalledWith(7, 1);
    });
  });

  describe('getAnomalyStats', () => {
    it('应归一化统计结果', async () => {
      mockRepository.getAnomalyStats.mockResolvedValue({
        total: 5,
        bySeverity: { high: 3, low: 2 },
        recentCount: 1,
      });
      const stats = await service.getAnomalyStats(1);

      expect(stats.total).toBe(5);
      expect(stats.bySeverity).toEqual({ high: 3, low: 2 });
      expect(stats.recentCount).toBe(1);
      expect(mockRepository.getAnomalyStats).toHaveBeenCalledWith(1);
    });
  });

  describe('acknowledgeAnomaly', () => {
    it('应委托 repository', async () => {
      await service.acknowledgeAnomaly(99);
      expect(mockRepository.acknowledgeAnomaly).toHaveBeenCalledWith(99);
    });
  });
});
