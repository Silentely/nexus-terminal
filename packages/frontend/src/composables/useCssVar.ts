/**
 * 响应式读取 CSS 变量实际值
 *
 * Chart.js 在 canvas 上渲染时无法解析 CSS 变量字符串（如 'var(--color-primary)'），
 * 必须传入解析后的实际颜色值。本项目多个图表组件此前各自实现 getComputedStyle 读取，
 * 且仅在挂载时读取一次、不随主题切换更新。
 *
 * 本工具统一该逻辑：
 * - 首次调用时读取，并监听主题应用（document 上 'appearance-theme-applied' 事件）
 *   与 visibilitychange，确保浅色/深色主题切换后图表颜色及时刷新。
 * - 在 Vue 组件中使用时配合 watch / 强制重绘 key 消费返回值。
 */
import { ref, onMounted, onUnmounted, type Ref } from 'vue';

/** 主题切换后由 appearance-background.store 派发的事件名 */
const THEME_APPLIED_EVENT = 'appearance-theme-applied';

const cssVarCache = new Map<string, Ref<string>>();

/**
 * 获取（并缓存）CSS 变量的响应式引用
 *
 * 注意：本函数仅读取并缓存值，不注册任何事件监听。
 * 需要随主题切换自动刷新的场景请使用 useCssVarWithLifecycle（由组件生命周期管理监听）。
 * @param varName CSS 变量名，如 '--color-success'
 * @param fallback 读取失败时的回退值
 * @returns Ref<string>
 */
export function useCssVar(varName: string, fallback = ''): Ref<string> {
  const cached = cssVarCache.get(varName);
  if (cached) return cached;

  const value = ref(readCssVar(varName) || fallback);
  cssVarCache.set(varName, value);

  return value;
}

/** 从文档根节点读取 CSS 变量的实际解析值 */
function readCssVar(varName: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/**
 * 将 #rrggbb / #rgb 颜色转换为 rgba 字符串（含透明度）
 * Chart.js 需要实际颜色值；无法解析时返回原始值
 * @param color 十六进制颜色（如 '#10b981'）
 * @param alpha 透明度（0-1）
 * @returns rgba 字符串或原始值
 */
export function hexToRgba(color: string, alpha: number): string {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return color;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Vue 组件生命周期内使用响应式 CSS 变量：
 * 挂载时读取、主题切换时自动刷新、卸载时移除监听
 */
export function useCssVarWithLifecycle(
  varName: string,
  fallback = '',
): { value: Ref<string>; refresh: () => void } {
  const value = useCssVar(varName, fallback);
  const refresh = () => {
    value.value = readCssVar(varName) || fallback;
  };

  onMounted(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener(THEME_APPLIED_EVENT, refresh);
    }
  });

  onUnmounted(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener(THEME_APPLIED_EVENT, refresh);
    }
  });

  return { value, refresh };
}

/** 清空 CSS 变量缓存（供测试使用，避免跨用例状态污染） */
export function resetCssVarCache(): void {
  cssVarCache.clear();
}
