import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader, Panel, Table } from '../../components/admin/AdminLayout';
import { Button, IconButton } from '../../components/ui/Button';
import { ConfirmDialog, Modal } from '../../components/ui/Dialog';
import { Alert, Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { ApiError, api, errorMessage } from '../../lib/api';
import { formatDate, formatPrice, paiseToRupees, rupeesToPaise } from '../../lib/format';
import type { PageMeta } from '../../lib/types';

interface Coupon {
  id: string;
  code: string;
  description: string;
  type: 'percent' | 'fixed';
  value: number;
  maxDiscount: number | null;
  minOrderValue: number;
  startsAt: string | null;
  expiresAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  isActive: boolean;
  state: 'active' | 'inactive' | 'expired' | 'scheduled' | 'exhausted';
}

const optionalInt = z.union([z.literal(''), z.coerce.number().int().positive()]);
const optionalRupees = z.union([z.literal(''), z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount')]);

const schema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,29}$/, '3–30 letters, numbers, - or _'),
    description: z.string().trim().max(200),
    type: z.enum(['percent', 'fixed']),
    value: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Enter a number'),
    maxDiscount: optionalRupees,
    minOrderValue: optionalRupees,
    startsAt: z.string(),
    expiresAt: z.string(),
    usageLimit: optionalInt,
    perCustomerLimit: optionalInt,
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const n = Number(v.value);
    if (v.type === 'percent' && (!Number.isInteger(n) || n < 1 || n > 90)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Whole percentage 1–90' });
    if (v.type === 'fixed' && n <= 0) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Must be more than ₹0' });
    if (v.startsAt && v.expiresAt && v.expiresAt <= v.startsAt) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Must be after the start date' });
  });
type FormIn = z.input<typeof schema>;

const stateTone = { active: 'success', inactive: 'neutral', expired: 'danger', scheduled: 'info', exhausted: 'warning' } as const;
const toLocalInput = (d: string | null) => (d ? new Date(new Date(d).getTime() - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export default function Coupons() {
  useDocumentTitle('Coupons');
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan('coupons:write');
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin', 'coupons'], queryFn: () => api.get<{ items: Coupon[]; meta: PageMeta }>('/admin/coupons', { limit: 100 }) });
  const form = useForm<FormIn>({ resolver: zodResolver(schema) });
  const type = useWatch({ control: form.control, name: 'type' });

  useEffect(() => {
    if (editing === 'new') form.reset({ code: '', description: '', type: 'percent', value: '10', maxDiscount: '', minOrderValue: '', startsAt: '', expiresAt: '', usageLimit: '', perCustomerLimit: 1, isActive: true });
    else if (editing)
      form.reset({
        code: editing.code,
        description: editing.description,
        type: editing.type,
        value: editing.type === 'percent' ? String(editing.value) : paiseToRupees(editing.value),
        maxDiscount: paiseToRupees(editing.maxDiscount),
        minOrderValue: editing.minOrderValue ? paiseToRupees(editing.minOrderValue) : '',
        startsAt: toLocalInput(editing.startsAt),
        expiresAt: toLocalInput(editing.expiresAt),
        usageLimit: editing.usageLimit ?? '',
        perCustomerLimit: editing.perCustomerLimit ?? '',
        isActive: editing.isActive,
      });
  }, [editing, form]);

  const save = useMutation({
    mutationFn: (v: z.output<typeof schema>) => {
      const body = {
        code: v.code,
        description: v.description || undefined,
        type: v.type,
        value: v.type === 'percent' ? Number(v.value) : rupeesToPaise(v.value),
        maxDiscount: v.type === 'percent' && v.maxDiscount ? rupeesToPaise(v.maxDiscount) : null,
        minOrderValue: v.minOrderValue ? rupeesToPaise(v.minOrderValue) : 0,
        startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : null,
        expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null,
        usageLimit: v.usageLimit === '' ? null : v.usageLimit,
        perCustomerLimit: v.perCustomerLimit === '' ? null : v.perCustomerLimit,
        isActive: v.isActive,
      };
      return editing && editing !== 'new' ? api.put(`/admin/coupons/${editing.id}`, body) : api.post('/admin/coupons', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'coupons'] });
      setEditing(null);
      toast('Coupon saved');
    },
    onError: (err) => {
      if (err instanceof ApiError) for (const [k, m] of Object.entries(err.details ?? {})) if (typeof m === 'string') form.setError(k as never, { message: m });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/coupons/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'coupons'] });
      setDeleting(null);
      toast('Coupon deleted');
    },
    onError: (e) => {
      setDeleting(null);
      toast(errorMessage(e), 'error');
    },
  });

  const e = form.formState.errors;
  return (
    <>
      <PageHeader
        title="Coupons"
        description="Discounts are validated on the server at checkout, including usage limits per customer (email and phone)."
        actions={
          canWrite && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              New coupon
            </Button>
          )
        }
      />
      <Panel padded={false}>
        {isError ? (
          <ErrorState message="Could not load coupons." onRetry={() => refetch()} />
        ) : isLoading ? (
          <Skeleton className="m-5 h-12" />
        ) : !data?.items.length ? (
          <EmptyState title="No coupons yet" description="Create a welcome offer or festive discount." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Min. order</th>
                <th>Valid</th>
                <th>Used</th>
                <th>Status</th>
                {canWrite && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <span className="font-mono font-semibold tracking-wider">{c.code}</span>
                    {c.description && <p className="text-xs text-muted">{c.description}</p>}
                  </td>
                  <td>
                    {c.type === 'percent' ? `${c.value}%` : formatPrice(c.value)}
                    {c.maxDiscount && <span className="text-xs text-muted"> (max {formatPrice(c.maxDiscount)})</span>}
                  </td>
                  <td>{c.minOrderValue ? formatPrice(c.minOrderValue) : '—'}</td>
                  <td className="whitespace-nowrap text-xs text-ink-soft">
                    {c.startsAt ? formatDate(c.startsAt) : 'Now'} → {c.expiresAt ? formatDate(c.expiresAt) : 'No expiry'}
                  </td>
                  <td className="tabular-nums">
                    {c.usedCount}
                    {c.usageLimit ? ` / ${c.usageLimit}` : ''}
                    {c.perCustomerLimit && <span className="block text-xs text-muted">{c.perCustomerLimit}× per customer</span>}
                  </td>
                  <td>
                    <Badge tone={stateTone[c.state]}>{c.state}</Badge>
                  </td>
                  {canWrite && (
                    <td className="text-right">
                      <IconButton label={`Edit ${c.code}`} onClick={() => setEditing(c)}>
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton label={`Delete ${c.code}`} onClick={() => setDeleting(c)}>
                        <Trash className="size-4" />
                      </IconButton>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New coupon' : 'Edit coupon'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((raw) => save.mutate(schema.parse(raw)))}>
              Save coupon
            </Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(ev) => ev.preventDefault()}>
          {save.error && <Alert tone="danger" className="sm:col-span-2">{errorMessage(save.error)}</Alert>}
          <Input label="Code" className="font-mono uppercase tracking-wider" required {...form.register('code')} error={e.code?.message} disabled={editing !== 'new' && !!editing && editing.usedCount > 0} hint={editing !== 'new' && editing && editing.usedCount > 0 ? 'Locked after first use' : undefined} />
          <Input label="Description (internal)" {...form.register('description')} />
          <Select label="Type" {...form.register('type')}>
            <option value="percent">Percentage off</option>
            <option value="fixed">Fixed amount off</option>
          </Select>
          <Input label={type === 'percent' ? 'Percentage' : 'Amount'} prefix={type === 'percent' ? '%' : '₹'} inputMode="decimal" required {...form.register('value')} error={e.value?.message} />
          {type === 'percent' && <Input label="Maximum discount" prefix="₹" inputMode="decimal" {...form.register('maxDiscount')} error={e.maxDiscount?.message} hint="Optional cap" />}
          <Input label="Minimum order value" prefix="₹" inputMode="decimal" {...form.register('minOrderValue')} error={e.minOrderValue?.message} hint="Subtotal before shipping" />
          <Input label="Starts" type="datetime-local" {...form.register('startsAt')} />
          <Input label="Expires" type="datetime-local" {...form.register('expiresAt')} error={e.expiresAt?.message} />
          <Input label="Total uses allowed" type="number" min={1} {...form.register('usageLimit')} hint="Blank = unlimited" error={e.usageLimit?.message} />
          <Input label="Uses per customer" type="number" min={1} {...form.register('perCustomerLimit')} hint="Blank = unlimited" error={e.perCustomerLimit?.message} />
          <div className="sm:col-span-2">
            <Checkbox label="Active" {...form.register('isActive')} />
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
        title={`Delete ${deleting?.code ?? ''}?`}
        description="Coupons that have been used cannot be deleted — deactivate them instead."
        tone="danger"
        confirmLabel="Delete"
      />
    </>
  );
}
