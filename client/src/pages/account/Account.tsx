import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, MapPin, Package, Pencil, Plus, Trash, User as UserIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { AddressFields, addressSchema, phoneSchema } from '../../components/store/AddressFields';
import { OrderView } from '../../components/store/OrderView';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ConfirmDialog, Modal } from '../../components/ui/Dialog';
import { Alert, Badge, EmptyState, ErrorState, PageLoader, Skeleton } from '../../components/ui/Feedback';
import { Checkbox, Input } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { useToast } from '../../components/ui/Toast';
import { useAuthActions, useMe } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { api, errorMessage } from '../../lib/api';
import { statusTone } from '../../lib/constants';
import { cn, formatDate, formatPrice, pluralize } from '../../lib/format';
import type { Address, CustomerOrder, PageMeta, User } from '../../lib/types';

export function AccountLayout() {
  const { data: user, isLoading } = useMe();
  const { logout } = useAuthActions();
  const navigate = useNavigate();
  const location = useLocation();
  if (isLoading) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn('flex items-center gap-2.5 rounded-full px-4 py-2.5 text-sm transition-colors', isActive ? 'bg-ink text-ivory' : 'text-ink-soft hover:bg-blush-50 hover:text-rose-700');
  return (
    <div className="container-page pb-10 pt-8">
      <p className="eyebrow">My account</p>
      <h1 className="mt-1 text-[38px] sm:text-[48px]">Hello, {user.name.split(' ')[0]}</h1>
      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Account" className="flex gap-2 overflow-x-auto lg:flex-col">
          <NavLink to="/account" end className={tab}>
            <UserIcon className="size-4" /> Profile
          </NavLink>
          <NavLink to="/account/orders" className={tab}>
            <Package className="size-4" /> Orders
          </NavLink>
          <NavLink to="/account/addresses" className={tab}>
            <MapPin className="size-4" /> Addresses
          </NavLink>
          <button type="button" onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/') })} className="flex items-center gap-2.5 rounded-full px-4 py-2.5 text-sm text-ink-soft hover:bg-blush-50 hover:text-rose-700">
            <LogOut className="size-4" /> Sign out
          </button>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

const panel = 'rounded-[24px] border border-line bg-paper p-5 shadow-soft sm:p-7';

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  phone: z.union([z.literal(''), phoneSchema]).optional(),
  whatsappOptIn: z.boolean(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(8, 'Use at least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/[0-9]/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function Profile() {
  useDocumentTitle('My account');
  const { data: user } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<z.input<typeof profileSchema>>({ resolver: zodResolver(profileSchema) });
  const pw = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });
  useEffect(() => {
    if (user) form.reset({ name: user.name, phone: user.phone ?? '', whatsappOptIn: user.whatsappOptIn });
  }, [user, form]);

  const save = useMutation({
    mutationFn: (v: z.output<typeof profileSchema>) => api.patch<{ user: User }>('/account/profile', { ...v, phone: v.phone || '' }),
    onSuccess: (r) => {
      qc.setQueryData(['me'], r.user);
      toast('Profile saved');
    },
  });
  const changePw = useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) => api.post('/auth/change-password', v),
    onSuccess: () => {
      pw.reset({ currentPassword: '', newPassword: '', confirm: '' });
      toast('Password updated. Other devices were signed out.');
    },
  });

  return (
    <div className="space-y-6">
      <section className={panel}>
        <h2 className="text-2xl">Profile</h2>
        <form noValidate className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((raw) => save.mutate(profileSchema.parse(raw)))}>
          {save.error && <Alert tone="danger" className="sm:col-span-2">{errorMessage(save.error)}</Alert>}
          <Input label="Full name" required {...form.register('name')} error={form.formState.errors.name?.message} />
          <Input label="Email" value={user?.email ?? ''} readOnly hint="Contact us to change your email." />
          <Input label="Mobile number" type="tel" prefix="+91" {...form.register('phone')} error={form.formState.errors.phone?.message} />
          <div className="sm:col-span-2">
            <Checkbox label="WhatsApp order updates" description="Get shipping updates on WhatsApp when available." {...form.register('whatsappOptIn')} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={save.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </section>
      <section className={panel}>
        <h2 className="text-2xl">Change password</h2>
        <form noValidate className="mt-5 grid gap-4 sm:grid-cols-3" onSubmit={pw.handleSubmit((v) => changePw.mutate({ currentPassword: v.currentPassword, newPassword: v.newPassword }))}>
          {changePw.error && <Alert tone="danger" className="sm:col-span-3">{errorMessage(changePw.error)}</Alert>}
          <Input label="Current password" type="password" autoComplete="current-password" {...pw.register('currentPassword')} error={pw.formState.errors.currentPassword?.message} />
          <Input label="New password" type="password" autoComplete="new-password" {...pw.register('newPassword')} error={pw.formState.errors.newPassword?.message} />
          <Input label="Confirm new password" type="password" autoComplete="new-password" {...pw.register('confirm')} error={pw.formState.errors.confirm?.message} />
          <div className="sm:col-span-3">
            <Button type="submit" variant="secondary" loading={changePw.isPending}>
              Update password
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

const addressFormSchema = addressSchema.extend({ label: z.string().trim().max(40).optional(), isDefault: z.boolean().optional() });
type AddressForm = z.input<typeof addressFormSchema>;

export function Addresses() {
  useDocumentTitle('Addresses');
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['account', 'addresses'], queryFn: () => api.get<{ items: Address[] }>('/account/addresses').then((r) => r.items) });
  const form = useForm<AddressForm>({ resolver: zodResolver(addressFormSchema) });

  useEffect(() => {
    if (editing === 'new') form.reset({ fullName: '', phone: '', line1: '', line2: '', landmark: '', city: '', state: '' as never, pincode: '', label: '', isDefault: !data?.length });
    else if (editing) form.reset({ ...editing, line2: editing.line2 ?? '', landmark: editing.landmark ?? '', label: editing.label ?? '' } as AddressForm);
  }, [editing, form, data?.length]);

  const save = useMutation({
    mutationFn: (v: z.output<typeof addressFormSchema>) =>
      editing && editing !== 'new' ? api.put(`/account/addresses/${editing._id}`, v) : api.post('/account/addresses', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account', 'addresses'] });
      setEditing(null);
      toast('Address saved');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/account/addresses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account', 'addresses'] });
      setDeleting(null);
      toast('Address removed');
    },
  });

  return (
    <section className={panel}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl">Saved addresses</h2>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} disabled={(data?.length ?? 0) >= 10}>
          Add address
        </Button>
      </div>
      <div className="mt-5">
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : !data?.length ? (
          <EmptyState icon={<MapPin className="size-7" />} title="No saved addresses" description="Save an address for one-tap checkout." />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {data.map((a) => (
              <li key={a._id} className="rounded-2xl border border-line-strong p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">
                    {a.label ? `${a.label} · ` : ''}
                    {a.fullName}
                  </p>
                  {a.isDefault && <Badge tone="gold">Default</Badge>}
                </div>
                <p className="mt-1 text-ink-soft">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ''}
                  {a.landmark ? `, near ${a.landmark}` : ''}
                  <br />
                  {a.city}, {a.state} {a.pincode}
                </p>
                <p className="mt-1 text-muted">+91 {a.phone}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(a)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash className="size-3.5" />} onClick={() => setDeleting(a)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add address' : 'Edit address'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((raw) => save.mutate(addressFormSchema.parse(raw)))}>
              Save address
            </Button>
          </>
        }
      >
        <form noValidate onSubmit={(e) => e.preventDefault()} className="space-y-4">
          {save.error && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
          <Input label="Label (optional)" placeholder="Home, Work, Mom’s place…" {...form.register('label')} />
          <AddressFields register={form.register} errors={form.formState.errors} />
          <Checkbox label="Make this my default address" {...form.register('isDefault')} />
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting._id)}
        loading={remove.isPending}
        title="Remove this address?"
        tone="danger"
        confirmLabel="Remove"
      />
    </section>
  );
}

export function Orders() {
  useDocumentTitle('My orders');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['account', 'orders', page],
    queryFn: () => api.get<{ items: CustomerOrder[]; meta: PageMeta }>('/account/orders', { page, limit: 10 }),
  });
  if (isError) return <ErrorState message="We couldn't load your orders." onRetry={() => refetch()} />;
  return (
    <section className={panel}>
      <h2 className="text-2xl">Orders</h2>
      <div className="mt-5">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !data?.items.length ? (
          <EmptyState icon={<Package className="size-7" />} title="No orders yet" description="When you place an order it will appear here." action={<ButtonLink to="/shop">Start shopping</ButtonLink>} />
        ) : (
          <ul className="space-y-3">
            {data.items.map((o) => (
              <li key={o.id}>
                <Link to={`/account/orders/${o.orderNumber}`} className="flex flex-wrap items-center gap-4 rounded-2xl border border-line-strong p-4 transition-colors hover:border-rose-600">
                  <div className="flex -space-x-3">
                    {o.items.slice(0, 3).map((i) =>
                      i.image ? <img key={i.sku} src={i.image} alt="" className="size-12 rounded-xl border-2 border-paper bg-blush-50 object-cover" /> : <div key={i.sku} className="size-12 rounded-xl border-2 border-paper bg-blush-50" />,
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{o.orderNumber}</p>
                    <p className="text-sm text-muted">
                      {formatDate(o.createdAt)} · {pluralize(o.items.reduce((s, i) => s + i.quantity, 0), 'item')}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={statusTone(o.status)}>{o.statusLabel}</Badge>
                    <span className="text-sm font-semibold">{formatPrice(o.pricing.total)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data && <Pagination className="mt-6" page={data.meta.page} pages={data.meta.pages} onChange={setPage} />}
      </div>
    </section>
  );
}

export function AccountOrder() {
  const { orderNumber = '' } = useParams();
  useDocumentTitle(`Order ${orderNumber}`);
  const queryKey = ['account', 'order', orderNumber];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => api.get<{ order: CustomerOrder }>(`/account/orders/${encodeURIComponent(orderNumber)}`).then((r) => r.order),
  });
  if (isLoading) return <PageLoader />;
  if (isError || !data) return <ErrorState message="We couldn't find this order in your account." onRetry={() => refetch()} />;
  return (
    <div>
      <Link to="/account/orders" className="mb-4 inline-block text-sm text-rose-700 underline underline-offset-4">
        ← All orders
      </Link>
      <OrderView order={data} queryKey={queryKey} />
    </div>
  );
}
