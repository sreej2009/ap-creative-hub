import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader, Panel, Table } from '../../components/admin/AdminLayout';
import { TrendChart } from '../../components/admin/TrendChart';
import { Badge, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { IS_DEMO } from '../../demo/DemoBanner';
import { useDocumentTitle } from '../../hooks/useStore';
import { api } from '../../lib/api';
import { PAYMENT_STATUS_LABELS, paymentTone, statusTone } from '../../lib/constants';
import { cn, formatDate, formatPrice, relativeTime } from '../../lib/format';
import type { AdminOrderSummary } from './types';

interface DashboardData {
  range: { days: number; from: string; to: string; timezone: string };
  kpis: { orders: number; grossSales: number; refunds: number; netSales: number; onlineSales: number; codCollected: number; paidOrders: number; averageOrderValue: number };
  pipeline: { awaitingPayment: number; pending: number; awaitingShipment: number; inTransit: number; completed: number; returns: number; cancelled: number; needsAttention: number };
  inventory: { lowStock: number; outOfStock: number; items: { id: string; name: string; sku: string; stock: number; lowStockThreshold: number; image: string | null }[] };
  recentOrders: AdminOrderSummary[];
  trend: { date: string; sales: number; orders: number }[];
  topProducts: { sku: string; name: string; quantity: number; revenue: number }[];
}

function Kpi({ label, value, sub, loading }: { label: string; value: string; sub?: string; loading?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-5 shadow-soft">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{label}</p>
      {loading ? <Skeleton className="mt-3 h-8 w-28" /> : <p className="mt-2 text-[30px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>}
      {sub && !loading && <p className="mt-2 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function PipelineCard({ label, value, to, tone }: { label: string; value: number; to: string; tone?: 'warning' | 'danger' }) {
  return (
    <Link to={to} className={cn('rounded-2xl border bg-paper px-4 py-3 transition-colors hover:border-rose-600', tone === 'danger' && value > 0 ? 'border-[#f1c7cd]' : 'border-line')}>
      <p className="text-xs text-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'danger' && value > 0 && 'text-danger', tone === 'warning' && value > 0 && 'text-warning')}>{value}</p>
    </Link>
  );
}

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'dashboard', range],
    queryFn: () => api.get<DashboardData>('/admin/dashboard', { range }),
    refetchInterval: 60_000,
  });

  if (isError) return <ErrorState message="Could not load dashboard metrics." onRetry={() => refetch()} />;
  const k = data?.kpis;
  const p = data?.pipeline;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={data ? `${formatDate(data.range.from)} – ${formatDate(data.range.to)} (IST)` : 'Store performance'}
        actions={
          <div role="group" aria-label="Date range" className="inline-flex rounded-full border border-line-strong bg-paper p-1">
            {(['7', '30', '90'] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={cn('rounded-full px-4 py-1.5 text-[13px]', range === r ? 'bg-ink text-ivory' : 'text-ink-soft hover:text-rose-700')}
              >
                {r} days
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi loading={isLoading} label="Net sales" value={formatPrice(k?.netSales ?? 0)} sub={k ? `${formatPrice(k.onlineSales)} online · ${formatPrice(k.codCollected)} COD · −${formatPrice(k.refunds)} refunds` : undefined} />
        <Kpi loading={isLoading} label="Orders placed" value={String(k?.orders ?? 0)} sub="Excludes abandoned online checkouts" />
        <Kpi loading={isLoading} label="Paid orders" value={String(k?.paidOrders ?? 0)} sub="Verified payments received in range" />
        <Kpi loading={isLoading} label="Avg. order value" value={formatPrice(k?.averageOrderValue ?? 0)} sub="Gross paid ÷ paid orders" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <PipelineCard label="To process" value={p?.pending ?? 0} to="/admin/orders?status=placed" />
        <PipelineCard label="Awaiting shipment" value={p?.awaitingShipment ?? 0} to="/admin/orders?status=packed" />
        <PipelineCard label="In transit" value={p?.inTransit ?? 0} to="/admin/orders?status=shipped" />
        <PipelineCard label="Delivered" value={p?.completed ?? 0} to="/admin/orders?status=delivered" />
        <PipelineCard label="Return requests" value={p?.returns ?? 0} to="/admin/orders?status=return_requested" tone="warning" />
        <PipelineCard label="Awaiting payment" value={p?.awaitingPayment ?? 0} to="/admin/orders?status=pending_payment" />
        <PipelineCard label="Needs attention" value={p?.needsAttention ?? 0} to="/admin/orders?attention=true" tone="danger" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Sales per day" actions={<span className="text-xs text-muted">Verified payments (online + COD collected), IST</span>}>
          {data ? <TrendChart title="Sales per day" kind="money" points={data.trend.map((t) => ({ date: t.date, value: t.sales }))} /> : <Skeleton className="h-56 w-full" />}
        </Panel>
        <Panel title="Orders per day" actions={<span className="text-xs text-muted">Placed orders</span>}>
          {data ? <TrendChart title="Orders per day" kind="count" height={220} points={data.trend.map((t) => ({ date: t.date, value: t.orders }))} /> : <Skeleton className="h-56 w-full" />}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <Panel title="Recent orders" actions={<Link to="/admin/orders" className="text-sm text-rose-700 hover:underline">All orders</Link>} padded={false}>
          {isLoading ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !data?.recentOrders.length ? (
            <p className="p-6 text-sm text-muted">No orders yet. They’ll appear here as soon as customers check out.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/admin/orders/${o.id}`} className="font-medium text-rose-700 hover:underline">
                        {o.orderNumber}
                      </Link>
                      <p className="text-xs text-muted">{relativeTime(o.createdAt)}</p>
                    </td>
                    <td className="max-w-[160px] truncate">{o.customer.name}</td>
                    <td>
                      <Badge tone={statusTone(o.status)}>{o.statusLabel}</Badge>
                    </td>
                    <td>
                      <Badge tone={paymentTone(o.payment.status)}>{PAYMENT_STATUS_LABELS[o.payment.status]}</Badge>
                    </td>
                    <td className="text-right font-medium tabular-nums">{formatPrice(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel
            title="Low stock"
            actions={
              data && (
                <span className="text-xs text-muted">
                  {data.inventory.lowStock} low · {data.inventory.outOfStock} out
                </span>
              )
            }
          >
            {!data ? (
              <Skeleton className="h-24 w-full" />
            ) : !data.inventory.items.length ? (
              <p className="text-sm text-muted">All active products are above their low-stock thresholds.</p>
            ) : (
              <ul className="space-y-3">
                {data.inventory.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 text-sm">
                    {i.image ? <img src={i.image} alt="" className="size-10 rounded-lg bg-blush-50 object-cover" /> : <div className="size-10 rounded-lg bg-blush-50" />}
                    <div className="min-w-0 flex-1">
                      <Link to={`/admin/inventory?q=${encodeURIComponent(i.sku)}`} className="block truncate font-medium hover:text-rose-700">
                        {i.name}
                      </Link>
                      <p className="text-xs text-muted">{i.sku}</p>
                    </div>
                    <Badge tone={i.stock === 0 ? 'danger' : 'warning'}>
                      {i.stock === 0 ? <AlertTriangle className="size-3" aria-hidden /> : null}
                      {i.stock === 0 ? 'Out' : `${i.stock} left`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Top products">
            {!data ? (
              <Skeleton className="h-24 w-full" />
            ) : !data.topProducts.length ? (
              <p className="text-sm text-muted">No sales in this period yet.</p>
            ) : (
              <ol className="space-y-2.5 text-sm">
                {data.topProducts.map((t, i) => (
                  <li key={t.sku} className="flex items-center gap-3">
                    <span className="w-5 text-center text-sm font-semibold text-gold-700">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className="text-muted tabular-nums">{t.quantity} sold</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>

      <p className="mt-6 flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {IS_DEMO
          ? 'Demo: figures are calculated from the sample orders stored in this browser, using the same rules as the live store.'
          : 'All figures come from live database records. Sales count only payments verified with Razorpay (signature + API, or signed webhook) and COD cash recorded by staff, minus refunds processed in the period.'}
      </p>
    </>
  );
}
