/**
 * 统一日期格式化工具
 *
 * 背景：此前 9 个组件/视图各自实现日期格式化，约定不一致——
 * 秒级时间戳需要手动 * 1000、部分硬编码 'zh-CN' 不随语言切换、无效输入兜底各异。
 * 本工具收敛解析与格式化逻辑：
 * - 数字输入自动识别秒/毫秒（< 1e12 视为秒级时间戳）
 * - 字符串 / Date 直接解析，无效输入统一返回 fallback
 * - locale 由调用方传入（组件内 useI18n().locale），不再硬编码
 */

export type DateInput = number | string | Date | null | undefined;

export interface FormatDateOptions {
  /** 区域标识（如 'zh-CN'），缺省使用运行环境默认 locale */
  locale?: string;
  /** 输入为空或无效时的兜底文案，默认 '-' */
  fallback?: string;
  /** 是否包含秒（默认 false） */
  withSeconds?: boolean;
}

/** 解析任意输入为 Date；空值/无效值返回 null。数字小于 1e12 视为秒级时间戳 */
export function parseDateInput(input: DateInput): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'number') {
    const date = new Date(input < 1e12 ? input * 1000 : input);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 完整日期时间：2026/08/08 14:30[:45] */
export function formatDateTime(input: DateInput, options: FormatDateOptions = {}): string {
  const date = parseDateInput(input);
  if (!date) return options.fallback ?? '-';
  return date.toLocaleString(options.locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.withSeconds ? { second: '2-digit' } : {}),
  });
}

/** 简短日期时间：Aug 8, 14:30（适合面板、侧栏） */
export function formatShortDateTime(input: DateInput, options: FormatDateOptions = {}): string {
  const date = parseDateInput(input);
  if (!date) return options.fallback ?? '-';
  return date.toLocaleString(options.locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 仅时间：14:30 */
export function formatTime(input: DateInput, options: FormatDateOptions = {}): string {
  const date = parseDateInput(input);
  if (!date) return options.fallback ?? '-';
  return date.toLocaleTimeString(options.locale, { hour: '2-digit', minute: '2-digit' });
}
