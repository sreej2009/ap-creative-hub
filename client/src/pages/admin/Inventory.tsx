import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FilterBar, PageHeader, Panel, Table } from '../../components/admin/AdminLayout';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Dialog';
import { Alert, Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Input, Select, Textarea } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../hooks/useAuth';
import { useDebounced, useDocumentTitle } from '../../hooks/useStore';
import { api, errorMessage } from '../../lib/api';
import { cn, formatDateTime } from '../../lib/format';
import type { PageMeta } from '../../lib/types';

interface InvItem {
  id: string;
  name: string;
  sku: string;
  status: string;
  stock: number;
  lowStockThreshold: number;
  image: string | null;
  category: string | null;
  stockState: 'in' | 'low' | 'out';
  variants: { id: string; sku: string; label: string; stock: number; isActive: boolean }[];
}
interface Adjustment {
  id: string;
  product: { id: string; name: string } | null;
  sku: string;
  delta: number;
  stockAfter: number;
  reason: string;
  order: string | null;
  actor: { type: string; name?: string };
  note: string | null;
  createdAt: string;
}

const REASON_LABELS: Record<string, string> = {
  initial_stock: 'Opening stock',
  restock: 'Restock',
  correction: 'Correction / count',
  damaged: 'Damaged',
  lost: 'Lost / missing',
  order_reserved: 'Order',
  order_released: 'Order released',
  return_restock: 'Return restocked',
  other: 'Other',
};

function AdjustDialog({ item, onClose }: { item: InvItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [variantId, setVariantId] = useState('');
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('restock');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (item) {
      setVariantId(item.variants[0]?.id ?? '');
      setMode('delta');
      setQty('');
      setReason('restock');
      setNote('');
    }
  }, [item]);
  const variant = item?.variants.find((v) => v.id === variantId);
  const current = variant ? variant.stock : item?.stock ?? 0;
  const n = Number(qty);
  const valid = qty !== '' && Number.isInteger(n) && (mode === 'set' ? n >= 0 : n !== 0) && (mode === 'set' || current + n >= 0);
  const adjust = useMutation({
    mutationFn: () => api.post<{ stock: number }>(`/admin/inventory/${item!.id}/adjust`, { variantId: variantId || undefined, mode, quantity: n, reason, note: note || undefined }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin', 'inventory'] });
      qc.invalidateQueries({ queryKey: ['admin', 'adjustments'] });
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      toast(`Stock updated to ${r.stock}`);
      onClose();
    },
  });
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title="Adjust stock"
      description={item?.name}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={adjust.isPending} disabled={!valid} onClick={() => adjust.mutate()}>
            Save adjustment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {adjust.error && <Alert tone="danger">{errorMessage(adjust.error)}</Alert>}
        {!!item?.variants.length && (
          <Select label="Variant" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            {item.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} ({v.sku}) — {v.stock} in stock
              </option>
            ))}
          </Select>
        )}
        <p className="text-sm text-ink-soft">
          Current stock: <strong>{current}</strong>
        </p>
        <div role="group" aria-label="Adjustment type" className="inline-flex rounded-full border border-line-strong p-1 text-[13px]">
          {(['delta', 'set'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={cn('rounded-full px-4 py-1.5', mode === m ? 'bg-ink text-ivory' : 'text-ink-soft')}>
              {m === 'delta' ? 'Add / remove' : 'Set exact count'}
            </button>
          ))}
        </div>
        <Input
          label={mode === 'delta' ? 'Change (use − to remove)' : 'New stock level'}
          type="number"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          hint={valid && mode === 'delta' ? `New stock will be ${current + n}` : valid ? `Change of ${n - current >= 0 ? '+' : ''}${n - current}` : undefined}
          error={qty !== '' && mode === 'delta' && current + n < 0 ? 'Stock cannot go below zero' : undefined}
        />
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {['restock', 'correction', 'damaged', 'lost', 'other'].map((r) => (
            <option key={r} value={r}>
              {REASON_LABELS[r]}
            </option>
          ))}
        </Select>
        <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}

export default function Inventory() {
  useDocumentTitle('Inventory');
  const canWrite = useCan('inventory:write');
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'stock' | 'history'>(params.get('tab') === 'history' ? 'history' : 'stock');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search, 350);
  const [stock, setStock] = useState(params.get('stock') ?? '');
  const [page, setPage] = useState(1);
  const [histPage, setHistPage] = useState(1);
  const [adjusting, setAdjusting] = useState<InvItem | null>(null);

  useEffect(() => {
    setPage(1);
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (stock) next.set('stock', stock);
    if (tab === 'history') next.set('tab', 'history');
    setParams(next, { replace: true });
  }, [q, stock, tab, setParams]);

  const list = useQuery({
    queryKey: ['admin', 'inventory', q, stock, page],
    queryFn: () => api.get<{ items: InvItem[]; meta: PageMeta }>('/admin/inventory', { q, stock, page, limit: 25 }),
    placeholderData: keepPreviousData,
    enabled: tab === 'stock',
  });
  const history = useQuery({
    queryKey: ['admin', 'adjustments', histPage],
    queryFn: () => api.get<{ items: Adjustment[]; meta: PageMeta }>('/admin/inventory/adjustments', { page: histPage, limit: 30 }),
    placeholderData: keepPreviousData,
    enabled: tab === 'history',
  });

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every stock change is recorded with a reason. Orders reserve stock automatically."
        actions={
          <div role="tablist" className="inline-flex rounded-full border border-line-strong bg-paper p-1 text-[13px]">
            <button role="tab" aria-selected={tab === 'stock'} type="button" onClick={() => setTab('stock')} className={cn('rounded-full px-4 py-1.5', tab === 'stock' ? 'bg-ink text-ivory' : 'text-ink-soft')}>
              Stock levels
            </button>
            <button role="tab" aria-selected={tab === 'history'} type="button" onClick={() => setTab('history')} className={cn('inline-flex items-center gap-1.5 rounded-full px-4 py-1.5', tab === 'history' ? 'bg-ink text-ivory' : 'text-ink-soft')}>
              <History className="size-3.5" /> History
            </button>
          </div>
        }
      />

      {tab === 'stock' ? (
        <>
          <FilterBar>
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-[38px] size-4 text-muted" aria-hidden />
              <Input label="Search" placeholder="Name or SKU" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
            <Select label="Stock level" value={stock} onChange={(e) => setStock(e.target.value)}>
              <option value="">All</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
              <option value="in">In stock</option>
            </Select>
          </FilterBar>
          <Panel padded={false}>
            {list.isError ? (
              <ErrorState message="Could not load inventory." onRetry={() => list.refetch()} />
            ) : list.isLoading ? (
              <div className="space-y-2 p-5">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : !list.data?.items.length ? (
              <EmptyState title="Nothing matches" description="Try another search or stock filter." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Stock</th>
                    <th>Alert at</th>
                    <th>Variants</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link to={`/admin/products/${i.id}`} className="flex items-center gap-3">
                          {i.image ? <img src={i.image} alt="" className="size-10 rounded-lg bg-blush-50 object-cover" /> : <div className="size-10 rounded-lg bg-blush-50" />}
                          <span>
                            <span className="block font-medium hover:text-rose-700">{i.name}</span>
                            <span className="text-xs text-muted">
                              {i.sku} · {i.category}
                              {i.status === 'draft' && ' · draft'}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <Badge tone={i.stockState === 'out' ? 'danger' : i.stockState === 'low' ? 'warning' : 'success'}>{i.stock}</Badge>
                      </td>
                      <td className="tabular-nums text-ink-soft">≤ {i.lowStockThreshold}</td>
                      <td className="text-xs text-ink-soft">
                        {i.variants.length ? i.variants.map((v) => `${v.label}: ${v.stock}${v.isActive ? '' : ' (off)'}`).join(' · ') : '—'}
                      </td>
                      <td className="text-right">
                        {canWrite && (
                          <Button size="sm" variant="secondary" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setAdjusting(i)}>
                            Adjust
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
          {list.data && <Pagination className="mt-6" page={list.data.meta.page} pages={list.data.meta.pages} onChange={setPage} />}
        </>
      ) : (
        <>
          <Panel padded={false}>
            {history.isLoading ? (
              <div className="space-y-2 p-5">
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !history.data?.items.length ? (
              <EmptyState title="No stock movements yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Product</th>
                    <th>Change</th>
                    <th>After</th>
                    <th>Reason</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.items.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-ink-soft">{formatDateTime(a.createdAt)}</td>
                      <td>
                        <span className="block max-w-[220px] truncate">{a.product?.name ?? 'Deleted product'}</span>
                        <span className="text-xs text-muted">{a.sku}</span>
                      </td>
                      <td className={cn('font-medium tabular-nums', a.delta > 0 ? 'text-success' : 'text-danger')}>
                        {a.delta > 0 ? '+' : ''}
                        {a.delta}
                      </td>
                      <td className="tabular-nums">{a.stockAfter}</td>
                      <td>
                        {REASON_LABELS[a.reason] ?? a.reason}
                        {a.order && <span className="block text-xs text-muted">{a.order}</span>}
                        {a.note && <span className="block text-xs text-muted">{a.note}</span>}
                      </td>
                      <td className="text-ink-soft">{a.actor.name ?? a.actor.type}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
          {history.data && <Pagination className="mt-6" page={history.data.meta.page} pages={history.data.meta.pages} onChange={setHistPage} />}
        </>
      )}
      <AdjustDialog item={adjusting} onClose={() => setAdjusting(null)} />
    </>
  );
}
