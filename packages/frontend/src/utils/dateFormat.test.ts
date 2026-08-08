import { describe, expect, it } from 'vitest';
import { formatDateTime, formatShortDateTime, formatTime, parseDateInput } from './dateFormat';

describe('parseDateInput', () => {
  it('空值与 undefined 返回 null', () => {
    expect(parseDateInput(null)).toBeNull();
    expect(parseDateInput(undefined)).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });

  it('有效 Date 原样返回，无效 Date 返回 null', () => {
    const valid = new Date('2026-01-02T03:04:05Z');
    expect(parseDateInput(valid)).toBe(valid);
    expect(parseDateInput(new Date('not-a-date'))).toBeNull();
  });

  it('秒级数字时间戳自动转换为毫秒', () => {
    const expected = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
    const seconds = Math.floor(expected.getTime() / 1000);
    expect(parseDateInput(seconds)?.toISOString()).toBe(expected.toISOString());
  });

  it('毫秒级数字时间戳原样解析', () => {
    const expected = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(parseDateInput(expected.getTime())?.toISOString()).toBe(expected.toISOString());
  });

  it('ISO 字符串解析，无效字符串返回 null', () => {
    expect(parseDateInput('2026-01-02T03:04:05Z')?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(parseDateInput('garbage')).toBeNull();
  });
});

describe('formatDateTime', () => {
  it('有效输入输出包含年月日时分', () => {
    const result = formatDateTime('2026-01-02T03:04:05Z');
    expect(result).toContain('2026');
    expect(result).toContain('01');
    expect(result).toContain('02');
  });

  it('空值与无效输入返回默认 fallback', () => {
    expect(formatDateTime(null)).toBe('-');
    expect(formatDateTime('garbage')).toBe('-');
  });

  it('自定义 fallback 生效', () => {
    expect(formatDateTime(undefined, { fallback: '未知' })).toBe('未知');
  });

  it('withSeconds 控制秒显示', () => {
    const withSeconds = formatDateTime('2026-01-02T03:04:05Z', { withSeconds: true });
    expect(withSeconds).toContain('05');
  });

  it('locale 参数生效（zh-CN 输出含分隔符且不含英文月份缩写）', () => {
    const result = formatDateTime('2026-01-02T03:04:05Z', { locale: 'zh-CN' });
    expect(result).not.toContain('Jan');
  });
});

describe('formatShortDateTime', () => {
  it('输出简短月份与时间', () => {
    const result = formatShortDateTime('2026-01-02T03:04:05Z');
    expect(result).toContain('Jan');
    expect(result).toContain('2');
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('无效输入返回 fallback', () => {
    expect(formatShortDateTime('bad', { fallback: 'N/A' })).toBe('N/A');
  });
});

describe('formatTime', () => {
  it('仅输出时分', () => {
    const result = formatTime('2026-01-02T03:04:05Z');
    expect(result).toMatch(/\d{1,2}:\d{2}/);
    expect(result).not.toContain('2026');
  });

  it('无效输入返回 fallback', () => {
    expect(formatTime(null, { fallback: '--:--' })).toBe('--:--');
  });
});
