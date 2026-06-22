/**
 * 终端输出缓冲管理器
 * 从 useSshTerminal.ts 提取，负责缓冲 WebSocket 消息并批量写入终端
 */

import type { Terminal } from '@xterm/xterm';

const MERGE_THRESHOLD_BYTES = 512 * 1024; // 512KB 合并阈值

/**
 * 计算缓冲项的字节大小
 */
function getItemByteSize(item: string | Uint8Array): number {
  if (typeof item === 'string') {
    return item.length * 2; // UTF-16 编码
  }
  return item.byteLength;
}

/**
 * 合并 Uint8Array 数组
 * 超过阈值时不合并，返回 null 由调用方逐块写入
 */
function mergeUint8Arrays(arrays: Uint8Array[]): Uint8Array | null {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  if (totalLength > MERGE_THRESHOLD_BYTES) return null;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * 创建终端输出缓冲管理器
 */
export function createBufferManager(terminal: Terminal) {
  const buffer: (string | Uint8Array)[] = [];
  let currentBufferSizeBytes = 0;
  let flushScheduled = false;
  let lastFlushTime = 0;

  const FLUSH_INTERVAL_MS = 16; // 约 60fps
  const MAX_BUFFER_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
  const IDLE_CALLBACK_TIMEOUT_MS = 50;

  const idleWindow = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    };

  /**
   * 调度空闲任务
   */
  const scheduleIdleTask = (callback: () => void, timeout = IDLE_CALLBACK_TIMEOUT_MS): void => {
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(
        (deadline: IdleDeadline) => {
          if (deadline.timeRemaining() > 0 || deadline.didTimeout) {
            callback();
          } else {
            requestAnimationFrame(callback);
          }
        },
        { timeout },
      );
    } else {
      requestAnimationFrame(callback);
    }
  };

  /**
   * 执行缓冲区写入
   */
  const doFlush = () => {
    if (buffer.length === 0) {
      flushScheduled = false;
      return;
    }

    const items = buffer.splice(0);
    currentBufferSizeBytes = 0;

    if (items.length === 1) {
      terminal.write(items[0]);
    } else {
      const allStrings = items.every((item) => typeof item === 'string');
      const allUint8Arrays = items.every((item) => item instanceof Uint8Array);

      if (allStrings) {
        terminal.write(items.join(''));
      } else if (allUint8Arrays) {
        const merged = mergeUint8Arrays(items as Uint8Array[]);
        if (merged) {
          terminal.write(merged);
        } else {
          for (const arr of items as Uint8Array[]) {
            terminal.write(arr);
          }
        }
      } else {
        let strBatch = '';
        let uint8Batch: Uint8Array[] = [];
        for (const item of items) {
          if (typeof item === 'string') {
            if (uint8Batch.length > 0) {
              const merged = mergeUint8Arrays(uint8Batch);
              if (merged) terminal.write(merged);
              else uint8Batch.forEach((a) => terminal.write(a));
              uint8Batch = [];
            }
            strBatch += item;
          } else {
            if (strBatch) {
              terminal.write(strBatch);
              strBatch = '';
            }
            uint8Batch.push(item);
          }
        }
        if (strBatch) terminal.write(strBatch);
        if (uint8Batch.length > 0) {
          const merged = mergeUint8Arrays(uint8Batch);
          if (merged) terminal.write(merged);
          else uint8Batch.forEach((a) => terminal.write(a));
        }
      }
    }

    flushScheduled = false;
  };

  /**
   * 调度刷新
   */
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;

    const now = Date.now();
    if (now - lastFlushTime >= FLUSH_INTERVAL_MS) {
      lastFlushTime = now;
      scheduleIdleTask(doFlush);
    } else {
      setTimeout(
        () => {
          lastFlushTime = Date.now();
          scheduleIdleTask(doFlush);
        },
        FLUSH_INTERVAL_MS - (now - lastFlushTime),
      );
    }
  };

  /**
   * 添加数据到缓冲区
   */
  const push = (item: string | Uint8Array) => {
    buffer.push(item);
    currentBufferSizeBytes += getItemByteSize(item);

    // 缓冲区溢出保护
    if (currentBufferSizeBytes > MAX_BUFFER_SIZE_BYTES) {
      const removed = buffer.shift();
      if (removed) {
        currentBufferSizeBytes -= getItemByteSize(removed);
      }
    }

    scheduleFlush();
  };

  /**
   * 清空缓冲区
   */
  const clear = () => {
    buffer.length = 0;
    currentBufferSizeBytes = 0;
    flushScheduled = false;
  };

  /**
   * 获取缓冲区条目数
   */
  const getLength = (): number => buffer.length;

  /**
   * 立即刷新缓冲区到终端
   */
  const flushBuffer = (): void => {
    if (buffer.length === 0) return;
    const items = buffer.splice(0, buffer.length);
    currentBufferSizeBytes = 0;
    for (const item of items) {
      terminal.write(item);
    }
  };

  /**
   * 将全部缓冲内容写入指定终端实例
   */
  const flushAllToTerminal = (term: Terminal): void => {
    if (buffer.length === 0) return;
    const items = buffer.splice(0, buffer.length);
    currentBufferSizeBytes = 0;
    for (const item of items) {
      term.write(item);
    }
  };

  return { push, clear, getLength, flushBuffer, flushAllToTerminal };
}
