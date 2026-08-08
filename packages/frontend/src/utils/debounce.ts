/**
 * 统一防抖工具
 *
 * 背景：Terminal.vue 与 useTerminalFit.ts 各自实现了一份防抖逻辑，
 * 行为一致但无法复用。本工具提供带类型推导与取消能力的共享实现。
 */

export interface DebouncedFunction<TArgs extends unknown[]> {
  (...args: TArgs): void;
  /** 取消尚未执行的调用 */
  cancel: () => void;
}

/** 创建防抖函数：delay 毫秒内多次调用只执行最后一次 */
export function createDebounced<TArgs extends unknown[]>(
  func: (...args: TArgs) => void,
  delay: number,
): DebouncedFunction<TArgs> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: TArgs) => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      func(...args);
    }, delay);
  };
  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  return debounced;
}
