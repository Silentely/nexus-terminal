import nodemailer from 'nodemailer';
import Mail from 'nodemailer/lib/mailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { INotificationSender } from '../notification.dispatcher.service';
import { ProcessedNotification } from '../notification.processor.service';
import { EmailConfig } from '../../types/notification.types';
import { settingsService } from '../../settings/settings.service';

class EmailSenderService implements INotificationSender {
  async send(notification: ProcessedNotification): Promise<void> {
    const config = notification.config as EmailConfig;
    const { to, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, from } = config;
    const subject = notification.subject || 'Notification';
    const { body } = notification;

    if (!to) {
      console.error('[EmailSender] Missing recipient address (to) in configuration.');
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
      const finalSmtpSecure = smtpSecure ?? (globalSmtpSecureStr === 'true');
      const finalSmtpUser = smtpUser || globalSmtpUser;
      const finalSmtpPass = smtpPass || globalSmtpPass;
      const finalFrom = from || globalSmtpFrom || 'noreply@nexus-terminal.local';

      if (!finalSmtpHost) {
        console.error(
          '[EmailSender] SMTP host is not configured (neither channel-specific nor global).'
        );
        throw new Error('SMTP host configuration is missing.');
      }

      if (isNaN(finalSmtpPort) || finalSmtpPort <= 0) {
        console.error(
          `[EmailSender] Invalid SMTP port configured: ${finalSmtpPort}. Using default 587.`
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

      console.log(`[EmailSender] Sending email notification to: ${to} with subject: "${subject}"`);
      const info = await transporter.sendMail(mailOptions);
      console.log(`[EmailSender] Email sent successfully. Message ID: ${info.messageId}`);
    } catch (error: any) {
      console.error(`[EmailSender] Error sending email notification to ${to}:`, error);

      throw new Error(`Failed to send email notification: ${error.message || error}`);
    }
  }
}

const emailSenderService = new EmailSenderService();
export default emailSenderService;
