import axios from 'axios';
import type { INotificationSender } from '../notification-sender.interface';
import type { ProcessedNotification } from '../notification.processor.service';
import { TelegramConfig } from '../../types/notification.types';
import { getErrorMessage } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { safeHttpPost } from '../../utils/ssrf-guard';

class TelegramSenderService implements INotificationSender {
  async send(notification: ProcessedNotification): Promise<void> {
    const config = notification.config as TelegramConfig;
    const { botToken, chatId, customDomain } = config; // Destructure customDomain
    const messageBody = notification.body;

    if (!botToken || !chatId) {
      logger.error('[TelegramSender] Missing botToken or chatId in configuration.');
      throw new Error('Telegram configuration is incomplete (missing botToken or chatId).');
    }

    let baseApiUrl = 'https://api.telegram.org';
    if (customDomain) {
      try {
        const url = new URL(customDomain); // Validate and parse the custom domain
        baseApiUrl = `${url.protocol}//${url.host}`; // Use protocol and host from customDomain
        logger.info(`[TelegramSender] Using custom domain: ${baseApiUrl}`);
      } catch (error: unknown) {
        logger.warn(
          `[TelegramSender] Invalid customDomain URL: ${customDomain}. Falling back to default Telegram API. (${getErrorMessage(error)})`,
        );
        // Optionally, you could throw an error here or decide to proceed with the default
      }
    }

    const apiUrl = `${baseApiUrl}/bot${botToken}/sendMessage`;

    try {
      logger.info(`[TelegramSender] Sending notification to chat ID: ${chatId}`);
      // 使用安全 HTTP 客户端，自动进行 SSRF 验证和 DNS 绑定
      const response = await safeHttpPost(
        apiUrl,
        {
          chat_id: chatId,
          text: messageBody,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        },
        { timeout: 10000 },
        'Telegram',
      );

      if (response.data && response.data.ok) {
        logger.info(`[TelegramSender] Successfully sent notification to chat ID: ${chatId}`);
      } else {
        const errorDescription = response.data?.description || 'Unknown error from Telegram API';
        logger.error(
          `[TelegramSender] Failed to send notification. Telegram API response: ${errorDescription}`,
          response.data,
        );
        throw new Error(`Telegram API error: ${errorDescription}`);
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        logger.error(
          `[TelegramSender] Axios error sending notification: ${getErrorMessage(error)}`,
          error.response?.data,
        );
        throw new Error(
          `Failed to send Telegram notification (Axios Error): ${getErrorMessage(error)}`,
        );
      } else {
        logger.error(`[TelegramSender] Unexpected error sending notification:`, error);
        throw new Error(
          `Failed to send Telegram notification (Unexpected Error): ${getErrorMessage(error)}`,
        );
      }
    }
  }
}

const telegramSenderService = new TelegramSenderService();
export default telegramSenderService;
