/**
 * utils/formatBytes 单元测试
 * 覆盖 B/KB/MB/GB 四档、边界值与精度控制
 */
import { describe, it, expect } from 'vitest';
import { formatBytes } from './formatBytes';

describe('utils/formatBytes', () => {
  it('应格式化字节（B）', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('应格式化 KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1023)).toBe('1023.0 KB');
  });

  it('应格式化 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB');
  });

  it('应格式化 GB（默认 1 位小数，兼容文件管理器语义）', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatBytes(1024 * 1024 * 1024 * 2.75)).toBe('2.8 GB');
  });

  it('应支持自定义 GB 小数位数（兼容 dashboard 语义）', () => {
    expect(formatBytes(1024 * 1024 * 1024, 1, 2)).toBe('1.00 GB');
    expect(formatBytes(1024 * 1024 * 1024 * 2.75, 1, 2)).toBe('2.75 GB');
    expect(formatBytes(1024 * 1024 * 1024 * 2.75, 2, 2)).toBe('2.75 GB');
  });

  it('应支持自定义 KB/MB 小数位数', () => {
    expect(formatBytes(1024, 2)).toBe('1.00 KB');
    expect(formatBytes(1024 * 1024 * 5.5, 2)).toBe('5.50 MB');
  });

  it('应处理边界值', () => {
    expect(formatBytes(1024 * 1024 - 1)).toMatch(/KB$/);
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toMatch(/MB$/);
  });

  it('应处理非法输入', () => {
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
});
