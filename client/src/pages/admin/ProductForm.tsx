import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { PageHeader, Panel } from '../../components/admin/AdminLayout';
import { ImageManager } from '../../components/admin/ImageManager';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { Alert, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { ApiError, api, errorMessage } from '../../lib/api';
import { formatPrice, paiseToRupees, rupeesToPaise } from '../../lib/format';
import type { ImageRef } from '../../lib/types';
import { productStatusBadge, stockBadge, useAdminCategories } from './Products';
import type { AdminProduct } from './types';

const rupees = (required: boolean) =>
  z
    .string()
    .trim()
    .refine((v) => (required ? v !== '' : true), 'Required')
    .refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount like 499 or 499.50')
    .refine((v) => v === '' || Number(v) > 0, 'Must be more than ₹0');

const skuRule = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-_]{1,39}$/, '2–40 letters, numbers, - or _');

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter a product name').max(140),
    slug: z.union([z.literal(''), z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens')]),
    sku: skuRule,
    shortDescription: z.string().trim().max(300),
    description: z.string().trim().max(5000),
    category: z.string().min(1, 'Choose a category'),
    tags: z.string().max(400),
    price: rupees(true),
    salePrice: rupees(false),
    stock: z.coerce.number().int('Whole numbers only').min(0).max(100000),
    lowStockThreshold: z.coerce.number().int().min(0).max(10000),
    status: z.enum(['draft', 'active', 'archived']),
    isFeatured: z.boolean(),
    isNewArrival: z.boolean(),
    attributes: z.array(z.object({ name: z.string().trim().min(1, 'Name'), value: z.string().trim().min(1, 'Value') })).max(20),
    variants: z
      .array(
        z.object({
          _id: z.string().optional(),
          sku: skuRule,
          label: z.string().trim().min(1, 'Label required').max(80),
          price: rupees(false),
          salePrice: rupees(false),
          stock: z.coerce.number().int().min(0).max(100000),
          isActive: z.boolean(),
        }),
      )
      .max(50),
  })
  .superRefine((v, ctx) => {
    if (v.salePrice && Number(v.salePrice) >= Number(v.price)) ctx.addIssue({ code: 'custom', path: ['salePrice'], message: 'Sale price must be lower than the price' });
    const skus = new Set([v.sku]);
    v.variants.forEach((x, i) => {
      if (skus.has(x.sku)) ctx.addIssue({ code: 'custom', path: ['variants', i, 'sku'], message: 'Duplicate SKU' });
      skus.add(x.sku);
      const base = x.price ? Number(x.price) : Number(v.price);
      if (x.salePrice && Number(x.salePrice) >= base) ctx.addIssue({ code: 'custom', path: ['variants', i, 'salePrice'], message: 'Must be lower than price' });
    });
  });
type FormIn = z.input<typeof schema>;

const empty: FormIn = {
  name: '', slug: '', sku: '', shortDescription: '', description: '', category: '', tags: '', price: '', salePrice: '',
  stock: 0, lowStockThreshold: 5, status: 'draft', isFeatured: false, isNewArrival: true, attributes: [], variants: [],
};

function toForm(p: AdminProduct): FormIn {
  return {
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    shortDescription: p.shortDescription,
    description: p.description,
    category: p.category.id,
    tags: p.tags.join(', '),
    price: paiseToRupees(p.price),
    salePrice: paiseToRupees(p.salePrice),
    stock: p.stock,
    lowStockThreshold: p.lowStockThreshold,
    status: p.status,
    isFeatured: p.isFeatured,
    isNewArrival: p.isNewArrival,
    attributes: p.attributes,
    variants: p.variants.map((v) => ({ _id: v.id, sku: v.sku, label: v.label, price: paiseToRupees(v.price), salePrice: paiseToRupees(v.salePrice), stock: v.stock, isActive: v.isActive })),
  };
}

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const canDelete = useCan('products:delete');
  const { data: categories } = useAdminCategories();
  const [images, setImages] = useState<ImageRef[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const existing = useQuery({ queryKey: ['admin', 'product', id], queryFn: () => api.get<AdminProduct>(`/admin/products/${id}`), enabled: !isNew });
  useDocumentTitle(isNew ? 'New product' : existing.data?.name ?? 'Edit product');

  const form = useForm<FormIn>({ resolver: zodResolver(schema), defaultValues: empty });
  const { register, control, handleSubmit, reset, setError, formState } = form;
  const errors = formState.errors;
  const attributes = useFieldArray({ control, name: 'attributes' });
  const variants = useFieldArray({ control, name: 'variants', keyName: 'key' });
  const variantValues = useWatch({ control, name: 'variants' });

  useEffect(() => {
    if (existing.data) {
      reset(toForm(existing.data));
      setImages(existing.data.images);
    }
  }, [existing.data, reset]);

  const save = useMutation({
    mutationFn: (body: unknown) => (isNew ? api.post<AdminProduct>('/admin/products', body) : api.put<AdminProduct>(`/admin/products/${id}`, body)),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.setQueryData(['admin', 'product', p.id], p);
      toast(isNew ? 'Product created' : 'Product saved');
      if (isNew) navigate(`/admin/products/${p.id}`, { replace: true });
      else {
        reset(toForm(p));
        setImages(p.images);
      }
    },
    onError: (err) => {
      setServerError(errorMessage(err));
      if (err instanceof ApiError) {
        for (const [k, m] of Object.entries(err.fieldErrors)) setError(k as never, { message: m });
        if (err.details && typeof (err.details as Record<string, unknown>).sku === 'string') setError('sku', { message: String((err.details as Record<string, string>).sku) });
        if (err.details && typeof (err.details as Record<string, unknown>).slug === 'string') setError('slug', { message: String((err.details as Record<string, string>).slug) });
      }
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      toast('Product deleted');
      navigate('/admin/products', { replace: true });
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast(errorMessage(e), 'error');
    },
  });

  const onSubmit = handleSubmit((raw) => {
    setServerError(null);
    const v = schema.parse(raw);
    save.mutate({
      name: v.name,
      slug: v.slug || undefined,
      sku: v.sku,
      shortDescription: v.shortDescription || undefined,
      description: v.description,
      category: v.category,
      tags: v.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20),
      images: images.map((i) => ({ url: i.url, publicId: i.publicId, alt: i.alt ?? '', width: i.width, height: i.height })),
      price: rupeesToPaise(v.price),
      salePrice: rupeesToPaise(v.salePrice),
      stock: v.stock,
      lowStockThreshold: v.lowStockThreshold,
      attributes: v.attributes,
      variants: v.variants.map((x) => ({
        _id: x._id,
        sku: x.sku,
        label: x.label,
        price: rupeesToPaise(x.price),
        salePrice: rupeesToPaise(x.salePrice),
        stock: x.stock,
        isActive: x.isActive,
      })),
      isFeatured: v.isFeatured,
      isNewArrival: v.isNewArrival,
      status: v.status,
    });
  });

  if (!isNew && existing.isLoading) return <PageLoader />;
  if (!isNew && (existing.isError || !existing.data)) return <ErrorState message="Could not load this product." onRetry={() => existing.refetch()} />;
  const p = existing.data;
  const vErr = (i: number) => (errors.variants as unknown as Record<number, Record<string, { message?: string }>> | undefined)?.[i];

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        back={{ to: '/admin/products', label: 'Products' }}
        title={isNew ? 'New product' : p!.name}
        description={p ? <span className="inline-flex items-center gap-2">{productStatusBadge(p.status)} {stockBadge(p)} {p.isSample && 'Sample product'} <Link to={`/product/${p.slug}`} target="_blank" className="text-rose-700 hover:underline">View in store ↗</Link></span> : 'Products start as drafts until you set them active.'}
        actions={
          <>
            {!isNew && canDelete && (
              <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button type="submit" loading={save.isPending}>
              {isNew ? 'Create product' : 'Save changes'}
            </Button>
          </>
        }
      />
      {serverError && (
        <Alert tone="danger" className="mb-4">
          {serverError}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Panel title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input wrapperClassName="sm:col-span-2" label="Product name" required {...register('name')} error={errors.name?.message} />
              <Input label="SKU" required {...register('sku')} error={errors.sku?.message} hint="Unique stock-keeping code, e.g. EAR-PEARL-01" className="uppercase" />
              <Input label="URL slug" {...register('slug')} error={errors.slug?.message} hint={isNew ? 'Leave blank to generate from the name' : 'Changing this breaks existing links'} />
              <Input wrapperClassName="sm:col-span-2" label="Short description" maxLength={300} {...register('shortDescription')} error={errors.shortDescription?.message} hint="One line shown near the price." />
              <Textarea wrapperClassName="sm:col-span-2" label="Description" rows={6} {...register('description')} error={errors.description?.message} />
            </div>
          </Panel>

          <Panel title="Images">
            <ImageManager images={images} onChange={setImages} />
          </Panel>

          <Panel title="Pricing">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Price" prefix="₹" inputMode="decimal" required {...register('price')} error={errors.price?.message} hint="Regular (MRP) price, taxes included" />
              <Input label="Sale price" prefix="₹" inputMode="decimal" {...register('salePrice')} error={errors.salePrice?.message} hint="Optional. Shows the price struck through." />
            </div>
          </Panel>

          <Panel
            title="Variants"
            actions={
              <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => variants.append({ sku: '', label: '', price: '', salePrice: '', stock: 0, isActive: true })}>
                Add variant
              </Button>
            }
          >
            {variants.fields.length === 0 ? (
              <p className="text-sm text-muted">No variants. Add variants for options like colour or size — each has its own SKU and stock.</p>
            ) : (
              <div className="space-y-3">
                {variants.fields.map((f, i) => {
                  const saved = !!variantValues?.[i]?._id;
                  return (
                    <div key={f.key} className="space-y-3 rounded-2xl border border-line p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                      <Input label="Option label" placeholder="Gold / Size 2.6" {...register(`variants.${i}.label`)} error={vErr(i)?.label?.message} />
                      <Input label="SKU" className="uppercase" {...register(`variants.${i}.sku`)} error={vErr(i)?.sku?.message} />
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start">
                      <Input label="Price" prefix="₹" placeholder="Same" {...register(`variants.${i}.price`)} error={vErr(i)?.price?.message} />
                      <Input label="Sale" prefix="₹" {...register(`variants.${i}.salePrice`)} error={vErr(i)?.salePrice?.message} />
                      <Input label={saved ? 'Stock' : 'Initial stock'} type="number" min={0} readOnly={saved} title={saved ? 'Use Inventory to adjust' : undefined} {...register(`variants.${i}.stock`)} error={vErr(i)?.stock?.message} />
                      <div className="flex items-center gap-2 sm:pt-7">
                        <Checkbox label="Active" {...register(`variants.${i}.isActive`)} />
                        <button type="button" onClick={() => variants.remove(i)} aria-label="Remove variant" className="rounded-lg p-2 text-muted hover:bg-danger-bg hover:text-danger">
                          <Trash className="size-4" />
                        </button>
                      </div>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted">Leave price blank to use the product price. Stock for saved variants changes through Inventory so every change is recorded.</p>
              </div>
            )}
          </Panel>

          <Panel
            title="Attributes"
            actions={
              <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => attributes.append({ name: '', value: '' })}>
                Add attribute
              </Button>
            }
          >
            {attributes.fields.length === 0 ? (
              <p className="text-sm text-muted">Optional details such as Material, Colour or Occasion. These also power the storefront filters.</p>
            ) : (
              <div className="space-y-3">
                {attributes.fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-3">
                    <Input aria-label="Attribute name" placeholder="Material" {...register(`attributes.${i}.name`)} error={errors.attributes?.[i]?.name?.message} />
                    <Input aria-label="Attribute value" placeholder="Brass" {...register(`attributes.${i}.value`)} error={errors.attributes?.[i]?.value?.message} />
                    <button type="button" onClick={() => attributes.remove(i)} aria-label="Remove attribute" className="mt-1.5 rounded-lg p-2 text-muted hover:bg-danger-bg hover:text-danger">
                      <Trash className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Status">
            <div className="space-y-4">
              <Select label="Visibility" {...register('status')}>
                <option value="draft">Draft — hidden</option>
                <option value="active">Active — on sale</option>
                <option value="archived">Archived — hidden, not purchasable</option>
              </Select>
              <Checkbox label="Featured" description="Shown in Featured favourites on the homepage" {...register('isFeatured')} />
              <Checkbox label="New arrival" description="Shown in New arrivals with a “New” badge" {...register('isNewArrival')} />
            </div>
          </Panel>
          <Panel title="Organisation">
            <div className="space-y-4">
              <Select label="Category" required {...register('category')} error={errors.category?.message}>
                <option value="">Choose a category</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent ? '— ' : ''}
                    {c.name}
                    {c.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </Select>
              <Input label="Tags" placeholder="pearl, party, gift" {...register('tags')} hint="Comma separated. Used in search." />
            </div>
          </Panel>
          <Panel title="Inventory">
            <div className="space-y-4">
              {isNew ? (
                <Input label="Initial stock" type="number" min={0} disabled={variants.fields.length > 0} hint={variants.fields.length ? 'Set stock per variant instead.' : 'Recorded as the opening stock.'} {...register('stock')} error={errors.stock?.message} />
              ) : (
                <div className="rounded-xl bg-cream/60 p-3 text-sm">
                  <p>
                    Current stock: <strong>{p!.stock}</strong>
                  </p>
                  <Link to={`/admin/inventory?q=${encodeURIComponent(p!.sku)}`} className="text-rose-700 hover:underline">
                    Adjust in Inventory →
                  </Link>
                </div>
              )}
              <Input label="Low-stock alert at" type="number" min={0} {...register('lowStockThreshold')} error={errors.lowStockThreshold?.message} />
            </div>
          </Panel>
          {p && (
            <Panel title="Performance">
              <p className="text-sm text-ink-soft">
                {p.soldCount} sold · selling at {formatPrice(p.sellingPrice)}
              </p>
            </Panel>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Delete this product permanently?"
        description="Only products that have never been ordered can be deleted. Products with orders must be archived instead to preserve order history."
        tone="danger"
        confirmLabel="Delete"
      />
    </form>
  );
}
