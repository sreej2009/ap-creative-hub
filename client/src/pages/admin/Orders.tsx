import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Flag, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FilterBar, PageHeader, Panel, Table } from '../../components/admin/AdminLayout';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { useCan } from '../../hooks/useAuth';
import { useDebounced, useDocumentTitle } from '../../hooks/useStore';
import { api } from '../../lib/api';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, paymentTone, statusTone } from '../../lib/constants';
import { cn, formatDateTime, formatPrice } from '../../lib/format';
import type { AdminOrderSummary, Paged } from './types';

export default function Orders() {
  useDocumentTitle('Orders');
  const [params, setParams] = useSearchParams();
  const canExport = useCan('orders:export');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounced(search, 350);

  const filters = {
    q: params.get('q') ?? undefined,
    status: params.get('status') ?? undefined,
    paymentStatus: params.get('paymentStatus') ?? undefined,
    paymentMethod: params.get('paymentMethod') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    attention: params.get('attention') ?? undefined,
  };
  const page = Number(params.get('page') ?? 1);

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
    queryKey: ['admin', 'orders', filters, page],
    queryFn: () => api.get<Paged<AdminOrderSummary>>('/admin/orders', { ...filters, page, limit: 25 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Orders"
        description={data ? `${data.meta.total} orders` : undefined}
        actions={
          canExport && (
            <a
              href={api.url('/admin/orders/export', filters)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-paper px-4 text-[13px] font-medium hover:border-rose-600 hover:text-rose-700"
            >
              <Download className="size-4" /> Export CSV
            </a>
          )
        }
      />
      <FilterBar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-[38px] size-4 text-muted" aria-hidden />
          <Input label="Search" placeholder="Order no., name, email, phone, AWB" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
        <Select label="Status" value={filters.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
          <option value="">All statuses</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select label="Payment" value={filters.paymentStatus ?? ''} onChange={(e) => set({ paymentStatus: e.target.value || undefined })}>
          <option value="">All payments</option>
          {Object.entries(PAYMENT_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select label="Method" value={filters.paymentMethod ?? ''} onChange={(e) => set({ paymentMethod: e.target.value || undefined })}>
          <option value="">Any method</option>
          <option value="razorpay">Online (Razorpay)</option>
          <option value="cod">Cash on Delivery</option>
        </Select>
        <Input label="From" type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
        <Input label="To" type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
        <div className="flex h-11 items-center">
          <Checkbox label="Needs attention" checked={filters.attention === 'true'} onChange={(e) => set({ attention: e.target.checked ? 'true' : undefined })} />
        </div>
      </FilterBar>

      <Panel padded={false}>
        {isError ? (
          <ErrorState message="Could not load orders." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <EmptyState title="No orders found" description="Try a different search or clear the filters." />
        ) : (
          <div className={cn(isPlaceholderData && 'opacity-60')}>
            <Table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/admin/orders/${o.id}`} className="inline-flex items-center gap-1.5 font-medium text-rose-700 hover:underline">
                        {o.attention && <Flag className="size-3.5 text-danger" aria-label="Needs attention" />}
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-ink-soft">{formatDateTime(o.createdAt)}</td>
                    <td>
                      <p className="max-w-[180px] truncate">{o.customer.name}</p>
                      <p className="text-xs text-muted">
                        {o.city}
                        {o.isGuest ? ' · guest' : ''}
                      </p>
                    </td>
                    <td className="tabular-nums">{o.itemCount}</td>
                    <td>
                      <Badge tone={statusTone(o.status)}>{o.statusLabel}</Badge>
                    </td>
                    <td>
                      <Badge tone={paymentTone(o.payment.status)}>{PAYMENT_STATUS_LABELS[o.payment.status]}</Badge>
                      <p className="mt-0.5 text-xs text-muted">{o.payment.method === 'cod' ? 'COD' : 'Online'}</p>
                    </td>
                    <td className="text-right font-medium tabular-nums">{formatPrice(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>
      {data && <Pagination className="mt-6" page={data.meta.page} pages={data.meta.pages} onChange={(p) => set({ page: String(p) })} />}
    </>
  );
}
