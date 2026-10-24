import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Flag, RotateCcw, Truck, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { PageHeader, Panel } from '../../components/admin/AdminLayout';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog, Modal } from '../../components/ui/Dialog';
import { Alert, Badge, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { Checkbox, Input, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { api, errorMessage } from '../../lib/api';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, paymentTone, statusTone } from '../../lib/constants';
import { formatDateTime, formatPrice, paiseToRupees, rupeesToPaise } from '../../lib/format';
import type { AdminOrder } from './types';

const shipmentSchema = z.object({
  courierName: z.string().trim().min(2, 'Enter the courier name'),
  trackingNumber: z.string().trim().min(3, 'Enter the tracking number').regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and - only'),
  trackingUrl: z.union([z.literal(''), z.string().trim().url('Enter a full https:// link').startsWith('https://', 'Use an https:// link')]).optional(),
});
type ShipmentForm = z.infer<typeof shipmentSchema>;

const actorText = (a: AdminOrder['timeline'][number]['actor']) => (a.type === 'system' ? 'System' : a.type === 'customer' ? `Customer${a.name && a.name !== 'Guest' ? ` (${a.name})` : ''}` : `${a.name ?? 'Staff'} · ${a.type}`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export default function OrderDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const canRefund = useCan('orders:refund');
  const key = ['admin', 'order', id];
  const { data: order, isLoading, isError, refetch } = useQuery({ queryKey: key, queryFn: () => api.get<AdminOrder>(`/admin/orders/${id}`) });
  useDocumentTitle(order ? `Order ${order.orderNumber}` : 'Order');

  const [dialog, setDialog] = useState<null | 'cancel' | 'ship' | 'shipment' | 'return' | 'refund' | 'manualRefund' | 'cod'>(null);
  const [nextStatus, setNextStatus] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [statusNote, setStatusNote] = useState('');

  const onDone = (msg: string) => (data: unknown) => {
    const fresh = (data as { order?: AdminOrder }).order ?? (data as AdminOrder);
    if (fresh?.id) qc.setQueryData(key, (prev: AdminOrder | undefined) => ({ ...prev, ...fresh }));
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    setDialog(null);
    setNextStatus(null);
    toast(msg);
  };
  const onFail = (e: unknown) => toast(errorMessage(e), 'error');

  const transition = useMutation({
    mutationFn: (v: { status: string; note?: string; shipment?: ShipmentForm }) =>
      api.post<AdminOrder>(`/admin/orders/${id}/status`, { ...v, shipment: v.shipment ? { ...v.shipment, trackingUrl: v.shipment.trackingUrl || undefined } : undefined }),
    onSuccess: onDone('Status updated'),
    onError: onFail,
  });
  const cancel = useMutation({ mutationFn: (reason: string) => api.post<AdminOrder>(`/admin/orders/${id}/cancel`, { reason }), onSuccess: onDone('Order cancelled and stock released'), onError: onFail });
  const shipment = useMutation({
    mutationFn: (v: ShipmentForm) => api.put<AdminOrder>(`/admin/orders/${id}/shipment`, { ...v, trackingUrl: v.trackingUrl || undefined }),
    onSuccess: onDone('Tracking details saved'),
    onError: onFail,
  });
  const addNote = useMutation({
    mutationFn: (n: string) => api.post<AdminOrder>(`/admin/orders/${id}/notes`, { note: n }),
    onSuccess: (d) => {
      setNote('');
      onDone('Note added')(d);
    },
    onError: onFail,
  });
  const clearFlag = useMutation({ mutationFn: () => api.post<AdminOrder>(`/admin/orders/${id}/clear-attention`), onSuccess: onDone('Flag cleared'), onError: onFail });
  const resolveReturn = useMutation({
    mutationFn: (v: { approve: boolean; restock: boolean; note?: string }) => api.post<AdminOrder>(`/admin/orders/${id}/return`, v),
    onSuccess: onDone('Return updated'),
    onError: onFail,
  });
  const refund = useMutation({
    mutationFn: (v: { amount?: number; reason: string }) => api.post<{ order: AdminOrder; refund: { status: string } }>(`/admin/orders/${id}/refunds`, v),
    onSuccess: (d) => onDone(d.refund.status === 'processed' ? 'Refund processed by Razorpay' : 'Refund requested — awaiting Razorpay confirmation')(d),
    onError: onFail,
  });
  const manualRefund = useMutation({
    mutationFn: (v: { amount: number; reference: string }) => api.post<{ order: AdminOrder }>(`/admin/orders/${id}/manual-refunds`, v),
    onSuccess: onDone('Manual refund recorded'),
    onError: onFail,
  });
  const cod = useMutation({ mutationFn: (reference: string) => api.post<AdminOrder>(`/admin/orders/${id}/cod-collected`, { reference: reference || undefined }), onSuccess: onDone('COD payment recorded'), onError: onFail });

  const shipForm = useForm<ShipmentForm>({ resolver: zodResolver(shipmentSchema) });
  useEffect(() => {
    if (order && (dialog === 'ship' || dialog === 'shipment')) {
      shipForm.reset({ courierName: order.shipment.courierName ?? '', trackingNumber: order.shipment.trackingNumber ?? '', trackingUrl: order.shipment.trackingUrl ?? '' });
    }
  }, [dialog, order, shipForm]);

  if (isLoading) return <PageLoader />;
  if (isError || !order) return <ErrorState message="Could not load this order." onRetry={() => refetch()} />;

  const refundable = order.payment.amountPaid - order.payment.amountRefunded - order.payment.refundReserved;
  const a = order.actions;

  return (
    <>
      <PageHeader
        back={{ to: '/admin/orders', label: 'Orders' }}
        title={order.orderNumber}
        description={`Placed ${formatDateTime(order.createdAt)} · ${order.itemCount} items · ${order.payment.method === 'cod' ? 'Cash on Delivery' : 'Online payment'}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(order.status)} className="text-xs">
              {order.statusLabel}
            </Badge>
            <Badge tone={paymentTone(order.payment.status)} className="text-xs">
              {PAYMENT_STATUS_LABELS[order.payment.status]}
            </Badge>
          </div>
        }
      />

      {order.attention && (
        <Alert
          tone="danger"
          className="mb-4"
          title="Needs attention"
          action={
            <Button size="sm" variant="secondary" onClick={() => clearFlag.mutate()} loading={clearFlag.isPending}>
              Mark resolved
            </Button>
          }
        >
          {order.attention.reason}
        </Alert>
      )}
      {order.status === 'pending_payment' && order.reservationExpiresAt && (
        <Alert tone="warning" className="mb-4">
          Awaiting online payment. Stock is reserved until {formatDateTime(order.reservationExpiresAt)}; the order is cancelled automatically if payment isn’t verified by then.
        </Alert>
      )}

      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-line bg-paper p-3 shadow-soft">
        {a.transitions.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === 'processing' && a.transitions.length > 1 ? 'secondary' : 'primary'}
            icon={s === 'shipped' ? <Truck className="size-4" /> : undefined}
            onClick={() => (s === 'shipped' ? setDialog('ship') : setNextStatus(s))}
          >
            Mark as {ORDER_STATUS_LABELS[s]}
          </Button>
        ))}
        {a.canEditShipment && (
          <Button size="sm" variant="secondary" icon={<Truck className="size-4" />} onClick={() => setDialog('shipment')}>
            {order.shipment.trackingNumber ? 'Edit tracking' : 'Add tracking'}
          </Button>
        )}
        {a.canRecordCodPayment && (
          <Button size="sm" variant="secondary" icon={<Banknote className="size-4" />} onClick={() => setDialog('cod')}>
            Record COD payment
          </Button>
        )}
        {a.canResolveReturn && (
          <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => setDialog('return')}>
            Resolve return
          </Button>
        )}
        {canRefund && a.canRefund && (
          <Button size="sm" variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => setDialog('refund')}>
            Refund via Razorpay
          </Button>
        )}
        {canRefund && a.canRecordManualRefund && (
          <Button size="sm" variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => setDialog('manualRefund')}>
            Record manual refund
          </Button>
        )}
        {a.canCancel && (
          <Button size="sm" variant="ghost" className="text-danger hover:text-danger" icon={<X className="size-4" />} onClick={() => setDialog('cancel')}>
            Cancel order
          </Button>
        )}
        {!a.transitions.length && !a.canCancel && !a.canEditShipment && !a.canResolveReturn && !a.canRefund && !a.canRecordCodPayment && !a.canRecordManualRefund && (
          <p className="px-2 py-1.5 text-sm text-muted">No further actions for this order.</p>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Panel title="Items" padded={false}>
            <ul className="divide-y divide-line">
              {order.items.map((i) => (
                <li key={i.sku} className="flex items-center gap-4 px-5 py-3">
                  {i.image ? <img src={i.image} alt="" className="size-14 rounded-xl bg-blush-50 object-cover" /> : <div className="size-14 rounded-xl bg-blush-50" />}
                  <div className="min-w-0 flex-1 text-sm">
                    <Link to={`/admin/products/${i.product}`} className="font-medium hover:text-rose-700">
                      {i.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {i.sku}
                      {i.variantLabel ? ` · ${i.variantLabel}` : ''}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums text-ink-soft">
                    {i.quantity} × {formatPrice(i.unitPrice)}
                  </span>
                  <span className="w-20 text-right text-sm font-medium tabular-nums">{formatPrice(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="border-t border-line px-5 py-4">
              <Row label="Subtotal">{formatPrice(order.pricing.subtotal)}</Row>
              {order.pricing.discount > 0 && <Row label={`Discount${order.coupon ? ` (${order.coupon.code})` : ''}`}>−{formatPrice(order.pricing.discount)}</Row>}
              <Row label="Shipping">{order.pricing.shipping ? formatPrice(order.pricing.shipping) : 'Free'}</Row>
              {order.pricing.codFee > 0 && <Row label="COD fee">{formatPrice(order.pricing.codFee)}</Row>}
              <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatPrice(order.pricing.total)}</span>
              </div>
              <p className="mt-2 text-xs text-muted">Prices are snapshots from when the order was placed and cannot be edited.</p>
            </dl>
          </Panel>

          <Panel title="Timeline">
            <ol className="relative space-y-5 border-l border-gold-300 pl-6">
              {[...order.timeline].reverse().map((t, i) => (
                <li key={`${t.status}${t.at}${i}`} className="relative">
                  <span className="absolute -left-[31px] top-1 size-3.5 rounded-full bg-gold-400 ring-4 ring-paper" />
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(t.at)} · {actorText(t.actor)}
                  </p>
                  {t.note && <p className="mt-0.5 text-sm text-ink-soft">“{t.note}” <span className="text-xs text-muted">(visible to customer)</span></p>}
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Internal notes">
            <p className="mb-3 text-xs text-muted">Only staff can see these.</p>
            {order.internalNotes.length > 0 && (
              <ul className="mb-4 space-y-3">
                {[...order.internalNotes].reverse().map((n, i) => (
                  <li key={i} className="rounded-xl bg-cream/60 px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap">{n.note}</p>
                    <p className="mt-1 text-xs text-muted">
                      {n.by} · {formatDateTime(n.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) addNote.mutate(note.trim());
              }}
            >
              <Textarea wrapperClassName="flex-1" label="Add a note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
              <Button type="submit" variant="secondary" loading={addNote.isPending} disabled={!note.trim()}>
                Add note
              </Button>
            </form>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Customer">
            <dl>
              <Row label="Name">{order.customer.name}</Row>
              <Row label="Email">
                <a href={`mailto:${order.customer.email}`} className="text-rose-700 hover:underline">
                  {order.customer.email}
                </a>
              </Row>
              <Row label="Phone">+91 {order.customer.phone}</Row>
              <Row label="Account">{order.user ? <Link to={`/admin/customers/${order.user}`} className="text-rose-700 hover:underline">View customer</Link> : 'Guest checkout'}</Row>
              <Row label="WhatsApp updates">{order.whatsappOptIn ? 'Opted in' : 'Not opted in'}</Row>
            </dl>
            {order.customerNote && (
              <div className="mt-3 rounded-xl bg-blush-50 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">Customer note</p>
                <p className="mt-1">{order.customerNote}</p>
              </div>
            )}
          </Panel>
          <Panel title="Ship to">
            <address className="text-sm not-italic leading-relaxed">
              <strong>{order.shippingAddress.fullName}</strong>
              <br />
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 && (
                <>
                  <br />
                  {order.shippingAddress.line2}
                </>
              )}
              {order.shippingAddress.landmark && (
                <>
                  <br />
                  Near {order.shippingAddress.landmark}
                </>
              )}
              <br />
              {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.pincode}
              <br />
              +91 {order.shippingAddress.phone}
            </address>
          </Panel>
          <Panel title="Shipment">
            {order.shipment.trackingNumber ? (
              <dl>
                <Row label="Courier">{order.shipment.courierName}</Row>
                <Row label="Tracking no.">
                  <span className="font-mono">{order.shipment.trackingNumber}</span>
                </Row>
                {order.shipment.trackingUrl && (
                  <Row label="Link">
                    <a href={order.shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-rose-700 hover:underline">
                      Open
                    </a>
                  </Row>
                )}
                <Row label="Shipped">{formatDateTime(order.shipment.shippedAt)}</Row>
                <Row label="Delivered">{formatDateTime(order.shipment.deliveredAt)}</Row>
              </dl>
            ) : (
              <p className="text-sm text-muted">No tracking added yet. Courier scans appear only from a connected courier integration (none configured).</p>
            )}
          </Panel>
          <Panel title="Payment">
            <dl>
              <Row label="Method">{order.payment.method === 'cod' ? 'Cash on Delivery' : 'Razorpay'}</Row>
              <Row label="Status">
                <Badge tone={paymentTone(order.payment.status)}>{PAYMENT_STATUS_LABELS[order.payment.status]}</Badge>
              </Row>
              <Row label="Paid">{formatPrice(order.payment.amountPaid)}</Row>
              {order.payment.amountRefunded > 0 && <Row label="Refunded">{formatPrice(order.payment.amountRefunded)}</Row>}
              {order.payment.paidAt && <Row label="Paid at">{formatDateTime(order.payment.paidAt)}</Row>}
              {order.payment.razorpayPaymentId && (
                <Row label="Payment ID">
                  <span className="font-mono text-xs">{order.payment.razorpayPaymentId}</span>
                </Row>
              )}
            </dl>
            {order.transactions.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Ledger</p>
                <ul className="space-y-2 text-xs">
                  {order.transactions.map((t) => (
                    <li key={t.id} className="flex justify-between gap-3">
                      <span>
                        <span className="font-medium capitalize">
                          {t.provider} {t.type}
                        </span>{' '}
                        · {t.status}
                        {t.verifiedVia.length > 0 && <span className="text-muted"> · via {t.verifiedVia.join(', ')}</span>}
                        {t.errorDescription && <span className="block text-danger">{t.errorDescription}</span>}
                        {t.reference && <span className="block text-muted">Ref: {t.reference}</span>}
                      </span>
                      <span className="shrink-0 tabular-nums">{formatPrice(t.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
          <Panel title="Notifications">
            {!order.notifications.length ? (
              <p className="text-sm text-muted">No notifications recorded.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {order.notifications.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2">
                    <span>
                      {n.event.replace(/_/g, ' ')} · {n.channel}
                    </span>
                    <Badge tone={n.status === 'sent' ? 'success' : n.status === 'failed' ? 'danger' : 'neutral'}>{n.status === 'skipped' ? `skipped (${n.reason?.replace(/_/g, ' ')})` : n.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* Simple transitions */}
      <Modal
        open={!!nextStatus}
        onClose={() => setNextStatus(null)}
        title={`Mark as ${nextStatus ? ORDER_STATUS_LABELS[nextStatus] : ''}?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNextStatus(null)}>
              Cancel
            </Button>
            <Button loading={transition.isPending} onClick={() => nextStatus && transition.mutate({ status: nextStatus, note: statusNote.trim() || undefined })}>
              Update status
            </Button>
          </>
        }
      >
        <StatusNote onChange={setStatusNote} />
      </Modal>

      {/* Ship (requires tracking) and edit tracking */}
      <Modal
        open={dialog === 'ship' || dialog === 'shipment'}
        onClose={() => setDialog(null)}
        title={dialog === 'ship' ? 'Mark as shipped' : 'Tracking details'}
        description={dialog === 'ship' ? 'The customer is notified with these details (when email is configured).' : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              loading={transition.isPending || shipment.isPending}
              onClick={shipForm.handleSubmit((v) => (dialog === 'ship' ? transition.mutate({ status: 'shipped', shipment: v, note: statusNote.trim() || undefined }) : shipment.mutate(v)))}
            >
              {dialog === 'ship' ? 'Mark shipped' : 'Save tracking'}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Input label="Courier" placeholder="Delhivery, DTDC, India Post…" required {...shipForm.register('courierName')} error={shipForm.formState.errors.courierName?.message} />
          <Input label="Tracking number (AWB)" required {...shipForm.register('trackingNumber')} error={shipForm.formState.errors.trackingNumber?.message} />
          <Input label="Tracking link (optional)" placeholder="https://…" {...shipForm.register('trackingUrl')} error={shipForm.formState.errors.trackingUrl?.message} />
          {dialog === 'ship' && <StatusNote onChange={setStatusNote} />}
        </form>
      </Modal>

      <ConfirmDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => cancel.mutate(reason)}
        loading={cancel.isPending}
        title="Cancel this order?"
        description={
          <>
            Reserved stock is returned to inventory and any coupon use is released.
            {order.payment.amountPaid > 0 && <strong className="mt-2 block">This order is paid — issue the refund after cancelling.</strong>}
          </>
        }
        requireReason
        reasonLabel="Reason (shown to the customer)"
        confirmLabel="Cancel order"
        tone="danger"
      />

      <ReturnDialog open={dialog === 'return'} onClose={() => setDialog(null)} loading={resolveReturn.isPending} reason={order.returnRequest?.reason} onSubmit={(v) => resolveReturn.mutate(v)} />

      <RefundDialog open={dialog === 'refund'} onClose={() => setDialog(null)} max={refundable} loading={refund.isPending} onSubmit={(amount, reason) => refund.mutate({ amount, reason })} />

      <ManualRefundDialog open={dialog === 'manualRefund'} onClose={() => setDialog(null)} max={refundable} loading={manualRefund.isPending} onSubmit={(amount, reference) => manualRefund.mutate({ amount, reference })} />

      <CodDialog open={dialog === 'cod'} onClose={() => setDialog(null)} amount={order.pricing.total} loading={cod.isPending} onSubmit={(ref) => cod.mutate(ref)} />
    </>
  );
}

function StatusNote({ onChange }: { onChange: (v: string) => void }) {
  useEffect(() => () => onChange(''), [onChange]);
  return <Textarea label="Note for the customer (optional)" rows={2} maxLength={500} onChange={(e) => onChange(e.target.value)} hint="Shown on the customer’s tracking timeline." />;
}

function ReturnDialog({ open, onClose, onSubmit, loading, reason }: { open: boolean; onClose: () => void; onSubmit: (v: { approve: boolean; restock: boolean; note?: string }) => void; loading: boolean; reason?: string }) {
  const [restock, setRestock] = useState(true);
  const [note, setNote] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resolve return request"
      footer={
        <>
          <Button variant="secondary" loading={loading} onClick={() => onSubmit({ approve: false, restock: false, note: note || undefined })}>
            Decline
          </Button>
          <Button loading={loading} onClick={() => onSubmit({ approve: true, restock, note: note || undefined })}>
            Mark returned
          </Button>
        </>
      }
    >
      {reason && (
        <div className="mb-4 rounded-xl bg-blush-50 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">Customer’s reason</p>
          <p className="mt-1">{reason}</p>
        </div>
      )}
      <p className="text-sm text-ink-soft">Mark as returned once you have received the item. Refunds are issued separately.</p>
      <Checkbox className="mt-4" label="Add returned items back to stock" description="Untick if the item is damaged and can’t be resold." checked={restock} onChange={(e) => setRestock(e.target.checked)} />
      <Textarea wrapperClassName="mt-4" label="Note for the customer (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

function RefundDialog({ open, onClose, onSubmit, max, loading }: { open: boolean; onClose: () => void; onSubmit: (amount: number, reason: string) => void; max: number; loading: boolean }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) {
      setAmount(paiseToRupees(max));
      setReason('');
    }
  }, [open, max]);
  const paise = rupeesToPaise(amount);
  const invalid = !paise || paise <= 0 || paise > max || reason.trim().length < 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Refund via Razorpay"
      description="Money is returned to the customer’s original payment method. The order is marked refunded only after Razorpay confirms it."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} disabled={invalid} onClick={() => paise && onSubmit(paise, reason.trim())}>
            Refund {paise ? formatPrice(paise) : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Amount (₹)" inputMode="decimal" prefix="₹" value={amount} onChange={(e) => setAmount(e.target.value)} hint={`Up to ${formatPrice(max)}`} error={paise && paise > max ? 'More than the refundable amount' : undefined} />
        <Textarea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />
      </div>
    </Modal>
  );
}

function ManualRefundDialog({ open, onClose, onSubmit, max, loading }: { open: boolean; onClose: () => void; onSubmit: (amount: number, reference: string) => void; max: number; loading: boolean }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  useEffect(() => {
    if (open) {
      setAmount(paiseToRupees(max));
      setReference('');
    }
  }, [open, max]);
  const paise = rupeesToPaise(amount);
  const invalid = !paise || paise <= 0 || paise > max || reference.trim().length < 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a manual refund"
      description="For COD orders refunded outside the system (UPI, bank transfer or cash). This only records the refund — make the payment first."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} disabled={invalid} onClick={() => paise && onSubmit(paise, reference.trim())}>
            Record refund
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Amount refunded (₹)" inputMode="decimal" prefix="₹" value={amount} onChange={(e) => setAmount(e.target.value)} hint={`Up to ${formatPrice(max)}`} />
        <Input label="Payment reference" placeholder="UPI transaction ID / bank reference" value={reference} onChange={(e) => setReference(e.target.value)} required />
      </div>
    </Modal>
  );
}

function CodDialog({ open, onClose, onSubmit, amount, loading }: { open: boolean; onClose: () => void; onSubmit: (reference: string) => void; amount: number; loading: boolean }) {
  const [reference, setReference] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record COD payment"
      description={`Confirm that ${formatPrice(amount)} was collected (e.g. courier remittance received).`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} onClick={() => onSubmit(reference.trim())} icon={<Flag className="size-4" />}>
            Mark as paid
          </Button>
        </>
      }
    >
      <Input label="Remittance reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
    </Modal>
  );
}
