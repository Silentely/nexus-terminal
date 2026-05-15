/**
 * processInWorker / destroyWorkerPool 单元测试
 *
 * 测试 output-processor.ts 中新增的 Worker 线程处理逻辑：
 * - 小文本（≤100 字符）直接同步处理，不走 Worker
 * - 大文本通过 Worker 池处理
 * - Worker 不可用时降级到同步处理
 * - destroyWorkerPool 清理 Worker 池
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ======== Mock createWorkerPool ========

const mockExecute = vi.fn();
const mockDestroy = vi.fn();
const mockWorkerPool = {
  execute: mockExecute,
  destroy: mockDestroy,
  size: 1,
  hasIdle: true,
};

const mockCreateWorkerPool = vi.fn().mockReturnValue(mockWorkerPool);

vi.mock('../../workers/createWorkerPool', () => ({
  createWorkerPool: mockCreateWorkerPool,
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('processInWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockReset();
    mockDestroy.mockReset();
    mockCreateWorkerPool.mockReturnValue(mockWorkerPool);
  });

  afterEach(async () => {
    // 每次测试后销毁模块缓存，重置 workerPool 模块级变量
    vi.resetModules();
  });

  describe('小数据包（≤ 100 字符）直接同步处理', () => {
    it('≤100 字符的文本应直接同步处理，不创建 Worker 池', async () => {
      const { processInWorker } = await import('../output-processor');

      const shortText = 'Hello World'; // 11 chars
      const result = await processInWorker(shortText);

      expect(mockCreateWorkerPool).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.type).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('恰好 100 字符应直接同步处理', async () => {
      const { processInWorker } = await import('../output-processor');

      const text100 = 'a'.repeat(100);
      const result = await processInWorker(text100);

      expect(mockExecute).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('空字符串应直接同步处理', async () => {
      const { processInWorker } = await import('../output-processor');

      const result = await processInWorker('');

      expect(mockExecute).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.content).toBe('');
    });
  });

  describe('大数据包（> 100 字符）通过 Worker 处理', () => {
    it('> 100 字符时应创建 Worker 池并调用 execute', async () => {
      const expectedResult = { type: 'text', content: 'processed', metadata: { lineCount: 1 } };
      mockExecute.mockResolvedValueOnce(expectedResult);

      const { processInWorker } = await import('../output-processor');

      const largeText = 'a'.repeat(101);
      const result = await processInWorker(largeText);

      expect(mockCreateWorkerPool).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith('process', { text: largeText, options: undefined });
      expect(result).toEqual(expectedResult);
    });

    it('携带 options 时应透传给 Worker execute', async () => {
      const expectedResult = { type: 'json', content: '{}', metadata: {} };
      mockExecute.mockResolvedValueOnce(expectedResult);

      const { processInWorker } = await import('../output-processor');

      const opts = { foldThreshold: 10, enableHighlight: false };
      await processInWorker('a'.repeat(200), opts);

      expect(mockExecute).toHaveBeenCalledWith('process', {
        text: 'a'.repeat(200),
        options: opts,
      });
    });

    it('Worker 池应只创建一次（懒加载）', async () => {
      mockExecute.mockResolvedValue({ type: 'text', content: 'ok', metadata: {} });

      const { processInWorker } = await import('../output-processor');

      await processInWorker('a'.repeat(200));
      await processInWorker('b'.repeat(200));
      await processInWorker('c'.repeat(200));

      // createWorkerPool 只应被调用一次
      expect(mockCreateWorkerPool).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });
  });

  describe('Worker 执行失败时降级为同步处理', () => {
    it('Worker execute 抛出错误时应降级返回同步结果', async () => {
      mockExecute.mockRejectedValueOnce(new Error('Worker crash'));

      const { processInWorker } = await import('../output-processor');

      const result = await processInWorker('a'.repeat(200));

      // 降级后应有有效结果（来自 outputProcessor.process）
      expect(result).toBeDefined();
      expect(result.type).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('降级后仍应返回 ProcessedOutput 结构', async () => {
      mockExecute.mockRejectedValueOnce(new Error('timeout'));

      const { processInWorker } = await import('../output-processor');
      const result = await processInWorker('a'.repeat(200));

      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('content');
    });
  });

  describe('Worker 池创建参数', () => {
    it('应使用 size=2 创建 Worker 池', async () => {
      mockExecute.mockResolvedValueOnce({ type: 'text', content: 'ok', metadata: {} });

      const { processInWorker } = await import('../output-processor');
      await processInWorker('a'.repeat(200));

      const callArgs = mockCreateWorkerPool.mock.calls[0];
      expect(callArgs[1]).toMatchObject({ size: 2 });
    });

    it('应使用 timeout=5000 创建 Worker 池', async () => {
      mockExecute.mockResolvedValueOnce({ type: 'text', content: 'ok', metadata: {} });

      const { processInWorker } = await import('../output-processor');
      await processInWorker('a'.repeat(200));

      const callArgs = mockCreateWorkerPool.mock.calls[0];
      expect(callArgs[1]).toMatchObject({ timeout: 5000 });
    });

    it('应配置 fallback 函数', async () => {
      mockExecute.mockResolvedValueOnce({ type: 'text', content: 'ok', metadata: {} });

      const { processInWorker } = await import('../output-processor');
      await processInWorker('a'.repeat(200));

      const callArgs = mockCreateWorkerPool.mock.calls[0];
      expect(callArgs[1].fallback).toBeTypeOf('function');
    });

    it('fallback 函数应能处理文本并返回 ProcessedOutput', async () => {
      mockExecute.mockResolvedValueOnce({ type: 'text', content: 'ok', metadata: {} });

      const { processInWorker } = await import('../output-processor');
      await processInWorker('a'.repeat(200));

      const fallback = mockCreateWorkerPool.mock.calls[0][1].fallback as (
        type: string,
        payload: unknown
      ) => unknown;

      // 调用 fallback 并验证结果
      const result = fallback('process', {
        text: 'Hello World',
        options: undefined,
      }) as { type: string; content: string };

      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('content');
    });
  });
});

describe('destroyWorkerPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockReset();
    mockDestroy.mockReset();
    mockCreateWorkerPool.mockReturnValue(mockWorkerPool);
  });

  afterEach(async () => {
    vi.resetModules();
  });

  it('存在 Worker 池时应调用 pool.destroy()', async () => {
    mockExecute.mockResolvedValueOnce({ type: 'text', content: 'ok', metadata: {} });

    const { processInWorker, destroyWorkerPool } = await import('../output-processor');

    // 先触发 Worker 池初始化
    await processInWorker('a'.repeat(200));
    expect(mockCreateWorkerPool).toHaveBeenCalledTimes(1);

    destroyWorkerPool();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('无 Worker 池时调用 destroyWorkerPool 应无副作用（不报错）', async () => {
    const { destroyWorkerPool } = await import('../output-processor');

    // 未初始化 Worker 池时调用
    expect(() => destroyWorkerPool()).not.toThrow();
    expect(mockDestroy).not.toHaveBeenCalled();
  });

  it('销毁后再次调用 destroyWorkerPool 应为幂等操作', async () => {
    mockExecute.mockResolvedValue({ type: 'text', content: 'ok', metadata: {} });

    const { processInWorker, destroyWorkerPool } = await import('../output-processor');

    await processInWorker('a'.repeat(200));
    destroyWorkerPool();
    // 调用两次不应报错
    expect(() => destroyWorkerPool()).not.toThrow();
    // destroy 只应在有池时被调用
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('销毁后再次 processInWorker 应重新创建 Worker 池', async () => {
    mockExecute.mockResolvedValue({ type: 'text', content: 'ok', metadata: {} });

    const { processInWorker, destroyWorkerPool } = await import('../output-processor');

    // 第一次初始化
    await processInWorker('a'.repeat(200));
    expect(mockCreateWorkerPool).toHaveBeenCalledTimes(1);

    destroyWorkerPool();

    // 销毁后重新调用应重新创建
    await processInWorker('a'.repeat(200));
    expect(mockCreateWorkerPool).toHaveBeenCalledTimes(2);
  });
});