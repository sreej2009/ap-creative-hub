import { useQuery } from '@tanstack/react-query';
import { ChevronDown, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PriceTag, ProductGrid, WishlistButton } from '../../components/store/ProductCard';
import { QuantityStepper } from '../../components/store/QuantityStepper';
import { Button } from '../../components/ui/Button';
import { ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Sparkle } from '../../components/ui/Icons';
import { useToast } from '../../components/ui/Toast';
import { useCart } from '../../hooks/useCart';
import { useDocumentTitle, useStoreSettings } from '../../hooks/useStore';
import { ApiError, api } from '../../lib/api';
import { cn, formatPrice } from '../../lib/format';
import type { ProductCard, ProductDetail as Detail } from '../../lib/types';
import { SectionHeading } from './Home';
import NotFound from './NotFound';

function Accordion({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-4 text-left font-medium">
        {title}
        <ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="animate-fade pb-5 text-sm leading-relaxed text-ink-soft">{children}</div>}
    </div>
  );
}

function Gallery({ images, name }: { images: Detail['images']; name: string }) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [images]);
  const current = images[active];
  return (
    <div className="flex flex-col-reverse gap-3 md:flex-row md:items-start lg:sticky lg:top-32">
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto md:flex-col" role="tablist" aria-label="Product images">
          {images.map((img, i) => (
            <button
              type="button"
              key={img.url + i}
              role="tab"
              aria-selected={i === active}
              aria-label={`Show image ${i + 1}`}
              onClick={() => setActive(i)}
              className={cn('shrink-0 overflow-hidden rounded-xl border-2 bg-blush-50 transition-colors', i === active ? 'border-rose-600' : 'border-transparent hover:border-line-strong')}
            >
              <img src={img.url} alt="" className="size-16 object-cover md:size-20" />
            </button>
          ))}
        </div>
      )}
      <div className="relative flex-1 overflow-hidden rounded-[28px] bg-blush-50 ring-1 ring-line">
        <div className="aspect-[4/5]">
          {current ? (
            <img key={current.url} src={current.url} alt={current.alt || name} className="size-full animate-fade object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center font-display text-5xl italic text-rose-300">A&amp;P</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProductDetail() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { add, setDrawerOpen, items } = useCart();
  const { data: settings } = useStoreSettings();
  const { data: product, isLoading, error, refetch } = useQuery({ queryKey: ['product', slug], queryFn: () => api.get<Detail>(`/products/${slug}`) });
  const related = useQuery({
    queryKey: ['related', slug],
    queryFn: () => api.get<{ items: ProductCard[] }>(`/products/${slug}/related`).then((r) => r.items),
    enabled: !!product,
  });
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  useDocumentTitle(product?.name);

  useEffect(() => {
    if (!product) return;
    const firstInStock = product.variants.find((v) => v.inStock) ?? product.variants[0];
    setVariantId(firstInStock?.id ?? null);
    setQty(1);
  }, [product]);

  const variant = product?.variants.find((v) => v.id === variantId) ?? null;
  const price = variant?.price ?? product?.price ?? 0;
  const compareAt = variant ? variant.compareAtPrice : product?.compareAtPrice;
  const stock = variant ? variant.stock : product?.stock ?? 0;
  const inCart = items.find((i) => i.productId === product?.id && i.variantId === (variant?.id ?? null))?.quantity ?? 0;
  const maxQty = Math.max(0, Math.min(20, stock - inCart));
  const needsVariant = !!product?.variants.length && !variant;

  const sku = variant?.sku ?? product?.sku;
  const shippingCopy = useMemo(() => {
    if (!settings) return null;
    const s = settings.shipping;
    return `Delivered in ${s.estimatedDays}. ${s.freeShippingThreshold > 0 ? `Free shipping on orders above ${formatPrice(s.freeShippingThreshold)}; ` : ''}otherwise ${formatPrice(s.flatFee)}.${settings.payments.cod ? ` Cash on Delivery available${settings.cod.fee ? ` (+${formatPrice(settings.cod.fee)})` : ''}.` : ''}`;
  }, [settings]);

  if (error instanceof ApiError && error.status === 404) return <NotFound />;
  if (error) return <ErrorState message="We couldn't load this product." onRetry={() => refetch()} />;

  const addToCart = (buyNow = false) => {
    if (!product || needsVariant || qty < 1) return;
    add(
      {
        productId: product.id,
        variantId: variant?.id ?? null,
        name: product.name,
        slug: product.slug,
        image: product.images[0]?.url ?? null,
        price,
        variantLabel: variant?.label ?? null,
      },
      qty,
    );
    if (buyNow) navigate('/checkout');
    else toast(`${product.name} added to your bag`, 'success', { label: 'View bag', onClick: () => setDrawerOpen(true) });
  };

  return (
    <div className="container-page pb-10 pt-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/" className="hover:text-rose-700">Home</Link>
          </li>
          {product?.parentCategory && (
            <>
              <li aria-hidden>/</li>
              <li>
                <Link to={`/shop/${product.parentCategory.slug}`} className="hover:text-rose-700">{product.parentCategory.name}</Link>
              </li>
            </>
          )}
          {product?.category && (
            <>
              <li aria-hidden>/</li>
              <li>
                <Link to={`/shop/${product.category.slug}`} className="hover:text-rose-700">{product.category.name}</Link>
              </li>
            </>
          )}
        </ol>
      </nav>

      <div className="mt-5 grid items-start gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        {isLoading || !product ? <Skeleton className="aspect-[4/5] rounded-[28px]" /> : <Gallery images={product.images} name={product.name} />}

        <div className="lg:pt-4">
          {isLoading || !product ? (
            <div className="space-y-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-12 w-4/5" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  {product.category && <p className="eyebrow">{product.category.name}</p>}
                  <h1 className="mt-2 text-[36px] leading-tight sm:text-[44px]">{product.name}</h1>
                </div>
                <WishlistButton productId={product.id} name={product.name} className="mt-1 size-11 shrink-0 border border-line" />
              </div>
              <div className="mt-4">
                <PriceTag price={price} compareAt={compareAt} size="lg" />
                <p className="mt-1 text-xs text-muted">Inclusive of all taxes</p>
              </div>
              {product.shortDescription && <p className="mt-5 text-[15.5px] leading-relaxed text-ink-soft">{product.shortDescription}</p>}

              {product.variants.length > 0 && (
                <fieldset className="mt-7">
                  <legend className="mb-3 text-sm font-medium">
                    Option: <span className="text-ink-soft">{variant?.label ?? 'Choose one'}</span>
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {product.variants.map((v) => (
                      <button
                        type="button"
                        key={v.id}
                        onClick={() => {
                          setVariantId(v.id);
                          setQty(1);
                        }}
                        aria-pressed={v.id === variantId}
                        disabled={!v.inStock}
                        className={cn(
                          'rounded-full border px-4 py-2 text-sm transition-colors',
                          v.id === variantId ? 'border-rose-600 bg-blush-50 font-medium text-rose-800' : 'border-line-strong bg-paper hover:border-rose-600',
                          !v.inStock && 'cursor-not-allowed text-muted line-through opacity-60 hover:border-line-strong',
                        )}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="mt-6 text-sm" aria-live="polite">
                {stock <= 0 ? (
                  <p className="font-medium text-danger">Sold out{variant ? ' in this option' : ''}</p>
                ) : stock <= 5 ? (
                  <p className="font-medium text-rose-700">
                    <Sparkle className="mr-1 inline size-3" /> Only {stock} left — order soon
                  </p>
                ) : (
                  <p className="font-medium text-success">In stock</p>
                )}
                {inCart > 0 && <p className="mt-1 text-xs text-muted">{inCart} already in your bag</p>}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <QuantityStepper value={Math.min(qty, Math.max(1, maxQty))} onChange={setQty} max={Math.max(1, maxQty)} label={product.name} disabled={maxQty < 1} />
                <Button size="lg" className="flex-1" disabled={maxQty < 1 || needsVariant} onClick={() => addToCart(false)}>
                  {stock <= 0 ? 'Sold out' : maxQty < 1 ? 'Max quantity in bag' : 'Add to bag'}
                </Button>
              </div>
              <Button size="lg" variant="dark" block className="mt-3" disabled={maxQty < 1 || needsVariant} onClick={() => addToCart(true)}>
                Buy now
              </Button>

              <ul className="mt-7 grid grid-cols-3 gap-3 rounded-2xl border border-line bg-paper p-4 text-center text-[12px] text-ink-soft">
                <li className="flex flex-col items-center gap-1.5">
                  <Truck className="size-5 text-gold-500" aria-hidden /> Ships in {settings?.shipping.estimatedDays ?? 'a few days'}
                </li>
                <li className="flex flex-col items-center gap-1.5">
                  <ShieldCheck className="size-5 text-gold-500" aria-hidden /> Secure checkout
                </li>
                <li className="flex flex-col items-center gap-1.5">
                  <RotateCcw className="size-5 text-gold-500" aria-hidden />
                  {settings?.returns.windowDays ? `${settings.returns.windowDays}-day returns` : 'Quality checked'}
                </li>
              </ul>

              <div className="mt-6">
                <Accordion title="Description" defaultOpen>
                  <p className="whitespace-pre-line">{product.description || 'No description yet.'}</p>
                </Accordion>
                <Accordion title="Details">
                  <dl className="grid grid-cols-[120px_1fr] gap-y-2">
                    <dt className="text-muted">SKU</dt>
                    <dd>{sku}</dd>
                    {product.category && (
                      <>
                        <dt className="text-muted">Category</dt>
                        <dd>{product.category.name}</dd>
                      </>
                    )}
                    {product.attributes.map((a) => (
                      <div key={a.name} className="contents">
                        <dt className="text-muted">{a.name}</dt>
                        <dd>{a.value}</dd>
                      </div>
                    ))}
                  </dl>
                </Accordion>
                <Accordion title="Shipping & returns">
                  <p>{shippingCopy}</p>
                  <p className="mt-2">
                    {settings?.returns.windowDays
                      ? `Returns accepted within ${settings.returns.windowDays} days of delivery for unused items in original packaging. `
                      : ''}
                    <Link to="/returns" className="text-rose-700 underline underline-offset-2">Read the full policy</Link>.
                  </p>
                </Accordion>
              </div>
            </>
          )}
        </div>
      </div>

      {!!related.data?.length && (
        <section className="mt-20">
          <SectionHeading eyebrow="Complete the look" title="You may also love" />
          <ProductGrid products={related.data.slice(0, 4)} />
        </section>
      )}
    </div>
  );
}
