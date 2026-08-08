import { describe, expect, it } from 'vitest';
import {
  normalizeEventPlaceholder,
  renderCustomTemplate,
  renderTemplate,
} from './notification-template.utils';

describe('renderTemplate', () => {
  it('无模板时返回默认文本', () => {
    expect(renderTemplate(undefined, { event: 'A' }, '默认')).toBe('默认');
    expect(renderTemplate('', { event: 'A' }, '默认')).toBe('默认');
  });

  it('插值 {key} 占位符', () => {
    const result = renderTemplate(
      '事件 {event} 于 {timestamp}',
      { event: '登录', timestamp: '10:00' },
      '',
    );
    expect(result).toBe('事件 登录 于 10:00');
  });

  it('同一占位符多处出现时全部替换', () => {
    const result = renderTemplate('{event}/{event}', { event: 'X' }, '');
    expect(result).toBe('X/X');
  });

  it('不存在的占位符保持不变', () => {
    const result = renderTemplate('{unknown}', { event: 'X' }, '');
    expect(result).toBe('{unknown}');
  });
});

describe('normalizeEventPlaceholder', () => {
  it('将 {event} 归一化为 {eventDisplay}', () => {
    expect(normalizeEventPlaceholder('{event} 已触发 {event}')).toBe(
      '{eventDisplay} 已触发 {eventDisplay}',
    );
  });

  it('无 {event} 时原样返回', () => {
    expect(normalizeEventPlaceholder('仅 {timestamp}')).toBe('仅 {timestamp}');
  });
});

describe('renderCustomTemplate', () => {
  it('无模板时返回默认文本', () => {
    expect(renderCustomTemplate(undefined, { eventDisplay: 'A' }, '默认')).toBe('默认');
  });

  it('自定义模板中 {event} 被归一化并插值', () => {
    const result = renderCustomTemplate('{event} 发生', { eventDisplay: '设置已更新' }, '默认');
    expect(result).toBe('设置已更新 发生');
  });

  it('自定义模板直接使用 {eventDisplay}', () => {
    const result = renderCustomTemplate('收到 {eventDisplay}', { eventDisplay: '告警' }, '默认');
    expect(result).toBe('收到 告警');
  });
});
