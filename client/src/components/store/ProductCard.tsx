import { Heart, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useCart } from '../../hooks/useCart';
import { useWishlist } from '../../hooks/useWishlist';
import { cn, discountPercent, formatPrice } from '../../lib/format';
import type { ProductCard as Card } from '../../lib/types';
import { Skeleton } from '../ui/Feedback';
import { useToast } from '../ui/Toast';

export function PriceTag({ price, compareAt, from, size = 'md' }: { price: number; compareAt?: number | null; from?: boolean; size?: 'md' | 'lg' }) {
  const off = discountPercent(price, compareAt);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className={cn('font-semibold text-ink', size === 'lg' ? 'text-2xl' : 'text-[15px]')}>
        {from && <span className="mr-1 text-xs font-normal text-muted">from</span>}
        {formatPrice(price)}
      </span>
      {off > 0 && (
        <>
          <s className={cn('text-muted', size === 'lg' ? 'text-base' : 'text-[13px]')} aria-label={`was ${formatPrice(compareAt)}`}>
            {formatPrice(compareAt)}
          </s>
          <span className={cn('font-semibold text-rose-700', size === 'lg' ? 'text-sm' : 'text-xs')}>{off}% off</span>
        </>
      )}
    </div>
  );
}

export function WishlistButton({ productId, name, className }: { productId: string; name: string; className?: string }) {
  const { has, toggle } = useWishlist();
  const toast = useToast();
  const active = has(productId);
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `Remove ${name} from wishlist` : `Add ${name} to wishlist`}
      onClick={(e) => {
        e.preventDefault();
        const added = toggle(productId);
        toast(added ? 'Saved to your wishlist' : 'Removed from wishlist');
      }}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-full bg-paper/90 text-ink-soft shadow-soft backdrop-blur transition-all hover:scale-105 hover:text-rose-600',
        active && 'text-rose-600',
        className,
      )}
    >
      <Heart className={cn('size-[18px] transition-transform', active && 'fill-rose-600 scale-110')} strokeWidth={1.8} />
    </button>
  );
}

export function ProductCard({ product, index = 0 }: { product: Card; index?: number }) {
  const { add, setDrawerOpen } = useCart();
  const navigate = useNavigate();
  const toast = useToast();
  const off = discountPercent(product.price, product.compareAtPrice);
  const href = `/product/${product.slug}`;

  const quickAdd = () => {
    if (product.hasVariants) return navigate(href);
    add({ productId: product.id, variantId: null, name: product.name, slug: product.slug, image: product.image?.url ?? null, price: product.price, variantLabel: null });
    toast(`${product.name} added to your bag`, 'success', { label: 'View bag', onClick: () => setDrawerOpen(true) });
  };

  return (
    <article className="group relative animate-rise" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <Link to={href} className="relative block overflow-hidden rounded-[22px] bg-blush-50 ring-1 ring-line/70 transition-shadow duration-300 group-hover:shadow-lift">
        <div className="aspect-[4/5]">
          {product.image ? (
            <>
              <img
                src={product.image.url}
                alt={product.image.alt || product.name}
                loading="lazy"
                decoding="async"
                className={cn('size-full object-cover transition-all duration-500 group-hover:scale-[1.03]', product.hoverImage && 'group-hover:opacity-0')}
              />
              {product.hoverImage && (
                <img
                  src={product.hoverImage.url}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                />
              )}
            </>
          ) : (
            <div className="flex size-full items-center justify-center font-display text-3xl italic text-rose-300">A&amp;P</div>
          )}
        </div>
        <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {!product.inStock && <span className="rounded-full bg-ink/85 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-ivory">Sold out</span>}
          {product.inStock && off > 0 && <span className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white">−{off}%</span>}
          {product.isNewArrival && <span className="rounded-full bg-gold-200 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-gold-700">New</span>}
        </div>
      </Link>
      <WishlistButton productId={product.id} name={product.name} className="absolute right-3 top-3" />
      <div className="flex items-start justify-between gap-2 px-1 pt-3">
        <div className="min-w-0">
          {product.category && <p className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-gold-700">{product.category.name}</p>}
          <h3 className="mt-0.5 line-clamp-2 font-display text-[19px] leading-snug text-ink">
            <Link to={href} className="link-underline">
              {product.name}
            </Link>
          </h3>
          <div className="mt-1">
            <PriceTag price={product.price} compareAt={product.compareAtPrice} from={product.priceVaries} />
          </div>
          {product.lowStock && <p className="mt-0.5 text-xs font-medium text-rose-700">Only a few left</p>}
        </div>
        {product.inStock && (
          <button
            type="button"
            onClick={quickAdd}
            aria-label={product.hasVariants ? `Choose options for ${product.name}` : `Add ${product.name} to bag`}
            title={product.hasVariants ? 'Choose options' : 'Add to bag'}
            className="mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line-strong text-ink-soft transition-colors hover:border-rose-600 hover:bg-rose-600 hover:text-white"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[4/5] rounded-[22px]" />
      <Skeleton className="mt-3 h-3 w-16" />
      <Skeleton className="mt-2 h-5 w-4/5" />
      <Skeleton className="mt-2 h-4 w-20" />
    </div>
  );
}

export function ProductGrid({ products, loading, skeletons = 8, className }: { products?: Card[]; loading?: boolean; skeletons?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4', className)}>
      {loading && !products
        ? Array.from({ length: skeletons }, (_, i) => <ProductCardSkeleton key={i} />)
        : products?.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
    </div>
  );
}
