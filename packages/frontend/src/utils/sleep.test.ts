/**
 * utils/sleep 单元测试
 * 覆盖基础延迟与可取消延迟
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sleep, cancellableSleep } from './sleep';

describe('utils/sleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sleep 应在指定时间后 resolve', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const p = sleep(100).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toBe(true);
  });

  it('cancellableSleep 取消后应提前 resolve', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const { promise, cancel } = cancellableSleep(5000);
    promise.then(() => {
      resolved = true;
    });

    cancel();
    await promise;
    expect(resolved).toBe(true);
  });

  it('cancellableSleep 未取消时按原定时器 resolve', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const { promise } = cancellableSleep(200);
    promise.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toBe(true);
  });

  it('sleep(0) 应尽快 resolve', async () => {
    let resolved = false;
    const p = sleep(0).then(() => {
      resolved = true;
    });
    await p;
    expect(resolved).toBe(true);
  });
});
