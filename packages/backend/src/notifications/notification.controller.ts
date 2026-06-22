import { Request, Response } from 'express';
import { NotificationSettingsRepository } from './notification.repository'; // Use repository
import {
  NotificationSetting,
  NotificationChannelType,
  NotificationChannelConfig,
} from '../types/notification.types';
// import { AuditLogService } from '../services/audit.service'; // Keep for now if other parts use it - Removed as eventService is used
import { AppEventType, default as eventService } from '../services/event.service'; // Import event service
import notificationDispatcherService from './notification.dispatcher.service';
import { buildTestNotification } from './notification-test-builder.helper';
import i18next from '../i18n'; // Import the i18next instance
import { getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';

// Remove sender imports as they are no longer called directly for testing
// import telegramSenderService from '../services/senders/telegram.sender.service';
// import emailSenderService from '../services/senders/email.sender.service';
// import webhookSenderService from '../services/senders/webhook.sender.service';
// import { ProcessedNotification } from '../services/notification.processor.service'; // Not needed here

// Removed escapeTelegramMarkdownV2 helper function

// const auditLogService = new AuditLogService(); // Removed as eventService is used

type SessionWithUserId = {
  userId?: unknown;
};

// 从 session 中安全提取 userId，避免直接使用 any。
const getSessionUserId = (session: unknown): number | undefined => {
  if (typeof session !== 'object' || session === null || !('userId' in session)) {
    return undefined;
  }

  const { userId } = session as SessionWithUserId;
  return typeof userId === 'number' ? userId : undefined;
};

export class NotificationController {
  private repository: NotificationSettingsRepository; // Use repository

  constructor() {
    this.repository = new NotificationSettingsRepository(); // Instantiate repository
  }

  // GET /api/v1/notifications
  getAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const settings = await this.repository.getAll(); // Use repository
      res.status(200).json(settings);
    } catch (error: unknown) {
      // Use i18next.t for i18n
      res.status(500).json({
        message: i18next.t('notificationController.errorFetchSettings'),
        error: getErrorMessage(error),
      });
    }
  };

  // POST /api/v1/notifications
  create = async (req: Request, res: Response): Promise<void> => {
    const settingData: Omit<NotificationSetting, 'id' | 'created_at' | 'updated_at'> = req.body;

    if (!settingData.channel_type || !settingData.name || !settingData.config) {
      // Use i18next.t for i18n
      res.status(400).json({ message: i18next.t('notificationController.errorMissingFields') });
      return;
    }

    try {
      const newSettingId = await this.repository.create(settingData); // Use repository
      const newSetting = await this.repository.getById(newSettingId);
      // 记录审计日志 (Use event service)
      if (newSetting) {
        eventService.emitEvent(AppEventType.NotificationSettingCreated, {
          userId: getSessionUserId(req.session), // Assuming userId is in session
          details: {
            settingId: newSetting.id,
            name: newSetting.name,
            type: newSetting.channel_type,
          },
        });
      }
      res.status(201).json(newSetting);
    } catch (error: unknown) {
      // Use i18next.t for i18n
      res.status(500).json({
        message: i18next.t('notificationController.errorCreateSetting'),
        error: getErrorMessage(error),
      });
    }
  };

  // PUT /api/v1/notifications/:id
  update = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id, 10);
    const settingData: Partial<Omit<NotificationSetting, 'id' | 'created_at' | 'updated_at'>> =
      req.body;

    if (Number.isNaN(id)) {
      // Use i18next.t for i18n
      res.status(400).json({ message: i18next.t('notificationController.errorInvalidId') });
      return;
    }
    if (Object.keys(settingData).length === 0) {
      // Use i18next.t for i18n
      res.status(400).json({ message: i18next.t('notificationController.errorNoUpdateData') });
      return;
    }

    try {
      const success = await this.repository.update(id, settingData); // Use repository
      if (success) {
        const updatedSetting = await this.repository.getById(id);
        // 记录审计日志 (Use event service)
        eventService.emitEvent(AppEventType.NotificationSettingUpdated, {
          userId: getSessionUserId(req.session),
          details: { settingId: id, updatedFields: Object.keys(settingData) },
        });
        res.status(200).json(updatedSetting);
      } else {
        // Use i18next.t for i18n with interpolation
        res
          .status(404)
          .json({ message: i18next.t('notificationController.errorNotFound', { id }) });
      }
    } catch (error: unknown) {
      // Use i18next.t for i18n
      res.status(500).json({
        message: i18next.t('notificationController.errorUpdateSetting'),
        error: getErrorMessage(error),
      });
    }
  };

  // DELETE /api/v1/notifications/:id
  delete = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id, 10);

    if (Number.isNaN(id)) {
      // Use i18next.t for i18n
      res.status(400).json({ message: i18next.t('notificationController.errorInvalidId') });
      return;
    }

    try {
      const settingToDelete = await this.repository.getById(id); // Get details before deleting for audit log
      if (!settingToDelete) {
        // Use i18next.t for i18n with interpolation
        res
          .status(404)
          .json({ message: i18next.t('notificationController.errorNotFound', { id }) });
        return;
      }
      const success = await this.repository.delete(id); // Use repository
      if (success) {
        // 记录审计日志 (Use event service)
        eventService.emitEvent(AppEventType.NotificationSettingDeleted, {
          userId: getSessionUserId(req.session),
          details: {
            settingId: id,
            name: settingToDelete.name,
            type: settingToDelete.channel_type,
          }, // Include name/type in audit
        });
        res.status(204).send(); // No Content
      } else {
        // Should not happen if getById succeeded, but handle defensively
        // Use i18next.t for i18n with interpolation
        res
          .status(404)
          .json({ message: i18next.t('notificationController.errorDeleteNotFound', { id }) });
      }
    } catch (error: unknown) {
      // Use i18next.t for i18n
      res.status(500).json({
        message: i18next.t('notificationController.errorDeleteSetting'),
        error: getErrorMessage(error),
      });
    }
  };

  // --- Refactored Test Endpoints ---

  // Removed executeTestSend method as testing now goes through the event system

  // POST /api/v1/notifications/:id/test
  // Tests an existing, saved setting configuration by triggering a test event
  testSetting = async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id, 10);

    if (Number.isNaN(id)) {
      // Use i18next.t for i18n
      res.status(400).json({ message: i18next.t('notificationController.errorInvalidId') });
      return;
    }

    try {
      const settingToTest = await this.repository.getById(id);
      if (!settingToTest) {
        // Use i18next.t for i18n with interpolation
        res
          .status(404)
          .json({ message: i18next.t('notificationController.errorNotFound', { id }) });
        return;
      }

      const testNotification = buildTestNotification(
        settingToTest.channel_type,
        settingToTest.config,
        getSessionUserId(req.session),
        {
          message: i18next.t('notificationController.testMessageSaved', {
            id,
            name: settingToTest.name,
          }),
        },
      );
      const result = await notificationDispatcherService.sendTestNotification(testNotification);
      res.status(200).json(result);
    } catch (error: unknown) {
      logger.error(`[NotificationController] Error triggering test for setting ${id}:`, error);
      // Use i18next.t for i18n
      res.status(500).json({
        message: i18next.t('notificationController.errorTriggerTest'),
        error: getErrorMessage(error),
      });
    }
  };

  // POST /api/v1/notifications/test-unsaved
  // Tests configuration data provided in the request body by triggering a test event
  testUnsavedSetting = async (req: Request, res: Response): Promise<void> => {
    const { channel_type, config } = req.body as {
      channel_type: NotificationChannelType;
      config: NotificationChannelConfig;
    };

    if (!channel_type || !config) {
      // Use i18next.t for i18n
      res.status(400).json({ message: i18next.t('notificationController.errorMissingTestInfo') });
      return;
    }

    if (!['webhook', 'email', 'telegram'].includes(channel_type)) {
      // Use i18next.t for i18n
      res
        .status(400)
        .json({ message: i18next.t('notificationController.errorInvalidChannelType') });
      return;
    }

    try {
      const testNotification = buildTestNotification(
        channel_type,
        config,
        getSessionUserId(req.session),
        {
          message: i18next.t('notificationController.testMessageUnsaved', {
            channelType: channel_type,
          }),
        },
      );
      const result = await notificationDispatcherService.sendTestNotification(testNotification);
      res.status(200).json(result);
    } catch (error: unknown) {
      logger.error(
        `[NotificationController] Error triggering test for unsaved ${channel_type}:`,
        error,
      );
      // Use i18next.t for i18n
      res.status(500).json({
        message: i18next.t('notificationController.errorTriggerTest'),
        error: getErrorMessage(error),
      });
    }
  };
}
