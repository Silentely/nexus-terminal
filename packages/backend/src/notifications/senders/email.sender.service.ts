import nodemailer from 'nodemailer';
import Mail from 'nodemailer/lib/mailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { INotificationSender } from '../notification-sender.interface';
import type { ProcessedNotification } from '../notification.processor.service';
import { EmailConfig } from '../../types/notification.types';
import { settingsService } from '../../settings/settings.service';
import { getErrorMessage } from '../../utils/AppError';
import { logger } from '../../utils/logger';

class EmailSenderService implements INotificationSender {
  async send(notification: ProcessedNotification): Promise<void> {
    const config = notification.config as EmailConfig;
    const { to, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, from } = config;
    const subject = notification.subject || 'Notification';
    const { body } = notification;

    if (!to) {
      logger.error('[EmailSender] Missing recipient address (to) in configuration.');
      throw new Error('Email configuration is incomplete (missing recipient address).');
    }

    try {
      const globalSmtpHost = await settingsService.getSetting('smtpHost');
      const globalSmtpPortStr = await settingsService.getSetting('smtpPort');
      const globalSmtpSecureStr = await settingsService.getSetting('smtpSecure');
      const globalSmtpUser = await settingsService.getSetting('smtpUser');
      const globalSmtpPass = await settingsService.getSetting('smtpPass');
      const globalSmtpFrom = await settingsService.getSetting('smtpFrom');

      const finalSmtpHost = smtpHost || globalSmtpHost;
      const finalSmtpPort = smtpPort ?? (globalSmtpPortStr ? parseInt(globalSmtpPortStr, 10) : 587);
      const finalSmtpSecure = smtpSecure ?? globalSmtpSecureStr === 'true';
      const finalSmtpUser = smtpUser || globalSmtpUser;
      const finalSmtpPass = smtpPass || globalSmtpPass;
      const finalFrom = from || globalSmtpFrom || 'noreply@nexus-terminal.local';

      if (!finalSmtpHost) {
        logger.error(
          '[EmailSender] SMTP host is not configured (neither channel-specific nor global).',
        );
        throw new Error('SMTP host configuration is missing.');
      }

      if (Number.isNaN(finalSmtpPort) || finalSmtpPort <= 0) {
        logger.error(
          `[EmailSender] Invalid SMTP port configured: ${finalSmtpPort}. Using default 587.`,
        );

        throw new Error(`Invalid SMTP port configured: ${finalSmtpPort}`);
      }

      const transporterOptions: SMTPTransport.Options = {
        host: finalSmtpHost,
        port: finalSmtpPort,
        secure: finalSmtpSecure,
        auth:
          finalSmtpUser && finalSmtpPass
            ? {
                user: finalSmtpUser,
                pass: finalSmtpPass,
              }
            : undefined,
        tls: {
          rejectUnauthorized: finalSmtpSecure,

          minVersion: 'TLSv1.2',
        },
      };

      const transporter = nodemailer.createTransport(transporterOptions);

      const mailOptions: Mail.Options = {
        from: `"${finalFrom.split('@')[0]}" <${finalFrom}>`,
        to,
        subject,

        html: body,
      };

      logger.info({ to, subject }, '[EmailSender] Sending email notification');
      const info = await transporter.sendMail(mailOptions);
      logger.info({ messageId: info.messageId }, '[EmailSender] Email sent successfully');
    } catch (error: unknown) {
      logger.error({ to, err: error }, '[EmailSender] Error sending email notification');

      throw new Error(`Failed to send email notification: ${getErrorMessage(error)}`);
    }
  }
}

const emailSenderService = new EmailSenderService();
export default emailSenderService;
