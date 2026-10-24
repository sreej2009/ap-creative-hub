import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FilterBar, PageHeader, Panel, Table } from '../../components/admin/AdminLayout';
import { ButtonLink, IconButton } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Input, Select } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { useToast } from '../../components/ui/Toast';
import { useDebounced, useDocumentTitle } from '../../hooks/useStore';
import { api, errorMessage } from '../../lib/api';
import { cn, formatPrice } from '../../lib/format';
import type { Category } from '../../lib/types';
import type { AdminProduct, Paged } from './types';

export function useAdminCategories() {
  return useQuery({ queryKey: ['admin', 'categories'], queryFn: () => api.get<{ items: Category[] }>('/admin/categories').then((r) => r.items) });
}

export const stockBadge = (p: { stock: number; stockState: string }) =>
  p.stockState === 'out' ? <Badge tone="danger">Out of stock</Badge> : p.stockState === 'low' ? <Badge tone="warning">{p.stock} · low</Badge> : <Badge tone="success">{p.stock} in stock</Badge>;

export const productStatusBadge = (s: string) => <Badge tone={s === 'active' ? 'success' : s === 'draft' ? 'neutral' : 'warning'}>{s}</Badge>;

export default function Products() {
  useDocumentTitle('Products');
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounced(search, 350);
  const [archiving, setArchiving] = useState<AdminProduct | null>(null);
  const { data: categories } = useAdminCategories();

  const filters = {
    q: params.get('q') ?? undefined,
    category: params.get('category') ?? undefined,
    status: params.get('status') ?? undefined,
    stock: params.get('stock') ?? undefined,
    sort: params.get('sort') ?? 'newest',
    page: Number(params.get('page') ?? 1),
  };
  const set = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) set({ q: debounced || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading, isError, refetch, isPlaceholderData } = useQuery({
    queryKey: ['admin', 'products', filters],
    queryFn: () => api.get<Paged<AdminProduct>>('/admin/products', { ...filters, limit: 25 }),
    placeholderData: keepPreviousData,
  });

  const archive = useMutation({
    mutationFn: (p: AdminProduct) => api.patch(`/admin/products/${p.id}/status`, { status: 'archived' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      setArchiving(null);
      toast('Product archived — it can no longer be purchased');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <>
      <PageHeader
        title="Products"
        description={data ? `${data.meta.total} products` : undefined}
        actions={
          <ButtonLink to="/admin/products/new" size="sm" icon={<Plus className="size-4" />}>
            Add product
          </ButtonLink>
        }
      />
      <FilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-[38px] size-4 text-muted" aria-hidden />
          <Input label="Search" placeholder="Name, SKU or tag" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select label="Category" value={filters.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined })}>
          <option value="">All categories</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parent ? '— ' : ''}
              {c.name}
            </option>
          ))}
        </Select>
        <Select label="Status" value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </Select>
        <Select label="Stock" value={filters.stock ?? ''} onChange={(e) => set({ stock: e.target.value || undefined })}>
          <option value="">Any stock</option>
          <option value="in">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </Select>
        <Select label="Sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
          <option value="stock_asc">Stock ↑</option>
          <option value="stock_desc">Stock ↓</option>
          <option value="popular">Best selling</option>
        </Select>
      </FilterBar>

      <Panel padded={false}>
        {isError ? (
          <ErrorState message="Could not load products." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <EmptyState title="No products found" description="Add your first product or adjust the filters." action={<ButtonLink to="/admin/products/new">Add product</ButtonLink>} />
        ) : (
          <div className={cn(isPlaceholderData && 'opacity-60')}>
            <Table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Sold</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/admin/products/${p.id}`} className="flex items-center gap-3">
                        {p.images[0] ? <img src={p.images[0].url} alt="" className="size-11 rounded-lg bg-blush-50 object-cover" /> : <div className="size-11 rounded-lg bg-blush-50" />}
                        <span className="min-w-0">
                          <span className="block max-w-[260px] truncate font-medium hover:text-rose-700">{p.name}</span>
                          <span className="text-xs text-muted">
                            {p.sku}
                            {p.variants.length ? ` · ${p.variants.length} variants` : ''}
                            {p.isSample && ' · SAMPLE'}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-ink-soft">{p.category.name}</td>
                    <td className="tabular-nums">
                      {formatPrice(p.sellingPrice)}
                      {p.salePrice != null && <s className="ml-1.5 text-xs text-muted">{formatPrice(p.price)}</s>}
                    </td>
                    <td>{stockBadge(p)}</td>
                    <td>{productStatusBadge(p.status)}</td>
                    <td className="tabular-nums text-ink-soft">{p.soldCount}</td>
                    <td className="text-right">
                      <Link to={`/admin/products/${p.id}`} aria-label={`Edit ${p.name}`} title="Edit" className="inline-flex size-9 items-center justify-center rounded-full text-ink-soft hover:bg-blush-50 hover:text-rose-700">
                        <Pencil className="size-4" />
                      </Link>
                      {p.status !== 'archived' && (
                        <IconButton label={`Archive ${p.name}`} onClick={() => setArchiving(p)}>
                          <Archive className="size-4" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>
      {data && <Pagination className="mt-6" page={data.meta.page} pages={data.meta.pages} onChange={(p) => set({ page: String(p) })} />}

      <ConfirmDialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        onConfirm={() => archiving && archive.mutate(archiving)}
        loading={archive.isPending}
        title={`Archive “${archiving?.name ?? ''}”?`}
        description="Archived products are hidden from the store and cannot be purchased. Order history is kept. You can reactivate it later."
        confirmLabel="Archive"
      />
    </>
  );
}
