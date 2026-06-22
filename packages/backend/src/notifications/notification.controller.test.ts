import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationController } from './notification.controller';
import { buildTestNotification } from './notification-test-builder.helper';

const { mockRepository, mockSendTestNotification, mockEmitEvent } = vi.hoisted(() => ({
  mockRepository: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockSendTestNotification: vi.fn(),
  mockEmitEvent: vi.fn(),
}));

vi.mock('./notification.repository', () => ({
  NotificationSettingsRepository: vi.fn().mockImplementation(() => mockRepository),
}));

vi.mock('./notification.dispatcher.service', () => ({
  default: {
    sendTestNotification: mockSendTestNotification,
  },
}));

vi.mock('../services/event.service', () => ({
  default: {
    emitEvent: mockEmitEvent,
  },
  AppEventType: {
    TestNotification: 'testNotification',
    NotificationSettingCreated: 'NOTIFICATION_SETTING_CREATED',
    NotificationSettingUpdated: 'NOTIFICATION_SETTING_UPDATED',
    NotificationSettingDeleted: 'NOTIFICATION_SETTING_DELETED',
  },
}));

vi.mock('../i18n', () => ({
  default: {
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key,
  },
}));

describe('NotificationController', () => {
  let controller: NotificationController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new NotificationController();
  });

  it('testSetting 应返回真实测试结果', async () => {
    mockRepository.getById.mockResolvedValue({
      id: 1,
      name: 'Webhook',
      channel_type: 'webhook',
      config: { url: 'https://example.com' },
    });
    mockSendTestNotification.mockResolvedValue({
      success: true,
      message: '测试通知发送成功。',
    });

    const req = {
      params: { id: '1' },
      session: {},
    } as any;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as any;

    await controller.testSetting(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: '测试通知发送成功。',
    });
  });

  it('testUnsavedSetting 应返回失败结果而非抛出异常', async () => {
    mockSendTestNotification.mockResolvedValue({
      success: false,
      message: '测试通知发送失败：network error',
    });

    const req = {
      body: {
        channel_type: 'telegram',
        config: { botToken: 'token', chatId: 'chat' },
      },
      session: {},
    } as any;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as any;

    await controller.testUnsavedSetting(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: '测试通知发送失败：network error',
    });
  });
});

describe('buildTestNotification (helper)', () => {
  it('webhook 默认模板应保留结构化 details', () => {
    const notification = buildTestNotification('webhook', { bodyTemplate: '' }, 1, {
      message: 'hello',
    });

    expect(JSON.parse(notification.body)).toEqual({
      event: 'testNotification',
      timestamp: expect.any(String),
      details: {
        message: 'hello',
      },
    });
  });

  it('email 默认模板应包含 HTML 结构', () => {
    const notification = buildTestNotification('email', {}, 1, { message: 'hello' });

    expect(notification.body).toContain('<p>Event: testNotification</p>');
    expect(notification.body).toContain('<pre>');
  });

  it('telegram 默认模板应包含 markdown 格式', () => {
    const notification = buildTestNotification('telegram', {}, 1, { message: 'hello' });

    expect(notification.body).toContain('```');
  });

  it('自定义模板应被正确插值', () => {
    const notification = buildTestNotification(
      'webhook',
      { bodyTemplate: '{"msg":"{message}","ts":"{timestamp}"}' },
      1,
      { message: 'custom' },
    );

    const parsed = JSON.parse(notification.body);
    expect(parsed.msg).toBe('custom');
    expect(parsed.ts).toBeDefined();
  });

  it('未使用的占位符应保留原始值', () => {
    const notification = buildTestNotification(
      'webhook',
      { bodyTemplate: '{"key":"{unknownVar}"}' },
      1,
    );

    expect(notification.body).toContain('{unknownVar}');
  });
});
