import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CreditCard, Lock, ShoppingBag } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { AddressFields, addressSchema, phoneSchema } from '../../components/store/AddressFields';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Alert, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { Checkbox, Input, Textarea } from '../../components/ui/Field';
import { useMe } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { useCartQuote, useDebounced, useDocumentTitle, useStoreSettings } from '../../hooks/useStore';
import { ApiError, api, errorMessage } from '../../lib/api';
import { cn, formatPrice } from '../../lib/format';
import { openRazorpay } from '../../lib/razorpay';
import { rememberOrderToken } from '../../lib/storage';
import type { Address, PlacedOrder } from '../../lib/types';
import { CouponBox, SummaryRows, useCouponCode } from './Cart';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter your name').max(100),
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    phone: phoneSchema,
    addressId: z.string(),
    address: z.unknown(),
    paymentMethod: z.enum(['razorpay', 'cod'], { error: 'Choose a payment method' }),
    whatsappOptIn: z.boolean(),
    saveAddress: z.boolean(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.addressId !== 'new') return;
    const r = addressSchema.safeParse(v.address);
    if (!r.success) for (const issue of r.error.issues) ctx.addIssue({ ...issue, path: ['address', ...issue.path] });
  });
type FormValues = z.input<typeof schema>;

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-checkout`);

function SectionCard({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-line bg-paper p-5 shadow-soft sm:p-7">
      <h2 className="flex items-center gap-3 text-2xl">
        <span className="arch flex h-8 w-7 items-end justify-center bg-blush-100 pb-1 font-sans text-xs font-semibold text-rose-700">{step}</span>
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function Checkout() {
  useDocumentTitle('Checkout');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { items, clear } = useCart();
  const { data: user } = useMe();
  const { data: settings } = useStoreSettings();
  const [coupon, setCoupon] = useCouponCode();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stage, setStage] = useState<'idle' | 'placing' | 'paying' | 'verifying'>('idle');
  const idempotencyKey = useRef(newKey());

  const addresses = useQuery({
    queryKey: ['account', 'addresses'],
    queryFn: () => api.get<{ items: Address[] }>('/account/addresses').then((r) => r.items),
    enabled: !!user,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', phone: '', addressId: 'new', address: {}, paymentMethod: 'razorpay', whatsappOptIn: false, saveAddress: true, note: '' },
  });
  const { register, handleSubmit, setValue, control, formState, setError } = form;
  const errors = formState.errors as Record<string, { message?: string } & Record<string, { message?: string }>>;

  useEffect(() => {
    if (!user) return;
    setValue('name', user.name);
    setValue('email', user.email);
    if (user.phone) setValue('phone', user.phone);
    setValue('whatsappOptIn', user.whatsappOptIn);
  }, [user, setValue]);

  useEffect(() => {
    const def = addresses.data?.find((a) => a.isDefault) ?? addresses.data?.[0];
    if (def) setValue('addressId', def._id);
  }, [addresses.data, setValue]);

  const [paymentMethod, phone, addressId] = useWatch({ control, name: ['paymentMethod', 'phone', 'addressId'] });
  const debouncedPhone = useDebounced(typeof phone === 'string' ? phone : '', 500);
  const quote = useCartQuote(items, { couponCode: coupon, paymentMethod, email: user?.email, phone: debouncedPhone });
  const q = quote.data;

  // Default to whichever payment method is actually available.
  useEffect(() => {
    if (!q) return;
    if (paymentMethod === 'razorpay' && !q.paymentMethods.razorpay.available && q.paymentMethods.cod.available) setValue('paymentMethod', 'cod');
    if (paymentMethod === 'cod' && !q.paymentMethods.cod.available && q.paymentMethods.razorpay.available) setValue('paymentMethod', 'razorpay');
  }, [q, paymentMethod, setValue]);

  const noMethods = q && !q.paymentMethods.razorpay.available && !q.paymentMethods.cod.available;
  const busy = stage !== 'idle';

  const onSubmit = handleSubmit(async (raw) => {
    const v = schema.parse(raw);
    if (!q || q.hasIssues) return;
    setSubmitError(null);
    const saved = addresses.data?.find((a) => a._id === v.addressId);
    const shippingAddress = saved
      ? { fullName: saved.fullName, phone: saved.phone, line1: saved.line1, line2: saved.line2, landmark: saved.landmark, city: saved.city, state: saved.state, pincode: saved.pincode }
      : (v.address as z.infer<typeof addressSchema>);

    setStage('placing');
    let placed: PlacedOrder;
    try {
      placed = await api.post<PlacedOrder>('/checkout/orders', {
        items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
        customer: { name: v.name, email: v.email, phone: v.phone },
        shippingAddress,
        couponCode: coupon || undefined,
        paymentMethod: v.paymentMethod,
        whatsappOptIn: v.whatsappOptIn,
        customerNote: v.note || undefined,
        saveAddress: !!user && !saved && v.saveAddress,
        expectedTotal: q.total,
        idempotencyKey: idempotencyKey.current,
      });
    } catch (err) {
      setStage('idle');
      if (err instanceof ApiError) {
        if (['PRICE_CHANGED', 'CART_CHANGED'].includes(err.code)) {
          qc.invalidateQueries({ queryKey: ['quote'] });
          setSubmitError(`${err.message} We’ve refreshed the totals below.`);
          return;
        }
        if (err.code === 'VALIDATION_ERROR') {
          for (const [k, msg] of Object.entries(err.fieldErrors)) {
            const path = k.replace(/^customer\./, '').replace(/^shippingAddress\./, 'address.');
            setError(path as never, { message: msg });
          }
        }
      }
      setSubmitError(errorMessage(err));
      return;
    }

    const { order, trackingToken, payment } = placed;
    rememberOrderToken(order.orderNumber, trackingToken);
    idempotencyKey.current = newKey();
    clear();
    setCoupon('');
    qc.invalidateQueries({ queryKey: ['account', 'orders'] });
    const orderUrl = `/track/${order.orderNumber}?token=${encodeURIComponent(trackingToken)}`;

    if (!payment) {
      navigate(`${orderUrl}&placed=1`, { replace: true });
      return;
    }

    setStage('paying');
    try {
      const resp = await openRazorpay(payment);
      if (!resp) {
        navigate(`${orderUrl}&payment=dismissed`, { replace: true });
        return;
      }
      setStage('verifying');
      await api.post('/payments/razorpay/verify', { orderNumber: order.orderNumber, ...resp });
      navigate(`${orderUrl}&placed=1`, { replace: true });
    } catch (err) {
      const pending = err instanceof ApiError && ['PAYMENT_PENDING', 'PAYMENT_LOOKUP_FAILED'].includes(err.code);
      navigate(`${orderUrl}&payment=${pending ? 'pending' : 'failed'}`, { replace: true });
    }
  });

  const summaryLines = useMemo(() => q?.lines ?? [], [q]);

  if (!items.length && stage === 'idle') {
    return (
      <div className="container-page py-10">
        <EmptyState icon={<ShoppingBag className="size-7" />} title="Your bag is empty" description="Add something lovely before checking out." action={<ButtonLink to="/shop">Shop now</ButtonLink>} />
      </div>
    );
  }

  const payLabel = paymentMethod === 'cod' ? 'Place order' : `Pay ${q ? formatPrice(q.total) : ''}`;

  return (
    <div className="container-page pb-10 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[40px] sm:text-[52px]">Checkout</h1>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Lock className="size-4 text-success" aria-hidden /> Secure checkout
        </p>
      </div>
      {!user && (
        <p className="mt-3 text-sm text-ink-soft">
          Have an account?{' '}
          <Link to="/login?next=/checkout" className="font-medium text-rose-700 underline underline-offset-2">
            Sign in
          </Link>{' '}
          for faster checkout and order history — or continue as a guest.
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-8 grid gap-8 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <SectionCard step={1} title="Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Full name" autoComplete="name" required {...register('name')} error={errors.name?.message} />
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                required
                readOnly={!!user}
                hint={user ? 'Order updates go to your account email.' : 'For your order confirmation and tracking link.'}
                {...register('email')}
                error={errors.email?.message}
              />
              <Input label="Mobile number" type="tel" inputMode="tel" autoComplete="tel-national" prefix="+91" required {...register('phone')} error={errors.phone?.message} />
            </div>
          </SectionCard>

          <SectionCard step={2} title="Delivery address">
            {!!addresses.data?.length && (
              <div className="mb-5 grid gap-3 sm:grid-cols-2">
                {addresses.data.map((a) => (
                  <label
                    key={a._id}
                    className={cn('cursor-pointer rounded-2xl border p-4 text-sm transition-colors', addressId === a._id ? 'border-rose-600 bg-blush-50' : 'border-line-strong hover:border-rose-600')}
                  >
                    <input type="radio" value={a._id} {...register('addressId')} className="sr-only" />
                    <span className="font-medium">{a.label ? `${a.label} · ` : ''}{a.fullName}</span>
                    <span className="mt-1 block text-ink-soft">
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.pincode}
                    </span>
                    <span className="mt-1 block text-muted">+91 {a.phone}</span>
                  </label>
                ))}
                <label className={cn('flex cursor-pointer items-center justify-center rounded-2xl border border-dashed p-4 text-sm font-medium', addressId === 'new' ? 'border-rose-600 bg-blush-50 text-rose-700' : 'border-line-strong text-ink-soft hover:border-rose-600')}>
                  <input type="radio" value="new" {...register('addressId')} className="sr-only" />+ Deliver to a new address
                </label>
              </div>
            )}
            {addressId === 'new' && (
              <>
                <AddressFields register={register} errors={errors.address as never} prefix="address." />
                {user && <Checkbox className="mt-4" label="Save this address to my account" {...register('saveAddress')} />}
              </>
            )}
          </SectionCard>

          <SectionCard step={3} title="Payment">
            {noMethods && (
              <Alert tone="warning" className="mb-4" title="Checkout is temporarily unavailable">
                No payment method is available for this order right now. Please contact us on WhatsApp to order.
              </Alert>
            )}
            <div className="grid gap-3">
              <PaymentOption
                value="razorpay"
                checked={paymentMethod === 'razorpay'}
                disabled={!q?.paymentMethods.razorpay.available}
                register={register}
                icon={<CreditCard className="size-5" />}
                title="Pay online"
                description={
                  q?.paymentMethods.razorpay.available
                    ? `UPI, cards, net banking & wallets via Razorpay${settings?.payments.razorpay.mode === 'test' ? ' (test mode — no real money is charged)' : ''}`
                    : q?.paymentMethods.razorpay.reason ?? 'Checking availability…'
                }
              />
              <PaymentOption
                value="cod"
                checked={paymentMethod === 'cod'}
                disabled={!q?.paymentMethods.cod.available}
                register={register}
                icon={<Banknote className="size-5" />}
                title="Cash on Delivery"
                description={
                  q?.paymentMethods.cod.available
                    ? `Pay when your order arrives${q.paymentMethods.cod.fee ? ` · ${formatPrice(q.paymentMethods.cod.fee)} COD fee` : ''}`
                    : q?.paymentMethods.cod.reason ?? 'Checking availability…'
                }
              />
            </div>
            {errors.paymentMethod?.message && <p className="mt-2 text-xs text-danger">{errors.paymentMethod.message}</p>}
            <div className="mt-6 space-y-4">
              <Checkbox
                label="Send me order updates on WhatsApp"
                description="Optional. We’ll only message you about this order. You can opt out anytime."
                {...register('whatsappOptIn')}
              />
              <Textarea label="Note for us (optional)" rows={2} maxLength={500} placeholder="Gift message, delivery instructions…" {...register('note')} error={errors.note?.message} />
            </div>
          </SectionCard>
        </div>

        <aside className="h-fit space-y-5 rounded-[24px] border border-line bg-paper p-6 shadow-soft lg:sticky lg:top-32" aria-label="Order summary">
          <h2 className="text-2xl">Your order</h2>
          {quote.isLoading || !q ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {summaryLines.map((l) => (
                  <li key={l.key} className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      {l.image ? <img src={l.image} alt="" className="size-14 rounded-xl bg-blush-50 object-cover" /> : <div className="size-14 rounded-xl bg-blush-50" />}
                      <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-ivory">{l.quantity}</span>
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="line-clamp-1 font-medium">{l.name}</p>
                      {l.variantLabel && <p className="text-xs text-muted">{l.variantLabel}</p>}
                      {l.issue && <p className="text-xs font-medium text-danger">Unavailable — update your bag</p>}
                    </div>
                    <span className="text-sm font-medium">{formatPrice(l.lineTotal || l.unitPrice * l.quantity)}</span>
                  </li>
                ))}
              </ul>
              <CouponBox code={coupon} setCode={setCoupon} quote={q} />
              <SummaryRows quote={q} showCod />
            </>
          )}
          {q?.hasIssues && (
            <Alert tone="warning">
              Some items changed. <Link to="/cart" className="font-medium underline">Review your bag</Link>.
            </Alert>
          )}
          {submitError && <Alert tone="danger">{submitError}</Alert>}
          <Button type="submit" size="lg" block loading={busy} disabled={!q || q.hasIssues || !!noMethods || busy}>
            {stage === 'placing' ? 'Placing order…' : stage === 'paying' ? 'Waiting for payment…' : stage === 'verifying' ? 'Confirming payment…' : payLabel}
          </Button>
          <p className="text-center text-xs leading-relaxed text-muted">
            By placing your order you agree to our <Link to="/terms" className="underline">terms</Link> and{' '}
            <Link to="/returns" className="underline">returns policy</Link>.
          </p>
        </aside>
      </form>
    </div>
  );
}

function PaymentOption({
  value,
  checked,
  disabled,
  register,
  icon,
  title,
  description,
}: {
  value: 'razorpay' | 'cod';
  checked: boolean;
  disabled?: boolean;
  register: ReturnType<typeof useForm<FormValues>>['register'];
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-4 rounded-2xl border p-4 transition-colors',
        disabled ? 'cursor-not-allowed border-line bg-cream/60 opacity-70' : 'cursor-pointer',
        checked && !disabled ? 'border-rose-600 bg-blush-50' : !disabled && 'border-line-strong hover:border-rose-600',
      )}
    >
      <input type="radio" value={value} disabled={disabled} {...register('paymentMethod')} className="mt-1 size-4 accent-rose-600" />
      <span className={cn('mt-0.5', checked ? 'text-rose-700' : 'text-muted')}>{icon}</span>
      <span className="text-sm">
        <span className="block font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-muted">{description}</span>
      </span>
    </label>
  );
}
