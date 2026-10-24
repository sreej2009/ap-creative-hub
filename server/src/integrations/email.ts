import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

export function emailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.EMAIL_FROM);
}

class SmtpTransport implements EmailTransport {
  private transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  async send(message: EmailMessage) {
    const info = await this.transporter.sendMail({ from: env.EMAIL_FROM, ...message });
    return { messageId: String(info.messageId ?? '') };
  }
}

let override: EmailTransport | null | undefined;
let cached: EmailTransport | null | undefined;

export function getEmailTransport(): EmailTransport | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  return (cached = emailConfigured() ? new SmtpTransport() : null);
}

export function setEmailTransportForTests(transport: EmailTransport | null | undefined) {
  override = transport;
}

/**
 * WhatsApp Business messaging requires an approved provider account and
 * pre-approved templates. No provider is integrated yet, so this always
 * reports "not configured" and nothing is ever claimed as sent.
 */
export interface WhatsAppTransport {
  sendTemplate(to: string, template: string, params: string[]): Promise<{ messageId: string }>;
}

let whatsappOverride: WhatsAppTransport | null = null;
export function getWhatsAppTransport(): WhatsAppTransport | null {
  return whatsappOverride;
}
export function setWhatsAppTransportForTests(t: WhatsAppTransport | null) {
  whatsappOverride = t;
}
