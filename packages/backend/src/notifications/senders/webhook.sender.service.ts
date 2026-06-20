import axios, { Method } from 'axios';
import type { INotificationSender } from '../notification-sender.interface';
import type { ProcessedNotification } from '../notification.processor.service';
import { WebhookConfig } from '../../types/notification.types';
import { getErrorMessage } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { safeHttpGet, safeHttpPost } from '../../utils/ssrf-guard';

class WebhookSenderService implements INotificationSender {
  async send(notification: ProcessedNotification): Promise<void> {
    const config = notification.config as WebhookConfig;
    const { url, method = 'POST', headers = {} } = config;
    const requestBody = notification.body;

    if (!url) {
      logger.error('[WebhookSender] Missing webhook URL in configuration.');
      throw new Error('Webhook configuration is incomplete (missing URL).');
    }

    try {
      new URL(url);
    } catch (error: unknown) {
      logger.error(
        `[WebhookSender] Invalid webhook URL format: ${url} (${getErrorMessage(error)})`,
      );
      throw new Error(`Invalid webhook URL format: ${url}`);
    }

    const finalHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    const requestMethod: Method = method.toUpperCase() as Method;
    const validMethods: Method[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    if (!validMethods.includes(requestMethod)) {
      logger.error(`[WebhookSender] Invalid HTTP method specified: ${method}. Defaulting to POST.`);

      throw new Error(`Invalid HTTP method specified: ${method}`);
    }

    try {
      logger.info(`[WebhookSender] Sending ${requestMethod} notification to webhook URL: ${url}`);

      let requestData: unknown;
      const requestParams: Record<string, string> | undefined = undefined;

      if (['POST', 'PUT', 'PATCH'].includes(requestMethod)) {
        if (finalHeaders['Content-Type']?.toLowerCase().includes('application/json')) {
          try {
            requestData = JSON.parse(requestBody);
          } catch (parseError: unknown) {
            logger.warn(
              `[WebhookSender] Failed to parse request body as JSON for Content-Type application/json. Sending as raw string. Parse error: ${getErrorMessage(parseError)}. Body: ${requestBody.substring(
                0,
                100,
              )}...`,
            );
            requestData = requestBody;
          }
        } else {
          requestData = requestBody;
        }
      } else if (requestMethod === 'GET') {
        logger.warn(
          `[WebhookSender] Sending data in body for GET request might not be standard. URL: ${url}`,
        );
      }

      // 使用安全 HTTP 客户端，自动进行 SSRF 验证和 DNS 绑定
      let response;
      const baseOptions = {
        headers: finalHeaders,
        params: requestParams,
        timeout: 15000,
      };
      if (['POST', 'PUT', 'PATCH'].includes(requestMethod)) {
        response = await safeHttpPost(
          url,
          requestData,
          { ...baseOptions, method: requestMethod },
          'Webhook',
        );
      } else {
        response = await safeHttpGet(url, { ...baseOptions, method: requestMethod }, 'Webhook');
      }

      if (response.status >= 200 && response.status < 300) {
        logger.info(
          `[WebhookSender] Successfully sent notification to webhook. Status: ${response.status}`,
        );
      } else {
        logger.warn(
          `[WebhookSender] Webhook endpoint responded with status: ${response.status}`,
          response.data,
        );
        let dataSummary: string;
        try {
          dataSummary = JSON.stringify(response.data).substring(0, 200);
        } catch (err: unknown) {
          logger.debug({ err }, '操作失败，已忽略');
          dataSummary = String(response.data).substring(0, 200);
        }
        throw new Error(
          `Webhook endpoint rejected the request (HTTP ${response.status}): ${dataSummary}`,
        );
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        logger.error(
          `[WebhookSender] Axios error sending notification to ${url}: ${getErrorMessage(error)}`,
          error.response?.status,
          error.response?.data,
        );
        throw new Error(
          `Failed to send webhook notification (Axios Error): ${getErrorMessage(error)}`,
        );
      } else {
        logger.error(`[WebhookSender] Unexpected error sending notification to ${url}:`, error);
        throw new Error(
          `Failed to send webhook notification (Unexpected Error): ${getErrorMessage(error)}`,
        );
      }
    }
  }
}

const webhookSenderService = new WebhookSenderService();
export default webhookSenderService;
