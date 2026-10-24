import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { FilterBar, PageHeader, Panel, Table } from '../../components/admin/AdminLayout';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { Badge, EmptyState, ErrorState, PageLoader, Skeleton } from '../../components/ui/Feedback';
import { Input, Select } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../hooks/useAuth';
import { useDebounced, useDocumentTitle } from '../../hooks/useStore';
import { api, errorMessage } from '../../lib/api';
import { PAYMENT_STATUS_LABELS, paymentTone, statusTone } from '../../lib/constants';
import { formatDate, formatDateTime, formatPrice } from '../../lib/format';
import type { Address, PageMeta } from '../../lib/types';
import type { AdminOrderSummary } from './types';

interface CustomerRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  orders: number;
  totalSpent: number;
  lastOrderAt: string | null;
}

export default function Customers() {
  useDocumentTitle('Customers');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 350);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'customers', q, status, page],
    queryFn: () => api.get<{ items: CustomerRow[]; meta: PageMeta }>('/admin/customers', { q, status, page, limit: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Customers" description="Registered customer accounts. Guest checkouts appear on orders only." />
      <FilterBar>
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-[38px] size-4 text-muted" aria-hidden />
          <Input
            label="Search"
            placeholder="Name, email or phone"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-10"
          />
        </div>
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </Select>
      </FilterBar>
      <Panel padded={false}>
        {isError ? (
          <ErrorState message="Could not load customers." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !data?.items.length ? (
          <EmptyState title="No customers found" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Orders</th>
                <th>Spent</th>
                <th>Last order</th>
                <th>Joined</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/admin/customers/${c.id}`} className="font-medium hover:text-rose-700">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted">{c.email}</p>
                  </td>
                  <td className="text-ink-soft">{c.phone ?? '—'}</td>
                  <td className="tabular-nums">{c.orders}</td>
                  <td className="tabular-nums">{formatPrice(c.totalSpent)}</td>
                  <td className="text-ink-soft">{formatDate(c.lastOrderAt)}</td>
                  <td className="text-ink-soft">{formatDate(c.createdAt)}</td>
                  <td>{c.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {data && <Pagination className="mt-6" page={data.meta.page} pages={data.meta.pages} onChange={setPage} />}
    </>
  );
}

interface CustomerDetailData {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  whatsappOptIn: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  addresses: Address[];
  stats: { orders: number; totalSpent: number; lastOrderAt: string | null };
  orders: AdminOrderSummary[];
}

export function CustomerDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan('customers:write');
  const [confirm, setConfirm] = useState(false);
  const { data: c, isLoading, isError, refetch } = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => api.get<CustomerDetailData>(`/admin/customers/${id}`) });
  useDocumentTitle(c?.name ?? 'Customer');
  const toggle = useMutation({
    mutationFn: () => api.patch(`/admin/customers/${id}/status`, { isActive: !c!.isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'customer', id] });
      qc.invalidateQueries({ queryKey: ['admin', 'customers'] });
      setConfirm(false);
      toast(c!.isActive ? 'Account disabled and signed out' : 'Account re-enabled');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (isLoading) return <PageLoader />;
  if (isError || !c) return <ErrorState message="Could not load this customer." onRetry={() => refetch()} />;
  return (
    <>
      <PageHeader
        back={{ to: '/admin/customers', label: 'Customers' }}
        title={c.name}
        description={`Customer since ${formatDate(c.createdAt)} · last sign-in ${formatDateTime(c.lastLoginAt)}`}
        actions={
          canWrite && (
            <Button variant={c.isActive ? 'secondary' : 'primary'} size="sm" onClick={() => setConfirm(true)}>
              {c.isActive ? 'Disable account' : 'Enable account'}
            </Button>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.6fr]">
        <div className="space-y-6">
          <Panel title="Contact">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Email</dt>
                <dd>{c.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Phone</dt>
                <dd>{c.phone ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">WhatsApp updates</dt>
                <dd>{c.whatsappOptIn ? 'Opted in' : 'No'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Status</dt>
                <dd>{c.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Lifetime">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted">Orders</p>
                <p className="text-2xl font-semibold tabular-nums">{c.stats.orders}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Net spent</p>
                <p className="text-2xl font-semibold tabular-nums">{formatPrice(c.stats.totalSpent)}</p>
              </div>
            </div>
          </Panel>
          <Panel title="Addresses">
            {!c.addresses.length ? (
              <p className="text-sm text-muted">No saved addresses.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {c.addresses.map((a) => (
                  <li key={a._id} className="rounded-xl border border-line p-3">
                    <p className="font-medium">
                      {a.fullName} {a.isDefault && <Badge tone="gold">Default</Badge>}
                    </p>
                    <p className="text-ink-soft">
                      {a.line1}, {a.city}, {a.state} {a.pincode} · +91 {a.phone}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <Panel title="Order history" padded={false}>
          {!c.orders.length ? (
            <p className="p-5 text-sm text-muted">No orders yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {c.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/admin/orders/${o.id}`} className="font-medium text-rose-700 hover:underline">
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td className="text-ink-soft">{formatDate(o.createdAt)}</td>
                    <td>
                      <Badge tone={statusTone(o.status)}>{o.statusLabel}</Badge>
                    </td>
                    <td>
                      <Badge tone={paymentTone(o.payment.status)}>{PAYMENT_STATUS_LABELS[o.payment.status]}</Badge>
                    </td>
                    <td className="text-right tabular-nums">{formatPrice(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => toggle.mutate()}
        loading={toggle.isPending}
        title={c.isActive ? 'Disable this account?' : 'Enable this account?'}
        description={c.isActive ? 'The customer will be signed out everywhere and cannot sign in. Their orders are kept.' : 'The customer will be able to sign in again.'}
        tone={c.isActive ? 'danger' : 'primary'}
        confirmLabel={c.isActive ? 'Disable' : 'Enable'}
      />
    </>
  );
}
