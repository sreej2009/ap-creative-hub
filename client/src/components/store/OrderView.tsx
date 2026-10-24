import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Copy, ExternalLink, Package, Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { PAYMENT_STATUS_LABELS, statusTone } from '../../lib/constants';
import { cn, formatDate, formatDateTime, formatPrice } from '../../lib/format';
import { openRazorpay } from '../../lib/razorpay';
import type { CustomerOrder, OrderStatus, RazorpayCheckout } from '../../lib/types';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { Alert, Badge } from '../ui/Feedback';
import { Sparkle } from '../ui/Icons';
import { useToast } from '../ui/Toast';

const PROGRESS: OrderStatus[] = ['placed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered'];
const PROGRESS_LABEL: Record<string, string> = {
  placed: 'Confirmed',
  processing: 'Processing',
  packed: 'Packed',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

function progressIndex(status: OrderStatus) {
  if (status === 'payment_confirmed') return 0;
  if (['return_requested', 'returned', 'refunded'].includes(status)) return PROGRESS.length - 1;
  return PROGRESS.indexOf(status);
}

function ProgressBar({ status }: { status: OrderStatus }) {
  const idx = progressIndex(status);
  if (status === 'cancelled' || status === 'pending_payment' || idx < 0) return null;
  return (
    <ol className="grid grid-cols-6 gap-1" aria-label="Order progress">
      {PROGRESS.map((s, i) => (
        <li key={s} className="flex flex-col items-center gap-2 text-center">
          <span className={cn('h-1.5 w-full rounded-full', i <= idx ? 'bg-gradient-to-r from-rose-500 to-gold-400' : 'bg-line')} />
          <span className={cn('hidden text-[11px] sm:block', i <= idx ? 'font-medium text-ink' : 'text-muted')} aria-current={i === idx ? 'step' : undefined}>
            {PROGRESS_LABEL[s]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Timeline({ order }: { order: CustomerOrder }) {
  const entries = [...order.timeline].reverse();
  return (
    <ol className="relative space-y-6 border-l border-gold-300 pl-6">
      {entries.map((t, i) => (
        <li key={`${t.status}-${t.at}`} className="relative">
          <span className={cn('absolute -left-[31px] top-1 flex size-3.5 items-center justify-center rounded-full ring-4 ring-paper', i === 0 ? 'bg-rose-600' : 'bg-gold-400')} />
          <p className={cn('font-medium', i === 0 ? 'text-ink' : 'text-ink-soft')}>{t.label}</p>
          <p className="text-xs text-muted">
            {formatDateTime(t.at)} · {t.by}
          </p>
          {t.note && <p className="mt-1 text-sm text-ink-soft">{t.note}</p>}
        </li>
      ))}
    </ol>
  );
}

export function OrderView({
  order,
  token,
  celebrate,
  paymentNotice,
  queryKey,
}: {
  order: CustomerOrder;
  token?: string;
  celebrate?: boolean;
  paymentNotice?: 'dismissed' | 'pending' | 'failed' | null;
  queryKey: unknown[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey });

  const cancel = useMutation({
    mutationFn: (reason: string) => api.post(`/track/${order.orderNumber}/cancel`, { reason, token }),
    onSuccess: () => {
      setCancelOpen(false);
      toast('Your order has been cancelled');
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const requestReturn = useMutation({
    mutationFn: (reason: string) => api.post(`/track/${order.orderNumber}/return`, { reason, token }),
    onSuccess: () => {
      setReturnOpen(false);
      toast('Return requested — we’ll be in touch shortly');
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const pay = useMutation({
    mutationFn: async () => {
      const { payment } = await api.post<{ payment: RazorpayCheckout }>('/payments/razorpay/retry', { orderNumber: order.orderNumber, token });
      const resp = await openRazorpay(payment);
      if (!resp) return 'dismissed';
      await api.post('/payments/razorpay/verify', { orderNumber: order.orderNumber, ...resp });
      return 'paid';
    },
    onSuccess: (r) => {
      if (r === 'paid') toast('Payment received — thank you!');
      refresh();
    },
    onError: (e) => {
      toast(errorMessage(e), 'error');
      refresh();
    },
  });

  const s = order.shipment;
  const a = order.shippingAddress;
  const isPaidOnline = order.payment.method === 'razorpay' && order.payment.status === 'paid';

  return (
    <div className="space-y-6">
      {celebrate && order.status !== 'pending_payment' && (
        <div className="relative overflow-hidden rounded-[28px] bg-plum-900 px-6 py-10 text-center text-ivory">
          <Sparkle aria-hidden className="absolute left-[10%] top-6 size-5 animate-twinkle text-gold-400" />
          <Sparkle aria-hidden className="absolute bottom-8 right-[12%] size-3.5 animate-twinkle text-blush-300 [animation-delay:1s]" />
          <CircleCheck className="mx-auto size-10 text-gold-300" aria-hidden />
          <h2 className="mt-3 text-[34px] text-white">Thank you, {order.customer.name.split(' ')[0]}!</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[#d8c7c4]">
            Your order <strong className="text-white">{order.orderNumber}</strong> is confirmed.{' '}
            {order.customer.email ? `We’ve sent the details to ${order.customer.email}.` : 'Keep this page’s link to track your order.'}
          </p>
        </div>
      )}

      {order.status === 'pending_payment' && (
        <Alert
          tone={paymentNotice === 'failed' ? 'danger' : 'warning'}
          title={paymentNotice === 'pending' ? 'Payment is being confirmed' : 'Payment not completed yet'}
          action={
            order.actions.canPay && (
              <Button size="sm" onClick={() => pay.mutate()} loading={pay.isPending}>
                Complete payment
              </Button>
            )
          }
        >
          {paymentNotice === 'pending'
            ? 'If money was debited, this page will update automatically once Razorpay confirms it. Please don’t pay twice.'
            : order.reservationExpiresAt
              ? `We’re holding your items until ${formatDateTime(order.reservationExpiresAt)}. Complete payment before then to confirm the order.`
              : 'Complete payment to confirm your order.'}
        </Alert>
      )}

      <div className="rounded-[24px] border border-line bg-paper p-5 shadow-soft sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Order</p>
            <h1 className="mt-1 flex items-center gap-2 text-[32px] sm:text-[40px]">
              {order.orderNumber}
              <button
                type="button"
                aria-label="Copy order number"
                onClick={() => navigator.clipboard?.writeText(order.orderNumber).then(() => toast('Order number copied'))}
                className="rounded-full p-1.5 text-muted hover:bg-blush-50 hover:text-rose-700"
              >
                <Copy className="size-4" />
              </button>
            </h1>
            <p className="text-sm text-muted">Placed {formatDateTime(order.createdAt)}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={statusTone(order.status)} className="text-xs">
              {order.statusLabel}
            </Badge>
            <span className="text-xs text-muted">
              {order.payment.method === 'cod' ? 'Cash on Delivery' : 'Paid online'} · {PAYMENT_STATUS_LABELS[order.payment.status]}
            </span>
          </div>
        </div>
        <div className="mt-6">
          <ProgressBar status={order.status} />
        </div>

        {(s.courierName || s.trackingNumber) && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-blush-50 p-4">
            <div className="flex items-center gap-3">
              <Truck className="size-6 text-rose-600" aria-hidden />
              <div className="text-sm">
                <p className="font-medium">{s.courierName}</p>
                <p className="text-ink-soft">
                  Tracking no. <span className="font-mono">{s.trackingNumber}</span>
                  {s.shippedAt && <> · shipped {formatDate(s.shippedAt)}</>}
                </p>
              </div>
            </div>
            {s.trackingUrl && (
              <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-paper px-4 py-2 text-sm font-medium text-rose-700 shadow-soft hover:bg-white">
                Track with courier <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        )}
        {order.status === 'cancelled' && order.cancellation && (
          <Alert tone="danger" className="mt-6" title="This order was cancelled">
            {order.cancellation.reason}
            {isPaidOnline && ' Your payment will be refunded to the original payment method.'}
          </Alert>
        )}
        {order.returnRequest && (
          <Alert tone="info" className="mt-6" title={order.status === 'return_requested' ? 'Return requested' : `Return ${order.returnRequest.resolution ?? 'update'}`}>
            {order.returnRequest.reason}
          </Alert>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="rounded-[24px] border border-line bg-paper p-5 shadow-soft sm:p-7">
            <h2 className="flex items-center gap-2 text-2xl">
              <Package className="size-5 text-gold-500" aria-hidden /> Items
            </h2>
            <ul className="mt-4 divide-y divide-line">
              {order.items.map((i) => (
                <li key={i.sku} className="flex items-center gap-4 py-3">
                  {i.image ? <img src={i.image} alt="" className="size-16 rounded-xl bg-blush-50 object-cover" /> : <div className="size-16 rounded-xl bg-blush-50" />}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{i.name}</p>
                    <p className="text-muted">
                      {i.variantLabel ? `${i.variantLabel} · ` : ''}Qty {i.quantity} × {formatPrice(i.unitPrice)}
                    </p>
                  </div>
                  <span className="text-sm font-semibold">{formatPrice(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd>{formatPrice(order.pricing.subtotal)}</dd>
              </div>
              {order.pricing.discount > 0 && (
                <div className="flex justify-between text-success">
                  <dt>Discount{order.coupon ? ` (${order.coupon.code})` : ''}</dt>
                  <dd>−{formatPrice(order.pricing.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-muted">Shipping</dt>
                <dd>{order.pricing.shipping ? formatPrice(order.pricing.shipping) : 'Free'}</dd>
              </div>
              {order.pricing.codFee > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted">COD fee</dt>
                  <dd>{formatPrice(order.pricing.codFee)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd>{formatPrice(order.pricing.total)}</dd>
              </div>
              {order.payment.amountRefunded > 0 && (
                <div className="flex justify-between text-[#2c5680]">
                  <dt>Refunded</dt>
                  <dd>{formatPrice(order.payment.amountRefunded)}</dd>
                </div>
              )}
            </dl>
          </section>

          {order.courierEvents.length > 0 && (
            <section className="rounded-[24px] border border-line bg-paper p-5 shadow-soft sm:p-7">
              <h2 className="text-2xl">Courier updates</h2>
              <ul className="mt-4 space-y-3 text-sm">
                {order.courierEvents.map((e) => (
                  <li key={e.at + e.status}>
                    <p className="font-medium">{e.status}</p>
                    <p className="text-muted">
                      {formatDateTime(e.at)}
                      {e.location ? ` · ${e.location}` : ''} · via {e.source}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="rounded-[24px] border border-line bg-paper p-5 shadow-soft sm:p-6">
            <h2 className="text-2xl">Tracking</h2>
            <div className="mt-5">
              <Timeline order={order} />
            </div>
          </section>
          <section className="rounded-[24px] border border-line bg-paper p-5 text-sm shadow-soft sm:p-6">
            <h2 className="text-2xl">Delivery</h2>
            <p className="mt-3 font-medium">{a.fullName}</p>
            {a.line1 ? (
              <p className="text-ink-soft">
                {a.line1}
                {a.line2 ? `, ${a.line2}` : ''}
                {a.landmark ? ` (near ${a.landmark})` : ''}
                <br />
                {a.city}, {a.state} {a.pincode}
                <br />
                +91 {a.phone}
              </p>
            ) : (
              <p className="text-ink-soft">
                {a.city}, {a.state} {a.pincode}
              </p>
            )}
          </section>
          {(order.actions.canCancel || order.actions.canRequestReturn) && (
            <div className="flex flex-col gap-2">
              {order.actions.canCancel && (
                <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                  Cancel order
                </Button>
              )}
              {order.actions.canRequestReturn && (
                <Button variant="secondary" onClick={() => setReturnOpen(true)}>
                  Request a return
                </Button>
              )}
            </div>
          )}
          <Button variant="link" onClick={() => navigate('/contact')} className="w-full justify-center text-sm">
            Need help with this order?
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={(reason) => cancel.mutate(reason)}
        loading={cancel.isPending}
        title="Cancel this order?"
        description={isPaidOnline ? 'Your payment will be refunded to the original method within 5–7 business days.' : 'Your items will be released and you won’t be charged.'}
        confirmLabel="Cancel order"
        tone="danger"
        requireReason
        reasonLabel="Why are you cancelling?"
      />
      <ConfirmDialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onConfirm={(reason) => requestReturn.mutate(reason)}
        loading={requestReturn.isPending}
        title="Request a return"
        description="Tell us what went wrong. We’ll reply with pickup or drop-off instructions."
        confirmLabel="Request return"
        requireReason
        reasonLabel="What’s the issue? (at least 10 characters)"
      />
    </div>
  );
}
