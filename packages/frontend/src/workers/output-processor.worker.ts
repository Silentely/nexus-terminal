/**
 * OutputProcessor WebWorker
 *
 * 在 Worker 线程中执行终端输出的语法高亮处理，
 * 避免大量终端输出阻塞主线程。
 *
 * 复用主进程的 OutputProcessor 类，不复制处理逻辑。
 */

import { OutputProcessor, type ProcessedOutput } from '../utils/output-processor';
import type { WorkerRequest, WorkerResponse } from './types';

/** 处理配置 */
interface ProcessConfig {
  foldThreshold?: number;
  enableHighlight?: boolean;
  enableTableFormat?: boolean;
  enableLinkDetection?: boolean;
}

// 复用主进程的 OutputProcessor 实例
let processor = new OutputProcessor();

// ==================== 消息处理 ====================

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;

  try {
    switch (type) {
      case 'process': {
        const { text, options } = payload as { text: string; options?: ProcessConfig };
        // 单次请求的配置只影响当前处理，避免污染后续未传配置的请求。
        const requestProcessor = options ? new OutputProcessor(options) : processor;
        const result: ProcessedOutput = requestProcessor.process(text);
        const response: WorkerResponse = { id, type, payload: result };
        self.postMessage(response);
        break;
      }
      case 'configure': {
        const options = payload as ProcessConfig;
        processor = new OutputProcessor(options);
        const response: WorkerResponse = { id, type, payload: { ok: true } };
        self.postMessage(response);
        break;
      }
      default: {
        const response: WorkerResponse = {
          id,
          type,
          payload: null,
          error: `未知任务类型: ${type}`,
        };
        self.postMessage(response);
      }
    }
  } catch (error) {
    const response: WorkerResponse = {
      id,
      type,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
