import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader, Panel, Table } from '../../components/admin/AdminLayout';
import { ImageManager } from '../../components/admin/ImageManager';
import { Button, IconButton } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Dialog';
import { Alert, Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { useCan } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { ApiError, api, errorMessage } from '../../lib/api';
import type { Category, ImageRef } from '../../lib/types';
import { useAdminCategories } from './Products';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  slug: z.union([z.literal(''), z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers, hyphens')]),
  description: z.string().trim().max(1000),
  parent: z.string(),
  isActive: z.boolean(),
  displayOrder: z.coerce.number().int().min(0).max(10000),
});
type FormIn = z.input<typeof schema>;

export default function Categories() {
  useDocumentTitle('Categories');
  const qc = useQueryClient();
  const toast = useToast();
  const canDelete = useCan('categories:delete');
  const { data, isLoading, isError, refetch } = useAdminCategories();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [reassignTo, setReassignTo] = useState('');
  const [image, setImage] = useState<ImageRef[]>([]);
  const form = useForm<FormIn>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (editing === 'new') {
      form.reset({ name: '', slug: '', description: '', parent: '', isActive: true, displayOrder: (data?.length ?? 0) + 1 });
      setImage([]);
    } else if (editing) {
      form.reset({ name: editing.name, slug: editing.slug, description: editing.description, parent: editing.parent ?? '', isActive: editing.isActive, displayOrder: editing.displayOrder });
      setImage(editing.image ? [editing.image] : []);
    }
  }, [editing, form, data?.length]);

  const done = (msg: string) => () => {
    qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
    qc.invalidateQueries({ queryKey: ['categories'] });
    toast(msg);
  };
  const save = useMutation({
    mutationFn: (v: z.output<typeof schema>) => {
      const body = { ...v, slug: v.slug || undefined, parent: v.parent || null, image: image[0] ?? null };
      return editing && editing !== 'new' ? api.put(`/admin/categories/${editing.id}`, body) : api.post('/admin/categories', body);
    },
    onSuccess: () => {
      done('Category saved')();
      setEditing(null);
    },
    onError: (err) => {
      if (err instanceof ApiError) for (const [k, m] of Object.entries(err.details ?? {})) if (typeof m === 'string') form.setError(k as never, { message: m });
    },
  });
  const remove = useMutation({
    mutationFn: ({ id, to }: { id: string; to?: string }) => api.delete<{ movedProducts: number }>(`/admin/categories/${id}`, { reassignTo: to }),
    onSuccess: (r) => {
      done(r.movedProducts ? `Category deleted; ${r.movedProducts} products moved` : 'Category deleted')();
      setDeleting(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const parents = data?.filter((c) => !c.parent) ?? [];
  const ordered = parents.flatMap((p) => [p, ...(data?.filter((c) => c.parent === p.id) ?? [])]);
  const editingId = editing && editing !== 'new' ? editing.id : null;
  const hasChildren = (c: Category) => !!data?.some((x) => x.parent === c.id);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Categories drive the storefront navigation. Inactive categories and their products are hidden."
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Add category
          </Button>
        }
      />
      <Panel padded={false}>
        {isError ? (
          <ErrorState message="Could not load categories." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !ordered.length ? (
          <EmptyState title="No categories yet" description="Create categories like Earrings, Chains or One Gram Gold." />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Slug</th>
                <th>Order</th>
                <th>Products</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className={c.parent ? 'flex items-center gap-3 pl-8' : 'flex items-center gap-3'}>
                      {c.image ? <img src={c.image.url} alt="" className="size-10 rounded-lg bg-blush-50 object-cover" /> : <div className="size-10 rounded-lg bg-blush-50" />}
                      <span className="font-medium">
                        {c.parent && <span className="mr-1 text-muted">↳</span>}
                        {c.name}
                      </span>
                    </div>
                  </td>
                  <td className="text-ink-soft">/{c.slug}</td>
                  <td className="tabular-nums">{c.displayOrder}</td>
                  <td className="tabular-nums">
                    {c.productCount}
                    {c.activeProductCount !== c.productCount && <span className="text-xs text-muted"> ({c.activeProductCount} active)</span>}
                  </td>
                  <td>{c.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  <td className="text-right">
                    <IconButton label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    {canDelete && (
                      <IconButton
                        label={`Delete ${c.name}`}
                        onClick={() => {
                          setReassignTo('');
                          setDeleting(c);
                        }}
                      >
                        <Trash className="size-4" />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New category' : 'Edit category'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={form.handleSubmit((raw) => save.mutate(schema.parse(raw)))}>
              Save
            </Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
          {save.error && <Alert tone="danger" className="sm:col-span-2">{errorMessage(save.error)}</Alert>}
          <Input label="Name" required {...form.register('name')} error={form.formState.errors.name?.message} />
          <Input label="Slug" {...form.register('slug')} error={form.formState.errors.slug?.message} hint="Blank = generated from name" />
          <Textarea wrapperClassName="sm:col-span-2" label="Description" rows={3} {...form.register('description')} />
          <Select label="Parent category" {...form.register('parent')} hint="One level of nesting is supported.">
            <option value="">None (top level)</option>
            {parents
              .filter((p) => p.id !== editingId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
          <Input label="Display order" type="number" min={0} {...form.register('displayOrder')} error={form.formState.errors.displayOrder?.message} hint="Lower numbers appear first" />
          <div className="sm:col-span-2">
            <Checkbox label="Active (visible in the store)" {...form.register('isActive')} />
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[13px] font-medium text-ink-soft">Image</p>
            <ImageManager images={image} onChange={setImage} single />
          </div>
        </form>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              disabled={!deleting || hasChildren(deleting) || (deleting.productCount > 0 && !reassignTo)}
              onClick={() => deleting && remove.mutate({ id: deleting.id, to: reassignTo || undefined })}
            >
              Delete category
            </Button>
          </>
        }
      >
        {deleting && hasChildren(deleting) ? (
          <Alert tone="warning">This category has sub-categories. Move or delete them first.</Alert>
        ) : deleting && deleting.productCount > 0 ? (
          <div className="space-y-4 text-sm">
            <Alert tone="warning">
              {deleting.productCount} product(s) belong to this category. Choose where to move them — nothing is deleted with the category.
            </Alert>
            <Select label="Move products to" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
              <option value="">Choose a category</option>
              {data
                ?.filter((c) => c.id !== deleting.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent ? '— ' : ''}
                    {c.name}
                  </option>
                ))}
            </Select>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">This category is empty and can be deleted safely.</p>
        )}
      </Modal>
    </>
  );
}
