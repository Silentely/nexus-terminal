/**
 * Metrics Controller 单元测试
 * 测试 Prometheus 指标端点的请求处理与错误恢复
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

import { getMetrics } from './metrics.controller';

// --- Mock 依赖 ---

// 使用 vi.hoisted 确保 mock 函数在 vi.mock 提升时可用
const { mockMetrics, mockLoggerError } = vi.hoisted(() => ({
  mockMetrics: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('./metrics.service', () => ({
  registry: {
    contentType: 'text/plain; version=0.0.4',
    metrics: mockMetrics,
  },
}));

vi.mock('../utils/logger', () => ({
  logger: {
    error: mockLoggerError,
  },
}));

// 辅助函数：创建 mock Request 和 Response 对象
function createMockReq() {
  return {} as Request;
}

function createMockRes() {
  const res = {
    setHeader: vi.fn(),
    end: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('MetricsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMetrics', () => {
    it('应该在成功时设置 Content-Type 并返回指标数据', async () => {
      const metricsData =
        '# HELP http_request_duration HTTP 请求延迟\n# TYPE http_request_duration histogram\n';
      mockMetrics.mockResolvedValue(metricsData);

      const req = createMockReq();
      const res = createMockRes();

      await getMetrics(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4');
      expect(res.end).toHaveBeenCalledWith(metricsData);
    });

    it('应该在 registry.metrics() 抛出异常时返回 500 错误', async () => {
      mockMetrics.mockRejectedValue(new Error('指标采集异常'));

      const req = createMockReq();
      const res = createMockRes();

      await getMetrics(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.end).toHaveBeenCalledWith('指标采集失败');
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.stringContaining('[Metrics] 生成指标数据失败'),
      );
    });

    it('应该使用 registry.contentType 作为 Content-Type 值', async () => {
      mockMetrics.mockResolvedValue('metrics-data');

      const req = createMockReq();
      const res = createMockRes();

      await getMetrics(req, res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        expect.stringContaining('text/plain'),
      );
    });
  });
});
