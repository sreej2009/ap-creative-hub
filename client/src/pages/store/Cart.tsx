import { ShoppingBag, Tag, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FreeShippingMeter, issueText } from '../../components/store/CartDrawer';
import { PriceTag } from '../../components/store/ProductCard';
import { QuantityStepper } from '../../components/store/QuantityStepper';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Alert, EmptyState, Skeleton } from '../../components/ui/Feedback';
import { useMe } from '../../hooks/useAuth';
import { cartKey, useCart } from '../../hooks/useCart';
import { useCartQuote, useDocumentTitle } from '../../hooks/useStore';
import { readJSON, writeJSON } from '../../lib/storage';
import { formatPrice } from '../../lib/format';
import type { CartQuote } from '../../lib/types';

const COUPON_KEY = 'ap_coupon';

export function useCouponCode() {
  const [code, setCode] = useState<string>(() => readJSON<string>(COUPON_KEY, ''));
  useEffect(() => writeJSON(COUPON_KEY, code), [code]);
  return [code, setCode] as const;
}

export function CouponBox({ code, setCode, quote }: { code: string; setCode: (c: string) => void; quote?: CartQuote }) {
  const [input, setInput] = useState(code);
  useEffect(() => setInput(code), [code]);
  const c = quote?.coupon;
  const apply = () => {
    if (input.trim()) setCode(input.trim().toUpperCase());
  };
  // Not a <form>: this box is also rendered inside the checkout form, and nested
  // forms would send "Apply" to the checkout form instead.
  return (
    <div>
      <div role="group" aria-label="Coupon" className="flex gap-2">
        <label htmlFor="coupon" className="sr-only">
          Coupon code
        </label>
        <div className="relative flex-1">
          <Tag className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id="coupon"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); // don't submit the surrounding checkout form
                apply();
              }
            }}
            placeholder="Coupon code"
            maxLength={30}
            className="h-11 w-full rounded-full border border-line-strong bg-paper pl-9 pr-3 text-sm uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal focus:border-rose-600 focus:outline-none"
          />
        </div>
        <Button type="button" variant="secondary" disabled={!input.trim()} onClick={apply}>
          Apply
        </Button>
      </div>
      {c && code && (
        <div className="mt-2 flex items-center justify-between text-[13px]">
          {c.valid ? (
            <span className="font-medium text-success">
              {c.code} applied — you save {formatPrice(c.discount)}
            </span>
          ) : (
            <span className="text-danger">{c.message}</span>
          )}
          <button type="button" className="text-muted underline underline-offset-2 hover:text-rose-700" onClick={() => setCode('')}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

export function SummaryRows({ quote, showCod = false }: { quote: CartQuote; showCod?: boolean }) {
  return (
    <dl className="space-y-2.5 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted">Subtotal ({quote.itemCount} items)</dt>
        <dd>{formatPrice(quote.subtotal)}</dd>
      </div>
      {quote.discount > 0 && (
        <div className="flex justify-between text-success">
          <dt>Discount</dt>
          <dd>−{formatPrice(quote.discount)}</dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt className="text-muted">Shipping</dt>
        <dd>{quote.shipping ? formatPrice(quote.shipping) : <span className="font-medium text-success">Free</span>}</dd>
      </div>
      {showCod && quote.codFee > 0 && (
        <div className="flex justify-between">
          <dt className="text-muted">Cash on Delivery fee</dt>
          <dd>{formatPrice(quote.codFee)}</dd>
        </div>
      )}
      <div className="flex items-baseline justify-between border-t border-line pt-3">
        <dt className="font-medium">Total</dt>
        <dd className="text-xl font-semibold">{formatPrice(quote.total)}</dd>
      </div>
    </dl>
  );
}

export default function Cart() {
  useDocumentTitle('Your bag');
  const { items, setQuantity, remove } = useCart();
  const { data: user } = useMe();
  const [coupon, setCoupon] = useCouponCode();
  const { data: quote, isLoading, isFetching } = useCartQuote(items, { couponCode: coupon, email: user?.email });
  const lines = new Map(quote?.lines.map((l) => [l.key, l]));

  if (!items.length) {
    return (
      <div className="container-page py-10">
        <EmptyState icon={<ShoppingBag className="size-7" />} title="Your bag is empty" description="Find something lovely — new pieces arrive every week." action={<ButtonLink to="/shop">Start shopping</ButtonLink>} />
      </div>
    );
  }

  return (
    <div className="container-page pb-10 pt-8">
      <h1 className="text-[40px] sm:text-[52px]">Your bag</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          {quote?.hasIssues && (
            <Alert tone="warning" className="mb-4" title="Some items need your attention">
              Stock or availability changed for items marked below.
            </Alert>
          )}
          <ul className="divide-y divide-line border-y border-line">
            {items.map((item) => {
              const key = cartKey(item);
              const line = lines.get(key);
              const issue = line ? issueText(line) : null;
              return (
                <li key={key} className="flex gap-4 py-5">
                  <Link to={`/product/${item.slug}`} className="shrink-0 overflow-hidden rounded-2xl bg-blush-50">
                    {item.image ? <img src={item.image} alt="" className="size-24 object-cover sm:size-28" /> : <div className="size-24 sm:size-28" />}
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <Link to={`/product/${item.slug}`} className="font-display text-xl leading-snug hover:text-rose-700">
                        {item.name}
                      </Link>
                      {item.variantLabel && <p className="text-sm text-muted">{item.variantLabel}</p>}
                      <div className="mt-1">{line ? <PriceTag price={line.unitPrice} compareAt={line.compareAtPrice} /> : <Skeleton className="h-4 w-16" />}</div>
                      {issue && (
                        <p className="mt-1.5 text-[13px] font-medium text-danger">
                          {issue}{' '}
                          {line?.issue === 'insufficient_stock' && line.maxQuantity > 0 && (
                            <button type="button" className="underline underline-offset-2" onClick={() => setQuantity(key, line.maxQuantity)}>
                              Set to {line.maxQuantity}
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <QuantityStepper value={item.quantity} onChange={(q) => setQuantity(key, q)} max={line?.maxQuantity || 20} label={item.name} />
                      <button type="button" onClick={() => remove(key)} aria-label={`Remove ${item.name}`} className="rounded-full p-2 text-muted hover:bg-blush-50 hover:text-danger">
                        <Trash className="size-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Link to="/shop" className="mt-5 inline-block text-sm text-rose-700 underline underline-offset-4">
            ← Continue shopping
          </Link>
        </div>

        <aside className="h-fit rounded-[24px] border border-line bg-paper p-6 shadow-soft lg:sticky lg:top-32" aria-label="Order summary">
          <h2 className="text-2xl">Summary</h2>
          <div className="mt-5 space-y-5">
            {quote && <FreeShippingMeter amountToFree={quote.shippingInfo.amountToFreeShipping} threshold={quote.shippingInfo.freeShippingThreshold} />}
            <CouponBox code={coupon} setCode={setCoupon} quote={quote} />
            {isLoading || !quote ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (
              <div className={isFetching ? 'opacity-70 transition-opacity' : ''}>
                <SummaryRows quote={quote} />
              </div>
            )}
            <ButtonLink to="/checkout" block size="lg" aria-disabled={!quote || quote.hasIssues} className={!quote || quote.hasIssues ? 'pointer-events-none opacity-50' : ''}>
              Checkout securely
            </ButtonLink>
            <p className="text-center text-xs text-muted">Taxes included. Prices are confirmed at checkout.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
