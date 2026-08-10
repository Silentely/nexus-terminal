/**
 * 延迟工具
 *
 * 统一散落各处的 `new Promise((resolve) => setTimeout(resolve, ms))` 重复实现，
 * 提供可取消的 sleep，便于测试与重试场景复用。
 */

/**
 * 返回 Promise，在指定毫秒后 resolve
 * @param ms 延迟毫秒数
 * @returns Promise<void>
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 可取消的延迟：调用返回的 cancel 函数可提前 resolve，避免组件卸载后
 * 定时器回调仍触发状态更新。
 * @param ms 延迟毫秒数
 * @returns { promise, cancel }
 */
export function cancellableSleep(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveFn: (() => void) | null = null;

  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
    timer = setTimeout(() => {
      resolveFn?.();
      resolveFn = null;
    }, ms);
  });

  return {
    promise,
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        resolveFn?.();
        resolveFn = null;
      }
    },
  };
}
