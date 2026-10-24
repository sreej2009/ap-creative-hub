import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ProductGrid } from '../../components/store/ProductCard';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Dialog';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Checkbox } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { useCategories, useDocumentTitle } from '../../hooks/useStore';
import { ApiError, api } from '../../lib/api';
import { cn, formatPrice, pluralize, rupeesToPaise } from '../../lib/format';
import type { CategoryDetail, ProductList } from '../../lib/types';
import NotFound from './NotFound';

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most popular' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name A–Z' },
];

const PRICE_PRESETS = [
  { label: 'Under ₹300', min: undefined, max: 29999 },
  { label: '₹300 – ₹599', min: 30000, max: 59999 },
  { label: '₹600 – ₹999', min: 60000, max: 99999 },
  { label: '₹1,000 & above', min: 100000, max: undefined },
];

function parseAttrs(s: string | null): Record<string, string[]> {
  if (!s) return {};
  return Object.fromEntries(
    s
      .split('|')
      .map((p) => {
        const i = p.indexOf(':');
        return [p.slice(0, i), p.slice(i + 1).split(',').filter(Boolean)] as const;
      })
      .filter(([k, v]) => k && v.length),
  );
}

function serializeAttrs(a: Record<string, string[]>) {
  return Object.entries(a)
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k}:${v.join(',')}`)
    .join('|');
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-b border-line pb-5">
      <legend className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-700">{title}</legend>
      <div className="space-y-2.5">{children}</div>
    </fieldset>
  );
}

export default function Shop({ mode = 'shop' }: { mode?: 'shop' | 'search' }) {
  const { slug } = useParams();
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { data: categories } = useCategories();

  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1);
  const sort = params.get('sort') ?? 'newest';
  const attrs = parseAttrs(params.get('attrs'));
  const query = {
    q: q || undefined,
    category: slug,
    page,
    sort,
    minPrice: params.get('minPrice') ?? undefined,
    maxPrice: params.get('maxPrice') ?? undefined,
    inStock: params.get('inStock') ?? undefined,
    onSale: params.get('onSale') ?? undefined,
    featured: params.get('featured') ?? undefined,
    newArrival: params.get('newArrival') ?? undefined,
    attrs: params.get('attrs') ?? undefined,
    limit: 24,
  };

  const list = useQuery({
    queryKey: ['products', query],
    queryFn: ({ signal }) => api.get<ProductList>('/products', query, signal),
    placeholderData: keepPreviousData,
  });
  const cat = useQuery({
    queryKey: ['category', slug],
    queryFn: () => api.get<CategoryDetail>(`/categories/${slug}`),
    enabled: !!slug,
  });

  const title =
    mode === 'search'
      ? q
        ? `Results for “${q}”`
        : 'Search'
      : cat.data?.name ?? (query.onSale ? 'Special offers' : query.newArrival ? 'New arrivals' : query.featured ? 'Featured' : 'Shop all');
  useDocumentTitle(title);

  useEffect(() => {
    if (page > 1) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  const update = (changes: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: false });
  };

  const toggleAttr = (name: string, value: string) => {
    const current = attrs[name] ?? [];
    const nextVals = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    update({ attrs: serializeAttrs({ ...attrs, [name]: nextVals }) || undefined });
  };

  if (slug && cat.error instanceof ApiError && cat.error.status === 404) return <NotFound />;

  const activeChips: { label: string; clear: () => void }[] = [];
  if (query.inStock) activeChips.push({ label: 'In stock', clear: () => update({ inStock: undefined }) });
  if (query.onSale) activeChips.push({ label: 'On sale', clear: () => update({ onSale: undefined }) });
  if (query.minPrice || query.maxPrice) {
    activeChips.push({
      label: `${query.minPrice ? formatPrice(Number(query.minPrice)) : '₹0'} – ${query.maxPrice ? formatPrice(Number(query.maxPrice)) : 'any'}`,
      clear: () => update({ minPrice: undefined, maxPrice: undefined }),
    });
  }
  for (const [name, values] of Object.entries(attrs)) {
    for (const v of values) activeChips.push({ label: v, clear: () => toggleAttr(name, v) });
  }

  const facets = list.data?.facets;
  const filters = (
    <div className="space-y-5">
      {!slug && categories && (
        <FilterGroup title="Category">
          {categories.map((c) => (
            <Link key={c.id} to={`/shop/${c.slug}${params.toString() ? `?${params}` : ''}`} className="flex justify-between text-sm text-ink-soft hover:text-rose-700">
              {c.name} <span className="text-muted">{c.productCount}</span>
            </Link>
          ))}
        </FilterGroup>
      )}
      <FilterGroup title="Availability">
        <Checkbox label="In stock only" checked={!!query.inStock} onChange={(e) => update({ inStock: e.target.checked ? 'true' : undefined })} />
        <Checkbox label="On sale" checked={!!query.onSale} onChange={(e) => update({ onSale: e.target.checked ? 'true' : undefined })} />
      </FilterGroup>
      <FilterGroup title="Price">
        {PRICE_PRESETS.map((p) => {
          const active = String(p.min ?? '') === (query.minPrice ?? '') && String(p.max ?? '') === (query.maxPrice ?? '');
          return (
            <button
              type="button"
              key={p.label}
              onClick={() => (active ? update({ minPrice: undefined, maxPrice: undefined }) : update({ minPrice: p.min?.toString(), maxPrice: p.max?.toString() }))}
              className={cn('mr-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors', active ? 'border-rose-600 bg-blush-50 text-rose-700' : 'border-line-strong text-ink-soft hover:border-rose-600')}
              aria-pressed={active}
            >
              {p.label}
            </button>
          );
        })}
        <PriceRange
          min={query.minPrice}
          max={query.maxPrice}
          onApply={(min, max) => update({ minPrice: min, maxPrice: max })}
        />
        {facets?.price && (
          <p className="text-xs text-muted">
            Prices here range {formatPrice(facets.price.min)} – {formatPrice(facets.price.max)}
          </p>
        )}
      </FilterGroup>
      {facets?.attributes.map((f) => (
        <FilterGroup key={f.name} title={f.name}>
          {f.values.map((v) => (
            <Checkbox key={v} label={v} checked={(attrs[f.name] ?? []).includes(v)} onChange={() => toggleAttr(f.name, v)} />
          ))}
        </FilterGroup>
      ))}
    </div>
  );

  return (
    <div className="container-page pb-10 pt-8">
      <nav aria-label="Breadcrumb" className="text-xs text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/" className="hover:text-rose-700">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          {cat.data?.parent && (
            <>
              <li>
                <Link to={`/shop/${cat.data.parent.slug}`} className="hover:text-rose-700">
                  {cat.data.parent.name}
                </Link>
              </li>
              <li aria-hidden>/</li>
            </>
          )}
          <li aria-current="page" className="text-ink-soft">
            {title}
          </li>
        </ol>
      </nav>

      <header className="mt-4 flex flex-col gap-3 border-b border-line pb-6">
        {slug && cat.isLoading ? <Skeleton className="h-12 w-64" /> : <h1 className="text-[40px] sm:text-[52px]">{title}</h1>}
        {cat.data?.description && <p className="max-w-2xl text-ink-soft">{cat.data.description}</p>}
        {!!cat.data?.children.length && (
          <div className="mt-2 flex flex-wrap gap-2">
            {cat.data.children.map((c) => (
              <Link key={c.id} to={`/shop/${c.slug}`} className="rounded-full border border-line-strong bg-paper px-4 py-1.5 text-sm text-ink-soft hover:border-rose-600 hover:text-rose-700">
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {list.data ? pluralize(list.data.meta.total, 'piece') : ' '}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="lg:hidden" icon={<SlidersHorizontal className="size-4" />} onClick={() => setFiltersOpen(true)}>
            Filters{activeChips.length ? ` (${activeChips.length})` : ''}
          </Button>
          <label className="sr-only" htmlFor="sort">
            Sort by
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => update({ sort: e.target.value === 'newest' ? undefined : e.target.value })}
            className="h-9 rounded-full border border-line-strong bg-paper px-4 pr-8 text-[13px] focus:border-rose-600 focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {activeChips.map((c) => (
            <button key={c.label} type="button" onClick={c.clear} className="inline-flex items-center gap-1.5 rounded-full bg-blush-100 px-3 py-1 text-[13px] text-rose-800 hover:bg-blush-200">
              {c.label} <X className="size-3.5" aria-label="remove filter" />
            </button>
          ))}
          <button type="button" className="text-[13px] text-muted underline underline-offset-2 hover:text-rose-700" onClick={() => update({ inStock: undefined, onSale: undefined, minPrice: undefined, maxPrice: undefined, attrs: undefined })}>
            Clear all
          </button>
        </div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block" aria-label="Filters">
          {filters}
        </aside>
        <div>
          {list.isError ? (
            <ErrorState message="We couldn't load products." onRetry={() => list.refetch()} />
          ) : list.data && list.data.items.length === 0 ? (
            <EmptyState
              title={mode === 'search' ? 'No matches yet' : 'Nothing here just yet'}
              description={mode === 'search' ? 'Try a different word — “earrings”, “gold”, “clip” — or browse all products.' : 'Try removing a filter or explore our other collections.'}
              action={<ButtonLink to="/shop">Browse all products</ButtonLink>}
            />
          ) : (
            <div className={cn('transition-opacity', list.isPlaceholderData && 'opacity-60')}>
              <ProductGrid products={list.data?.items} loading={list.isLoading} className="lg:grid-cols-3" skeletons={9} />
            </div>
          )}
          {list.data && (
            <Pagination className="mt-12" page={list.data.meta.page} pages={list.data.meta.pages} onChange={(p) => update({ page: p > 1 ? String(p) : undefined }, false)} />
          )}
        </div>
      </div>

      <Drawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        side="left"
        footer={
          <Button block onClick={() => setFiltersOpen(false)}>
            Show {list.data ? pluralize(list.data.meta.total, 'result') : 'results'}
          </Button>
        }
      >
        <div className="p-5">{filters}</div>
      </Drawer>
    </div>
  );
}

function PriceRange({ min, max, onApply }: { min?: string; max?: string; onApply: (min?: string, max?: string) => void }) {
  const [lo, setLo] = useState(min ? String(Number(min) / 100) : '');
  const [hi, setHi] = useState(max ? String(Math.ceil(Number(max) / 100)) : '');
  useEffect(() => {
    setLo(min ? String(Number(min) / 100) : '');
    setHi(max ? String(Math.ceil(Number(max) / 100)) : '');
  }, [min, max]);
  return (
    <form
      className="flex items-end gap-2 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        const a = rupeesToPaise(lo);
        const b = rupeesToPaise(hi);
        onApply(a != null ? String(a) : undefined, b != null ? String(b) : undefined);
      }}
    >
      <label className="flex-1 text-xs text-muted">
        Min ₹
        <input inputMode="numeric" value={lo} onChange={(e) => setLo(e.target.value.replace(/\D/g, ''))} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-paper px-2 text-sm" />
      </label>
      <label className="flex-1 text-xs text-muted">
        Max ₹
        <input inputMode="numeric" value={hi} onChange={(e) => setHi(e.target.value.replace(/\D/g, ''))} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-paper px-2 text-sm" />
      </label>
      <Button type="submit" size="sm" variant="secondary">
        Go
      </Button>
    </form>
  );
}
