import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader, Panel } from '../../components/admin/AdminLayout';
import { Button } from '../../components/ui/Button';
import { Alert, Badge, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { Checkbox, Input } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { ApiError, api, errorMessage } from '../../lib/api';
import { paiseToRupees, rupeesToPaise } from '../../lib/format';

type Integration = { configured: boolean; reason?: string; mode?: 'test' | 'live'; webhookConfigured?: boolean };
interface SettingsResponse {
  settings: {
    announcement: string;
    hero: { eyebrow: string; title: string; subtitle: string; ctaLabel: string; ctaHref: string; imageUrl: string };
    shipping: { flatFee: number; freeShippingThreshold: number; estimatedDays: string };
    cod: { enabled: boolean; fee: number; maxOrderValue: number };
    returns: { windowDays: number };
    contact: { email: string; phone: string; whatsapp: string; instagram: string; address: string; hours: string };
  };
  integrations: Record<'razorpay' | 'cloudinary' | 'email' | 'whatsapp' | 'courier', Integration>;
}

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount (0 allowed)');
const schema = z.object({
  announcement: z.string().trim().max(160),
  hero: z.object({
    eyebrow: z.string().trim().max(60),
    title: z.string().trim().min(2).max(120),
    subtitle: z.string().trim().max(300),
    ctaLabel: z.string().trim().min(2).max(40),
    ctaHref: z.string().trim().regex(/^\/[A-Za-z0-9/_?=&-]*$/, 'Internal link such as /shop'),
    imageUrl: z.string().trim().max(500),
  }),
  shipping: z.object({ flatFee: money, freeShippingThreshold: money, estimatedDays: z.string().trim().max(60) }),
  cod: z.object({ enabled: z.boolean(), fee: money, maxOrderValue: money }),
  returns: z.object({ windowDays: z.coerce.number().int().min(0).max(60) }),
  contact: z.object({
    email: z.union([z.literal(''), z.string().email('Enter a valid email')]),
    phone: z.string().trim().max(20),
    whatsapp: z.string().trim().regex(/^(\d{10,15})?$/, 'Digits only with country code, e.g. 919876543210'),
    instagram: z.union([z.literal(''), z.string().url().startsWith('https://', 'Use the full https:// link')]),
    address: z.string().trim().max(300),
    hours: z.string().trim().max(100),
  }),
});
type FormIn = z.input<typeof schema>;

const LABELS: Record<string, string> = { razorpay: 'Razorpay payments', cloudinary: 'Cloudinary images', email: 'Transactional email', whatsapp: 'WhatsApp messages', courier: 'Courier tracking API' };

export default function Settings() {
  useDocumentTitle('Settings');
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCan('settings:write');
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<SettingsResponse>('/admin/settings') });
  const form = useForm<FormIn>({ resolver: zodResolver(schema) });
  const e = form.formState.errors;

  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    form.reset({
      announcement: s.announcement,
      hero: s.hero,
      shipping: { flatFee: paiseToRupees(s.shipping.flatFee) || '0', freeShippingThreshold: paiseToRupees(s.shipping.freeShippingThreshold) || '0', estimatedDays: s.shipping.estimatedDays },
      cod: { enabled: s.cod.enabled, fee: paiseToRupees(s.cod.fee) || '0', maxOrderValue: paiseToRupees(s.cod.maxOrderValue) || '0' },
      returns: s.returns,
      contact: s.contact,
    });
  }, [data, form]);

  const save = useMutation({
    mutationFn: (v: z.output<typeof schema>) =>
      api.put<SettingsResponse>('/admin/settings', {
        ...v,
        shipping: { ...v.shipping, flatFee: rupeesToPaise(v.shipping.flatFee) ?? 0, freeShippingThreshold: rupeesToPaise(v.shipping.freeShippingThreshold) ?? 0 },
        cod: { ...v.cod, fee: rupeesToPaise(v.cod.fee) ?? 0, maxOrderValue: rupeesToPaise(v.cod.maxOrderValue) ?? 0 },
      }),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'settings'], r);
      qc.invalidateQueries({ queryKey: ['store-settings'] });
      qc.invalidateQueries({ queryKey: ['home'] });
      toast('Settings saved');
    },
    onError: (err) => {
      if (err instanceof ApiError) for (const [k, m] of Object.entries(err.fieldErrors)) form.setError(k as never, { message: m });
    },
  });

  if (isLoading) return <PageLoader />;
  if (isError || !data) return <ErrorState message="Could not load settings." onRetry={() => refetch()} />;

  return (
    <form onSubmit={form.handleSubmit((raw) => save.mutate(schema.parse(raw)))} noValidate>
      <PageHeader
        title="Settings"
        description={canWrite ? 'Changes apply to the storefront immediately.' : 'You can view settings; only admins can change them.'}
        actions={
          canWrite && (
            <Button type="submit" loading={save.isPending}>
              Save settings
            </Button>
          )
        }
      />
      {save.error && (
        <Alert tone="danger" className="mb-4">
          {errorMessage(save.error)}
        </Alert>
      )}
      <fieldset disabled={!canWrite} className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel title="Homepage">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input wrapperClassName="sm:col-span-2" label="Announcement bar" {...form.register('announcement')} error={e.announcement?.message} hint="Leave blank to hide" />
              <Input label="Hero eyebrow" {...form.register('hero.eyebrow')} />
              <Input label="Hero title" {...form.register('hero.title')} error={e.hero?.title?.message} hint="The last two words appear in italic rose." />
              <Input wrapperClassName="sm:col-span-2" label="Hero subtitle" {...form.register('hero.subtitle')} />
              <Input label="Button label" {...form.register('hero.ctaLabel')} error={e.hero?.ctaLabel?.message} />
              <Input label="Button link" {...form.register('hero.ctaHref')} error={e.hero?.ctaHref?.message} />
              <Input wrapperClassName="sm:col-span-2" label="Hero image URL" {...form.register('hero.imageUrl')} hint="A Cloudinary https:// URL or /samples/hero.svg" />
            </div>
          </Panel>
          <Panel title="Shipping & COD">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="Flat shipping fee" prefix="₹" {...form.register('shipping.flatFee')} error={e.shipping?.flatFee?.message} />
              <Input label="Free shipping above" prefix="₹" {...form.register('shipping.freeShippingThreshold')} error={e.shipping?.freeShippingThreshold?.message} hint="0 = never free" />
              <Input label="Delivery estimate" {...form.register('shipping.estimatedDays')} />
              <div className="flex items-center sm:col-span-3">
                <Checkbox label="Offer Cash on Delivery" {...form.register('cod.enabled')} />
              </div>
              <Input label="COD fee" prefix="₹" {...form.register('cod.fee')} error={e.cod?.fee?.message} />
              <Input label="COD maximum order" prefix="₹" {...form.register('cod.maxOrderValue')} error={e.cod?.maxOrderValue?.message} hint="0 = no limit" />
              <Input label="Return window (days)" type="number" min={0} {...form.register('returns.windowDays')} error={e.returns?.windowDays?.message} hint="0 disables self-service returns" />
            </div>
          </Panel>
          <Panel title="Contact & social">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Support email" type="email" {...form.register('contact.email')} error={e.contact?.email?.message} hint="Also receives contact-form messages" />
              <Input label="Phone (display)" {...form.register('contact.phone')} />
              <Input label="WhatsApp number" {...form.register('contact.whatsapp')} error={e.contact?.whatsapp?.message} hint="e.g. 919876543210" />
              <Input label="Instagram URL" {...form.register('contact.instagram')} error={e.contact?.instagram?.message} placeholder="https://instagram.com/yourhandle" />
              <Input label="Business hours" {...form.register('contact.hours')} />
              <Input label="Address (optional)" {...form.register('contact.address')} />
            </div>
          </Panel>
        </div>
        <div>
          <Panel title="Integrations">
            <ul className="space-y-4">
              {Object.entries(data.integrations).map(([key, s]) => (
                <li key={key} className="flex gap-3">
                  {s.configured ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" /> : <CircleX className="mt-0.5 size-5 shrink-0 text-muted" />}
                  <div className="text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {LABELS[key] ?? key}
                      {s.configured ? <Badge tone="success">Configured</Badge> : <Badge>Not configured</Badge>}
                      {s.mode && <Badge tone={s.mode === 'live' ? 'danger' : 'info'}>{s.mode} mode</Badge>}
                    </p>
                    {s.reason && <p className="mt-0.5 text-xs text-muted">{s.reason}</p>}
                    {key === 'razorpay' && s.configured && !s.webhookConfigured && <p className="mt-0.5 text-xs text-warning">Webhook secret not set — payments rely on browser verification and the expiry job’s reconciliation.</p>}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-line pt-4 text-xs text-muted">Credentials are configured as server environment variables and are never shown here. See docs/SETUP.md.</p>
          </Panel>
        </div>
      </fieldset>
    </form>
  );
}
