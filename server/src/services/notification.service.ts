import type { HydratedDocument, Types } from 'mongoose';
import { env } from '../config/env.js';
import { getEmailTransport, getWhatsAppTransport, type EmailMessage } from '../integrations/email.js';
import { logger } from '../lib/logger.js';
import { trackingToken, trackingUrl } from '../lib/tracking.js';
import { formatINR } from '../lib/util.js';
import { Notification, type NotificationEvent, StoreSettings } from '../models/misc.js';
import { Order, type IOrder } from '../models/Order.js';
import type { IUser } from '../models/User.js';

/**
 * Notification service. Each attempt is recorded with an honest status:
 * 'sent' only when a provider accepted the message, 'skipped' when no
 * provider is configured or the customer has not opted in, 'failed' on error.
 */

type OrderEvent = Extract<
  NotificationEvent,
  'order_confirmation' | 'payment_confirmation' | 'shipment' | 'delivery_update' | 'cancellation' | 'refund'
>;

const pending = new Set<Promise<unknown>>();

function track<T>(p: Promise<T>) {
  pending.add(p);
  p.finally(() => pending.delete(p)).catch(() => undefined);
  return p;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${escapeHtml(cta.url)}" style="background:#9d3a5c;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#fbf7f1;font-family:Helvetica,Arial,sans-serif;color:#2b2024">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #efe4d6">
<tr><td style="padding:28px 32px 8px;border-bottom:1px solid #f3e9dc"><div style="font-family:Georgia,serif;font-size:22px;color:#9d3a5c">${escapeHtml(env.STORE_NAME)}</div></td></tr>
<tr><td style="padding:24px 32px 32px"><h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 16px">${escapeHtml(title)}</h1>${bodyHtml}${button}
<p style="font-size:12px;color:#8a7a72;margin-top:32px">You are receiving this email because of an order or account at ${escapeHtml(env.STORE_NAME)}.</p></td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(order: IOrder) {
  const rows = order.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0">${escapeHtml(i.name)}${i.variantLabel ? ` <span style="color:#8a7a72">(${escapeHtml(i.variantLabel)})</span>` : ''} × ${i.quantity}</td><td align="right">${formatINR(i.lineTotal)}</td></tr>`,
    )
    .join('');
  const p = order.pricing;
  const line = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0;${bold ? 'font-weight:700' : 'color:#6b5b55'}">${label}</td><td align="right" style="${bold ? 'font-weight:700' : ''}">${value}</td></tr>`;
  return `<table width="100%" style="font-size:14px;border-collapse:collapse">${rows}
<tr><td colspan="2" style="border-top:1px solid #f3e9dc;padding-top:6px"></td></tr>
${line('Subtotal', formatINR(p.subtotal))}${p.discount ? line('Discount', `−${formatINR(p.discount)}`) : ''}
${line('Shipping', p.shipping ? formatINR(p.shipping) : 'Free')}${p.codFee ? line('COD fee', formatINR(p.codFee)) : ''}
${line('Total', formatINR(p.total), true)}</table>`;
}

function composeOrderEmail(event: OrderEvent, order: IOrder & { _id: Types.ObjectId }, link: string): EmailMessage {
  const name = escapeHtml(order.customer.name.split(' ')[0] ?? 'there');
  const no = order.orderNumber;
  const s = order.shipment;
  const shipping =
    s?.courierName || s?.trackingNumber
      ? `<p>Courier: <strong>${escapeHtml(s.courierName ?? '—')}</strong><br/>Tracking number: <strong>${escapeHtml(s.trackingNumber ?? '—')}</strong></p>`
      : '';
  const map: Record<OrderEvent, { subject: string; title: string; body: string }> = {
    order_confirmation: {
      subject: `Order ${no} confirmed`,
      title: 'Thank you for your order!',
      body: `<p>Hi ${name}, we have received your order <strong>${no}</strong>${order.payment.method === 'cod' ? ' (Cash on Delivery)' : ''}. We will let you know when it ships.</p>${itemsTable(order)}`,
    },
    payment_confirmation: {
      subject: `Payment received for ${no}`,
      title: 'Payment received',
      body: `<p>Hi ${name}, your payment of <strong>${formatINR(order.payment.amountPaid)}</strong> for order <strong>${no}</strong> has been verified.</p>${itemsTable(order)}`,
    },
    shipment: {
      subject: `Your order ${no} has shipped`,
      title: 'Your order is on its way',
      body: `<p>Hi ${name}, good news — order <strong>${no}</strong> has been shipped.</p>${shipping}`,
    },
    delivery_update: {
      subject: order.status === 'delivered' ? `Order ${no} delivered` : `Order ${no} is out for delivery`,
      title: order.status === 'delivered' ? 'Delivered!' : 'Out for delivery',
      body:
        order.status === 'delivered'
          ? `<p>Hi ${name}, order <strong>${no}</strong> has been delivered. We hope you love it!</p>`
          : `<p>Hi ${name}, order <strong>${no}</strong> is out for delivery today.</p>${shipping}`,
    },
    cancellation: {
      subject: `Order ${no} cancelled`,
      title: 'Your order was cancelled',
      body: `<p>Hi ${name}, order <strong>${no}</strong> has been cancelled.${order.cancellation?.reason ? ` Reason: ${escapeHtml(order.cancellation.reason)}.` : ''}</p>${order.payment.amountPaid > 0 ? '<p>Any amount paid online will be refunded to the original payment method.</p>' : ''}`,
    },
    refund: {
      subject: `Refund update for ${no}`,
      title: 'Refund processed',
      body: `<p>Hi ${name}, a refund of <strong>${formatINR(order.payment.amountRefunded)}</strong> for order <strong>${no}</strong> has been processed. Banks usually take 5–7 business days to reflect it.</p>`,
    },
  };
  const m = map[event];
  const html = layout(m.title, m.body, { label: 'Track your order', url: link });
  const text = `${m.title}\n\nOrder ${no}\nTrack: ${link}`;
  return { to: order.customer.email, subject: m.subject, html, text };
}

async function record(data: {
  event: NotificationEvent;
  channel: 'email' | 'whatsapp';
  recipient: string;
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
  order?: Types.ObjectId | null;
  user?: Types.ObjectId | null;
  subject?: string;
  providerMessageId?: string;
}) {
  try {
    await Notification.create(data);
  } catch (err) {
    logger.error({ err }, 'failed to record notification');
  }
}

async function deliverEmail(
  event: NotificationEvent,
  message: EmailMessage,
  refs: { order?: Types.ObjectId | null; user?: Types.ObjectId | null },
) {
  const transport = getEmailTransport();
  if (!transport) {
    await record({ event, channel: 'email', recipient: message.to, status: 'skipped', reason: 'email_provider_not_configured', subject: message.subject, ...refs });
    return 'skipped' as const;
  }
  try {
    const { messageId } = await transport.send(message);
    await record({ event, channel: 'email', recipient: message.to, status: 'sent', subject: message.subject, providerMessageId: messageId, ...refs });
    return 'sent' as const;
  } catch (err) {
    logger.error({ err: (err as Error).message, event }, 'email send failed');
    await record({ event, channel: 'email', recipient: message.to, status: 'failed', reason: (err as Error).message?.slice(0, 200), subject: message.subject, ...refs });
    return 'failed' as const;
  }
}

async function sendOrderEvent(event: OrderEvent, orderId: Types.ObjectId | string) {
  const order = await Order.findById(orderId).select('+trackingSalt').lean();
  if (!order) return;
  const link = trackingUrl(order.orderNumber, trackingToken(String(order._id), order.trackingSalt));
  const refs = { order: order._id, user: order.user ?? null };
  await deliverEmail(event, composeOrderEmail(event, order, link), refs);

  // WhatsApp only with explicit opt-in AND a configured provider.
  const wa = getWhatsAppTransport();
  const recipient = order.customer.phone;
  if (!order.whatsappOptIn) {
    await record({ event, channel: 'whatsapp', recipient, status: 'skipped', reason: 'no_customer_opt_in', ...refs });
  } else if (!wa) {
    await record({ event, channel: 'whatsapp', recipient, status: 'skipped', reason: 'whatsapp_provider_not_configured', ...refs });
  } else {
    try {
      const { messageId } = await wa.sendTemplate(recipient, event, [order.customer.name, order.orderNumber, link]);
      await record({ event, channel: 'whatsapp', recipient, status: 'sent', providerMessageId: messageId, ...refs });
    } catch (err) {
      await record({ event, channel: 'whatsapp', recipient, status: 'failed', reason: (err as Error).message?.slice(0, 200), ...refs });
    }
  }
}

export const notifications = {
  /** Fire-and-forget: notification failures never break the order workflow. */
  orderEvent(event: OrderEvent, orderId: Types.ObjectId | string) {
    track(sendOrderEvent(event, orderId)).catch((err) => logger.error({ err, event }, 'order notification failed'));
  },

  async sendPasswordReset(user: HydratedDocument<IUser>, resetUrl: string, minutes: number) {
    const message: EmailMessage = {
      to: user.email,
      subject: 'Reset your password',
      html: layout(
        'Reset your password',
        `<p>Hi ${escapeHtml(user.name.split(' ')[0] ?? '')}, we received a request to reset your password. This link expires in ${minutes} minutes. If you did not request this, you can ignore this email.</p>`,
        { label: 'Choose a new password', url: resetUrl },
      ),
      text: `Reset your password (expires in ${minutes} minutes): ${resetUrl}`,
    };
    const status = await deliverEmail('password_reset', message, { user: user._id });
    if (status === 'skipped' && env.NODE_ENV === 'development') {
      // Local development convenience only — never in production.
      logger.info(`[dev] Email not configured. Password reset link for ${user.email}: ${resetUrl}`);
    }
  },

  async contactMessage(msg: { name: string; email: string; phone?: string; subject: string; message: string }) {
    const settings = await StoreSettings.findById('store').lean();
    const to = settings?.contact.email;
    if (!to) {
      await record({ event: 'contact_message', channel: 'email', recipient: 'store', status: 'skipped', reason: 'store_contact_email_not_set' });
      return;
    }
    await deliverEmail(
      'contact_message',
      {
        to,
        subject: `[Contact] ${msg.subject}`,
        html: layout('New contact message', `<p><strong>${escapeHtml(msg.name)}</strong> &lt;${escapeHtml(msg.email)}&gt; ${escapeHtml(msg.phone ?? '')}</p><p style="white-space:pre-wrap">${escapeHtml(msg.message)}</p>`),
        text: `${msg.name} <${msg.email}> ${msg.phone ?? ''}\n\n${msg.message}`,
      },
      {},
    );
  },

  /** Wait for in-flight notifications (used by tests and graceful shutdown). */
  async flush() {
    await Promise.allSettled([...pending]);
  },
};
