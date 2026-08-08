import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebounced } from './debounce';

describe('createDebounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('延迟窗口内多次调用只执行最后一次', () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 100);

    debounced(1);
    debounced(2);
    debounced(3);

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it('执行后再次调用可再次触发', () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 50);

    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);

    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel 取消尚未执行的调用', () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel 后再次调用可正常执行', () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 100);

    debounced();
    debounced.cancel();
    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
