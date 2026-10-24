import { Types } from 'mongoose';
import { badRequest, conflict, isDuplicateKeyError, notFound } from '../lib/errors.js';
import { runInTransaction } from '../lib/transaction.js';
import { slugify } from '../lib/util.js';
import { Category, type ICategory } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { assertValidImages, markAttached, releaseImages } from './media.service.js';

type CategoryInput = {
  name: string;
  slug?: string;
  description?: string;
  image?: { url: string; publicId?: string; alt?: string } | null;
  parent?: string | null;
  isActive: boolean;
  displayOrder: number;
};

async function uniqueSlug(base: string, excludeId?: Types.ObjectId) {
  const root = slugify(base) || 'category';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const existing = await Category.findOne({ slug: candidate }).select('_id').lean();
    if (!existing || (excludeId && existing._id.equals(excludeId))) return candidate;
  }
  throw conflict('Could not generate a unique slug. Please provide one.');
}

async function validateParent(parentId: string | null | undefined, selfId?: Types.ObjectId) {
  if (!parentId) return null;
  const parent = await Category.findById(parentId).lean();
  if (!parent) throw badRequest('Parent category not found.', { parent: 'Not found' });
  if (selfId && parent._id.equals(selfId)) throw badRequest('A category cannot be its own parent.', { parent: 'Invalid' });
  // One level of nesting keeps navigation simple.
  if (parent.parent) throw badRequest('Sub-categories cannot have their own sub-categories.', { parent: 'Choose a top-level category' });
  if (selfId && (await Category.exists({ parent: selfId }))) {
    throw badRequest('This category has sub-categories, so it cannot be nested.', { parent: 'Has children' });
  }
  return parent._id;
}

/** Ids of active categories (a sub-category is only visible when its parent is active too). */
export async function activeCategoryIds(): Promise<Types.ObjectId[]> {
  const cats = await Category.find({ isActive: true }).select('_id parent').lean();
  const active = new Set(cats.map((c) => String(c._id)));
  return cats.filter((c) => !c.parent || active.has(String(c.parent))).map((c) => c._id);
}

/** Category and its direct children (for parent-category listing pages). */
export async function categoryWithChildrenIds(categoryId: Types.ObjectId) {
  const children = await Category.find({ parent: categoryId }).select('_id').lean();
  return [categoryId, ...children.map((c) => c._id)];
}

async function productCounts(activeOnly: boolean) {
  const match = activeOnly ? { status: 'active' } : {};
  const rows = await Product.aggregate<{ _id: Types.ObjectId; total: number; active: number }>([
    { $match: match },
    { $group: { _id: '$category', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

function serialize(c: ICategory & { _id: Types.ObjectId }, counts?: Map<string, { total: number; active: number }>) {
  const count = counts?.get(String(c._id));
  return {
    id: String(c._id),
    name: c.name,
    slug: c.slug,
    description: c.description ?? '',
    image: c.image ?? null,
    parent: c.parent ? String(c.parent) : null,
    isActive: c.isActive,
    displayOrder: c.displayOrder,
    productCount: count?.total ?? 0,
    activeProductCount: count?.active ?? 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Storefront: active categories as a tree with active product counts (children roll up into parents). */
export async function listPublicCategories() {
  const ids = await activeCategoryIds();
  const [cats, counts] = await Promise.all([
    Category.find({ _id: { $in: ids } }).sort({ displayOrder: 1, name: 1 }).lean(),
    productCounts(true),
  ]);
  const all = cats.map((c) => serialize(c, counts));
  const roots = all.filter((c) => !c.parent);
  return roots.map((r) => {
    const children = all.filter((c) => c.parent === r.id);
    const own = r.activeProductCount;
    return {
      ...r,
      productCount: own + children.reduce((s, c) => s + c.activeProductCount, 0),
      children: children.map((c) => ({ ...c, productCount: c.activeProductCount })),
    };
  });
}

export async function getPublicCategory(slug: string) {
  const cat = await Category.findOne({ slug }).lean();
  if (!cat) throw notFound('Category');
  const active = await activeCategoryIds();
  if (!active.some((id) => id.equals(cat._id))) throw notFound('Category');
  const [children, parent] = await Promise.all([
    Category.find({ parent: cat._id, _id: { $in: active } }).sort({ displayOrder: 1 }).lean(),
    cat.parent ? Category.findById(cat.parent).lean() : null,
  ]);
  return {
    ...serialize(cat),
    parent: parent ? { id: String(parent._id), name: parent.name, slug: parent.slug } : null,
    children: children.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug, image: c.image ?? null })),
  };
}

export async function listAdminCategories() {
  const [cats, counts] = await Promise.all([Category.find().sort({ displayOrder: 1, name: 1 }).lean(), productCounts(false)]);
  return cats.map((c) => serialize(c, counts));
}

export async function createCategory(input: CategoryInput) {
  if (input.image) await assertValidImages([input.image]);
  const parent = await validateParent(input.parent);
  const slug = input.slug ? input.slug : await uniqueSlug(input.name);
  try {
    const cat = await Category.create({ ...input, slug, parent });
    if (input.image) await markAttached([input.image]);
    return serialize(cat.toObject());
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('A category with this slug already exists.', 'SLUG_TAKEN', { slug: 'Already in use' });
    throw err;
  }
}

export async function updateCategory(id: string, input: CategoryInput) {
  const existing = await Category.findById(id);
  if (!existing) throw notFound('Category');
  if (input.image) await assertValidImages([input.image]);
  const parent = await validateParent(input.parent, existing._id);
  const slug = input.slug ? input.slug : existing.slug;
  const oldImage = existing.image?.publicId;
  try {
    existing.set({ ...input, slug, parent, image: input.image ?? null });
    await existing.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) throw conflict('A category with this slug already exists.', 'SLUG_TAKEN', { slug: 'Already in use' });
    throw err;
  }
  if (input.image) await markAttached([input.image]);
  if (oldImage && oldImage !== input.image?.publicId) await releaseImages([oldImage]);
  return serialize(existing.toObject());
}

/**
 * Deleting is blocked while the category has sub-categories or products,
 * unless the caller chooses a category to move the products into first.
 */
export async function deleteCategory(id: string, reassignTo?: string) {
  const cat = await Category.findById(id).lean();
  if (!cat) throw notFound('Category');
  if (await Category.exists({ parent: cat._id })) {
    throw conflict('Move or delete the sub-categories first.', 'CATEGORY_HAS_CHILDREN');
  }
  const productCount = await Product.countDocuments({ category: cat._id });
  let target: Types.ObjectId | null = null;
  if (productCount > 0) {
    if (!reassignTo) {
      throw conflict(
        `This category contains ${productCount} product(s). Choose another category to move them to before deleting.`,
        'CATEGORY_HAS_PRODUCTS',
        { productCount },
      );
    }
    const t = await Category.findById(reassignTo).select('_id').lean();
    if (!t || t._id.equals(cat._id)) throw badRequest('Choose a different, existing category to move products into.');
    target = t._id;
  }
  const moved = await runInTransaction(async (session) => {
    let n = 0;
    if (target) {
      const res = await Product.updateMany({ category: cat._id }, { $set: { category: target } }, { session: session ?? undefined });
      n = res.modifiedCount;
    }
    await Category.deleteOne({ _id: cat._id }, { session: session ?? undefined });
    return n;
  });
  if (cat.image?.publicId) await releaseImages([cat.image.publicId]);
  return { deleted: true, movedProducts: moved };
}
