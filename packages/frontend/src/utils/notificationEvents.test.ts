/**
 * notificationEvents.ts 单元测试
 * 验证通知事件名翻译与摘要拼接逻辑
 */
import { describe, it, expect } from 'vitest';
import {
  getNotificationEventDisplayName,
  getNotificationEventsSummary,
} from './notificationEvents';

describe('getNotificationEventDisplayName', () => {
  it('翻译存在时应返回翻译结果', () => {
    const t = (key: string) => (key.includes('LOGIN_SUCCESS') ? '登录成功' : key);
    expect(getNotificationEventDisplayName('LOGIN_SUCCESS', t)).toBe('登录成功');
  });

  it('翻译缺失时应回退为空格分隔的首字母大写形式', () => {
    const t = (key: string) => key; // 模拟 i18n 返回 key 本身
    expect(getNotificationEventDisplayName('SSH_CONNECT_SUCCESS', t)).toBe('Ssh Connect Success');
  });

  it('翻译缺失且事件为单词时应正常回退', () => {
    const t = (key: string) => key;
    expect(getNotificationEventDisplayName('LOGOUT', t)).toBe('Logout');
  });
});

describe('getNotificationEventsSummary', () => {
  const t = (key: string) => {
    if (key.includes('LOGIN_SUCCESS')) return '登录成功';
    if (key.includes('LOGOUT')) return '登出';
    return key;
  };

  it('应拼接翻译后的事件名', () => {
    const result = getNotificationEventsSummary(['LOGIN_SUCCESS', 'LOGOUT'], t, '无事件', '触发');
    expect(result).toBe('触发: 登录成功, 登出');
  });

  it('空数组时应返回无事件文案', () => {
    expect(getNotificationEventsSummary([], t, '无事件', '触发')).toBe('无事件');
  });

  it('undefined 数组时应返回无事件文案', () => {
    expect(
      getNotificationEventsSummary(undefined as unknown as string[], t, '无事件', '触发'),
    ).toBe('无事件');
  });
});
