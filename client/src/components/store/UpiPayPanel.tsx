import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Copy, QrCode, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useStoreSettings } from '../../hooks/useStore';
import { ApiError, api, errorMessage } from '../../lib/api';
import { formatDateTime, formatPrice } from '../../lib/format';
import type { CustomerOrder } from '../../lib/types';
import { Button } from '../ui/Button';
import { Alert, Skeleton } from '../ui/Feedback';
import { Input } from '../ui/Field';
import { useToast } from '../ui/Toast';

const schema = z.object({
  payerName: z.string().trim().min(2, 'Enter the name on your UPI account').max(100),
  payerUpiId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/, 'Enter your UPI ID, e.g. name@okaxis'),
  utr: z
    .string()
    .transform((v) => v.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{12}$/, 'Enter the 12-digit UPI transaction ID (UTR) from your receipt')),
});
type FormValues = z.input<typeof schema>;

/** `upi://pay` link understood by every UPI app; the QR encodes the same link. */
export function upiPayLink(vpa: string, payeeName: string, amountPaise: number, note: string) {
  const parts = [
    `pa=${encodeURIComponent(vpa)}`,
    `pn=${encodeURIComponent(payeeName)}`,
    `am=${(amountPaise / 100).toFixed(2)}`,
    'cu=INR',
    `tn=${encodeURIComponent(note)}`,
  ];
  return `upi://pay?${parts.join('&')}`;
}

const isMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Manual UPI payment: show a QR for the exact amount, then collect the payer's
 * details and UTR so the store can find the payment in their bank app.
 */
export function UpiPayPanel({ order, token, onSubmitted }: { order: CustomerOrder; token?: string; onSubmitted: () => void }) {
  const toast = useToast();
  const { data: settings, isLoading } = useStoreSettings();
  const upi = settings?.payments.upi;
  const [qr, setQr] = useState<string | null>(null);
  const amount = order.pricing.total;
  const link = upi?.vpa ? upiPayLink(upi.vpa, upi.payeeName || 'A&P Creative Hub', amount, order.orderNumber) : null;

  useEffect(() => {
    if (!link) return;
    let alive = true;
    QRCode.toDataURL(link, { width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2b1d1f', light: '#ffffff' } })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [link]);

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { payerName: order.customer.name, payerUpiId: '', utr: '' } });
  const { register, handleSubmit, formState, setError } = form;

  const submit = useMutation({
    mutationFn: (v: z.output<typeof schema>) => api.post('/payments/upi/submit', { orderNumber: order.orderNumber, token, ...v }),
    onSuccess: () => {
      toast('Thanks! We’ll confirm your payment shortly.');
      onSubmitted();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR') {
        for (const [k, msg] of Object.entries(e.fieldErrors)) setError(k as keyof FormValues, { message: msg });
        return;
      }
      if (e instanceof ApiError && e.code === 'UTR_ALREADY_USED') {
        setError('utr', { message: e.message });
        return;
      }
      toast(errorMessage(e), 'error');
      if (e instanceof ApiError && ['PAYMENT_WINDOW_EXPIRED', 'ALREADY_SUBMITTED', 'ORDER_CHANGED', 'NOT_AWAITING_PAYMENT'].includes(e.code)) onSubmitted();
    },
  });

  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => toast(`${what} copied`));

  if (isLoading) return <Skeleton className="h-96 w-full rounded-[24px]" />;
  if (!upi?.enabled || !upi.vpa) {
    return (
      <Alert tone="warning" title="UPI payment is unavailable right now">
        Please message us on WhatsApp with your order number {order.orderNumber} and we’ll help you complete the payment.
      </Alert>
    );
  }

  return (
    <section className="rounded-[24px] border border-rose-200 bg-paper p-5 shadow-soft sm:p-7" aria-labelledby="upi-pay-title">
      <h2 id="upi-pay-title" className="flex items-center gap-2 text-2xl">
        <QrCode className="size-5 text-rose-600" aria-hidden /> Pay {formatPrice(amount)} by UPI
      </h2>
      {order.reservationExpiresAt && (
        <p className="mt-1 text-sm text-muted">We’re holding your items until {formatDateTime(order.reservationExpiresAt)}. Please pay and submit the details below before then.</p>
      )}

      <div className="mt-6 grid gap-8 md:grid-cols-[240px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <p className="self-start text-sm font-medium md:self-center">1. Scan and pay</p>
          <div className="rounded-2xl border border-line bg-white p-3">
            {qr ? <img src={qr} alt={`UPI QR code to pay ${formatPrice(amount)} to ${upi.vpa}`} className="size-52" /> : <Skeleton className="size-52" />}
          </div>
          <p className="text-center text-xs text-muted">Google Pay, PhonePe, Paytm, BHIM or any UPI app</p>
          {link && isMobile() && (
            <a href={link} className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">
              <Smartphone className="size-4" aria-hidden /> Open UPI app
            </a>
          )}
          <dl className="w-full space-y-1.5 rounded-2xl bg-blush-50 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted">UPI ID</dt>
              <dd className="flex items-center gap-1 font-mono text-xs">
                {upi.vpa}
                <button type="button" aria-label="Copy UPI ID" onClick={() => copy(upi.vpa!, 'UPI ID')} className="rounded-full p-1 text-muted hover:text-rose-700">
                  <Copy className="size-3.5" />
                </button>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Amount</dt>
              <dd className="font-semibold">{formatPrice(amount)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Note</dt>
              <dd className="font-mono text-xs">{order.orderNumber}</dd>
            </div>
          </dl>
        </div>

        <form
          noValidate
          onSubmit={handleSubmit((raw) => submit.mutate(schema.parse(raw)))}
          className="space-y-4"
        >
          <p className="text-sm font-medium">2. Tell us about your payment</p>
          <p className="text-sm text-ink-soft">
            Pay exactly <strong>{formatPrice(amount)}</strong>. After paying, open the payment in your UPI app and copy the <strong>UPI transaction ID</strong> (also called UTR or UPI Ref No. — a 12-digit number).
          </p>
          <Input label="Name on your UPI / bank account" autoComplete="name" required {...register('payerName')} error={formState.errors.payerName?.message} />
          <Input label="Your UPI ID" placeholder="yourname@okaxis" autoCapitalize="none" autoCorrect="off" spellCheck={false} required {...register('payerUpiId')} error={formState.errors.payerUpiId?.message} />
          <Input
            label="UPI transaction ID (UTR)"
            placeholder="12-digit number"
            inputMode="numeric"
            autoComplete="off"
            maxLength={16}
            required
            {...register('utr')}
            error={formState.errors.utr?.message}
          />
          <Button type="submit" block loading={submit.isPending}>
            I’ve paid — submit details
          </Button>
          <p className="text-xs leading-relaxed text-muted">
            We check every payment by hand before confirming your order, usually within a few hours during business hours. Please don’t pay twice — if something went wrong, message us with your order number.
          </p>
        </form>
      </div>
    </section>
  );
}
