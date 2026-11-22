import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Sends one e-mail. Rejects when the SMTP server refuses it. */
export interface Mailer {
  sendMail(mail: Mail): Promise<void>;
}

export interface MailLogger {
  info(obj: unknown, msg?: string): void;
}

/**
 * Without SMTP_HOST, Fixi still works: the e-mail is written to the logs and the send "succeeds".
 * With SMTP_HOST, a single nodemailer transport is created and reused.
 */
export function createMailer(smtp: Config['smtp'], logger: MailLogger): Mailer {
  if (!smtp.host) {
    return {
      async sendMail(mail) {
        logger.info({ mail }, 'SMTP disabled');
      },
    };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? '' } : undefined,
    // Never let a dead SMTP server hang an admin request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    async sendMail(mail) {
      await transport.sendMail({ from: smtp.from, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}
