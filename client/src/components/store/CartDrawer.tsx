import { ShoppingBag, Trash, Truck } from 'lucide-react';
import { Link } from 'react-router';
import { cartKey, useCart } from '../../hooks/useCart';
import { useCartQuote } from '../../hooks/useStore';
import { formatPrice } from '../../lib/format';
import type { QuoteLine } from '../../lib/types';
import { ButtonLink } from '../ui/Button';
import { Drawer } from '../ui/Dialog';
import { EmptyState, Skeleton } from '../ui/Feedback';
import { QuantityStepper } from './QuantityStepper';

export function issueText(line: QuoteLine) {
  switch (line.issue) {
    case 'unavailable':
      return 'No longer available — please remove.';
    case 'variant_required':
    case 'variant_unavailable':
      return 'Please choose an option on the product page.';
    case 'out_of_stock':
      return 'Sold out — please remove.';
    case 'insufficient_stock':
      return `Only ${line.available} left — reduce the quantity.`;
    default:
      return null;
  }
}

export function FreeShippingMeter({ amountToFree, threshold }: { amountToFree: number; threshold: number }) {
  if (threshold <= 0) return null;
  const pct = Math.min(100, Math.round(((threshold - amountToFree) / threshold) * 100));
  return (
    <div className="rounded-2xl bg-blush-50 px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] text-ink-soft">
        <Truck className="size-4 text-rose-600" aria-hidden />
        {amountToFree > 0 ? (
          <span>
            Add <strong className="text-rose-700">{formatPrice(amountToFree)}</strong> more for free shipping
          </span>
        ) : (
          <span className="font-medium text-success">You’ve unlocked free shipping ✦</span>
        )}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blush-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to free shipping">
        <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-gold-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CartDrawer() {
  const { items, drawerOpen, setDrawerOpen, setQuantity, remove } = useCart();
  const { data: quote, isLoading } = useCartQuote(items, { enabled: drawerOpen });
  const lines = new Map(quote?.lines.map((l) => [l.key, l]));
  const close = () => setDrawerOpen(false);

  return (
    <Drawer
      open={drawerOpen}
      onClose={close}
      title="Your bag"
      footer={
        items.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted">Subtotal</span>
              {quote ? <span className="text-lg font-semibold">{formatPrice(quote.subtotal)}</span> : <Skeleton className="h-5 w-20" />}
            </div>
            <p className="text-xs text-muted">Shipping and discounts are calculated at checkout.</p>
            <div className="grid grid-cols-2 gap-2">
              <ButtonLink to="/cart" variant="secondary" onClick={close}>
                View bag
              </ButtonLink>
              <ButtonLink to="/checkout" onClick={close} aria-disabled={quote?.hasIssues}>
                Checkout
              </ButtonLink>
            </div>
          </div>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="size-7" />}
          title="Your bag is empty"
          description="Little sparkles are waiting for you."
          action={
            <ButtonLink to="/shop" onClick={close}>
              Start shopping
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-4 p-5">
          {quote && <FreeShippingMeter amountToFree={quote.shippingInfo.amountToFreeShipping} threshold={quote.shippingInfo.freeShippingThreshold} />}
          <ul className="divide-y divide-line">
            {items.map((item) => {
              const key = cartKey(item);
              const line = lines.get(key);
              const issue = line ? issueText(line) : null;
              return (
                <li key={key} className="flex gap-3 py-4">
                  <Link to={`/product/${item.slug}`} onClick={close} className="shrink-0 overflow-hidden rounded-2xl bg-blush-50">
                    {item.image ? <img src={item.image} alt="" className="size-20 object-cover" /> : <div className="size-20" />}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/product/${item.slug}`} onClick={close} className="line-clamp-2 font-display text-lg leading-snug">
                      {item.name}
                    </Link>
                    {item.variantLabel && <p className="text-xs text-muted">{item.variantLabel}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <QuantityStepper
                        size="sm"
                        value={item.quantity}
                        max={line?.maxQuantity || 20}
                        onChange={(q) => setQuantity(key, q)}
                        label={item.name}
                      />
                      {isLoading && !line ? (
                        <Skeleton className="h-4 w-14" />
                      ) : (
                        <span className="text-sm font-semibold">{formatPrice((line?.unitPrice ?? item.price) * item.quantity)}</span>
                      )}
                    </div>
                    {issue && <p className="mt-1.5 text-xs font-medium text-danger">{issue}</p>}
                  </div>
                  <button type="button" onClick={() => remove(key)} aria-label={`Remove ${item.name}`} className="self-start rounded-full p-1.5 text-muted hover:bg-blush-50 hover:text-danger">
                    <Trash className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Drawer>
  );
}
