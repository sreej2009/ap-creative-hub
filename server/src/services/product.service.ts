import { Types } from 'mongoose';
import { badRequest, conflict, isDuplicateKeyError, notFound } from '../lib/errors.js';
import { listingPricing, unitPriceFor } from '../lib/pricing.js';
import { runInTransaction } from '../lib/transaction.js';
import { escapeRegex, pageMeta, paginate, slugify } from '../lib/util.js';
import { Category } from '../models/Category.js';
import { InventoryAdjustment, type AdjustmentReason } from '../models/InventoryAdjustment.js';
import type { Actor } from '../models/Order.js';
import { Order } from '../models/Order.js';
import { Product, type IProduct, type ProductStatus } from '../models/Product.js';
import type { ProductInput } from '../schemas/index.js';
import { activeCategoryIds, categoryWithChildrenIds } from './category.service.js';
import { assertValidImages, markAttached, releaseImages } from './media.service.js';

type LeanProduct = IProduct & { _id: Types.ObjectId };
type CategoryLite = { _id: Types.ObjectId; name: string; slug: string; parent?: Types.ObjectId | null };

/* ----------------------------- Serialisers ----------------------------- */

function cardPricing(p: LeanProduct) {
  const active = p.variants.filter((v) => v.isActive);
  if (!active.length) return unitPriceFor(p);
  return active.map((v) => unitPriceFor(p, v)).sort((a, b) => a.unitPrice - b.unitPrice)[0];
}

export function toProductCard(p: LeanProduct, cats: Map<string, CategoryLite>) {
  const pricing = cardPricing(p);
  const cat = cats.get(String(p.category));
  return {
    id: String(p._id),
    name: p.name,
    slug: p.slug,
    image: p.images[0] ?? null,
    hoverImage: p.images[1] ?? null,
    price: pricing.unitPrice,
    compareAtPrice: pricing.compareAtPrice,
    hasVariants: p.variants.some((v) => v.isActive),
    priceVaries: new Set(p.variants.filter((v) => v.isActive).map((v) => unitPriceFor(p, v).unitPrice)).size > 1,
    inStock: p.stock > 0,
    lowStock: p.stock > 0 && p.stock <= p.lowStockThreshold,
    isNewArrival: p.isNewArrival,
    isFeatured: p.isFeatured,
    category: cat ? { name: cat.name, slug: cat.slug } : null,
  };
}

function toProductDetail(p: LeanProduct, cat: CategoryLite | null, parent: CategoryLite | null) {
  const base = unitPriceFor(p);
  const variants = p.variants
    .filter((v) => v.isActive)
    .map((v) => {
      const vp = unitPriceFor(p, v);
      return { id: String(v._id), sku: v.sku, label: v.label, price: vp.unitPrice, compareAtPrice: vp.compareAtPrice, stock: v.stock, inStock: v.stock > 0 };
    });
  return {
    id: String(p._id),
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    description: p.description,
    shortDescription: p.shortDescription ?? '',
    images: p.images,
    price: base.unitPrice,
    compareAtPrice: base.compareAtPrice,
    stock: p.stock,
    inStock: p.stock > 0,
    lowStock: p.stock > 0 && p.stock <= p.lowStockThreshold,
    attributes: p.attributes,
    variants,
    tags: p.tags,
    isNewArrival: p.isNewArrival,
    isFeatured: p.isFeatured,
    category: cat ? { id: String(cat._id), name: cat.name, slug: cat.slug } : null,
    parentCategory: parent ? { id: String(parent._id), name: parent.name, slug: parent.slug } : null,
  };
}

export function toAdminProduct(p: LeanProduct) {
  return {
    id: String(p._id),
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    description: p.description,
    shortDescription: p.shortDescription ?? '',
    category: p.category && typeof p.category === 'object' && 'name' in p.category
      ? { id: String((p.category as unknown as CategoryLite)._id), name: (p.category as unknown as CategoryLite).name }
      : { id: String(p.category), name: null },
    tags: p.tags,
    images: p.images,
    price: p.price,
    salePrice: p.salePrice ?? null,
    sellingPrice: p.sellingPrice,
    stock: p.stock,
    lowStockThreshold: p.lowStockThreshold,
    stockState: p.stock === 0 ? 'out' : p.stock <= p.lowStockThreshold ? 'low' : 'in',
    attributes: p.attributes,
    variants: p.variants.map((v) => ({
      id: String(v._id),
      sku: v.sku,
      label: v.label,
      price: v.price ?? null,
      salePrice: v.salePrice ?? null,
      stock: v.stock,
      isActive: v.isActive,
    })),
    isFeatured: p.isFeatured,
    isNewArrival: p.isNewArrival,
    status: p.status,
    soldCount: p.soldCount,
    isSample: p.isSample,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function categoryMap() {
  const cats = await Category.find().select('name slug parent').lean();
  return new Map(cats.map((c) => [String(c._id), c as CategoryLite]));
}

/* ----------------------------- Storefront ----------------------------- */

const SORTS: Record<string, Record<string, 1 | -1>> = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { sellingPrice: 1, _id: 1 },
  price_desc: { sellingPrice: -1, _id: 1 },
  popular: { soldCount: -1, createdAt: -1 },
  name: { name: 1, _id: 1 },
};

/** Parses "Colour:Gold,Silver|Material:Brass" into $elemMatch conditions. */
function parseAttributeFilter(attrs?: string) {
  if (!attrs) return [];
  return attrs
    .split('|')
    .slice(0, 8)
    .map((pair) => {
      const idx = pair.indexOf(':');
      if (idx < 1) return null;
      const name = pair.slice(0, idx).trim();
      const values = pair.slice(idx + 1).split(',').map((v) => v.trim()).filter(Boolean).slice(0, 20);
      if (!name || !values.length) return null;
      return { attributes: { $elemMatch: { name, value: { $in: values } } } };
    })
    .filter(Boolean) as Record<string, unknown>[];
}

export async function listPublicProducts(query: {
  page: number;
  limit: number;
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onSale?: boolean;
  featured?: boolean;
  newArrival?: boolean;
  attrs?: string;
  sort: string;
}) {
  const active = await activeCategoryIds();
  let categoryIds = active;
  let category: { id: string; name: string; slug: string } | null = null;
  if (query.category) {
    const cat = await Category.findOne({ slug: query.category }).lean();
    if (!cat || !active.some((id) => id.equals(cat._id))) throw notFound('Category');
    const ids = await categoryWithChildrenIds(cat._id);
    categoryIds = ids.filter((id) => active.some((a) => a.equals(id)));
    category = { id: String(cat._id), name: cat.name, slug: cat.slug };
  }

  const base: Record<string, unknown> = { status: 'active', category: { $in: categoryIds } };
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    base.$or = [{ name: rx }, { tags: rx }, { sku: query.q.toUpperCase() }];
  }
  if (query.minPrice != null || query.maxPrice != null) {
    base.sellingPrice = {
      ...(query.minPrice != null ? { $gte: query.minPrice } : {}),
      ...(query.maxPrice != null ? { $lte: query.maxPrice } : {}),
    };
  }
  if (query.inStock) base.stock = { $gt: 0 };
  if (query.onSale) base.isOnSale = true;
  if (query.featured) base.isFeatured = true;
  if (query.newArrival) base.isNewArrival = true;

  const attrConds = parseAttributeFilter(query.attrs);
  const filter = attrConds.length ? { ...base, $and: attrConds } : base;
  const { skip, limit, page } = paginate(query.page, query.limit);

  const [items, total, facetRows, priceRows, cats] = await Promise.all([
    Product.find(filter).sort(SORTS[query.sort] ?? SORTS.newest).skip(skip).limit(limit).lean(),
    Product.countDocuments(filter),
    Product.aggregate<{ _id: string; values: string[] }>([
      { $match: base },
      { $unwind: '$attributes' },
      { $group: { _id: '$attributes.name', values: { $addToSet: '$attributes.value' } } },
      { $sort: { _id: 1 } },
      { $limit: 8 },
    ]),
    Product.aggregate<{ min: number; max: number }>([
      { $match: { status: 'active', category: { $in: categoryIds } } },
      { $group: { _id: null, min: { $min: '$sellingPrice' }, max: { $max: '$sellingPrice' } } },
    ]),
    categoryMap(),
  ]);

  return {
    items: items.map((p) => toProductCard(p, cats)),
    meta: pageMeta(total, page, limit),
    category,
    facets: {
      attributes: facetRows.map((f) => ({ name: f._id, values: f.values.sort().slice(0, 20) })),
      price: priceRows[0] ? { min: priceRows[0].min, max: priceRows[0].max } : null,
    },
  };
}

async function findSellable(slug: string) {
  const p = await Product.findOne({ slug, status: 'active' }).lean();
  if (!p) throw notFound('Product');
  const active = await activeCategoryIds();
  if (!active.some((id) => id.equals(p.category))) throw notFound('Product');
  return p;
}

export async function getPublicProduct(slug: string) {
  const p = await findSellable(slug);
  const cat = await Category.findById(p.category).select('name slug parent').lean();
  const parent = cat?.parent ? await Category.findById(cat.parent).select('name slug').lean() : null;
  return toProductDetail(p, cat as CategoryLite | null, parent as CategoryLite | null);
}

export async function relatedProducts(slug: string, limit = 8) {
  const p = await findSellable(slug);
  const active = await activeCategoryIds();
  const cats = await categoryMap();
  const same = await Product.find({ status: 'active', category: p.category, _id: { $ne: p._id } })
    .sort({ soldCount: -1, createdAt: -1 })
    .limit(limit)
    .lean();
  let result = same;
  if (same.length < limit) {
    const more = await Product.find({
      status: 'active',
      category: { $in: active },
      _id: { $nin: [p._id, ...same.map((s) => s._id)] },
      isFeatured: true,
    })
      .limit(limit - same.length)
      .lean();
    result = [...same, ...more];
  }
  return result.map((r) => toProductCard(r, cats));
}

/** Homepage sections. Best Sellers only appears once real sales exist. */
export async function homeSections() {
  const active = await activeCategoryIds();
  const base: Record<string, unknown> = { status: 'active', category: { $in: active } };
  const combos = await Category.findOne({ slug: 'budget-combos' }).select('_id').lean();
  const comboIds = combos ? (await categoryWithChildrenIds(combos._id)).filter((id) => active.some((a) => a.equals(id))) : [];
  const [cats, newArrivals, bestSellers, featured, budgetCombos, offers] = await Promise.all([
    categoryMap(),
    Product.find({ ...base, isNewArrival: true }).sort({ createdAt: -1 }).limit(8).lean(),
    Product.find({ ...base, soldCount: { $gt: 0 } }).sort({ soldCount: -1 }).limit(8).lean(),
    Product.find({ ...base, isFeatured: true }).sort({ updatedAt: -1 }).limit(8).lean(),
    comboIds.length ? Product.find({ status: 'active', category: { $in: comboIds } }).sort({ createdAt: -1 }).limit(8).lean() : [],
    Product.find({ ...base, isOnSale: true }).sort({ updatedAt: -1 }).limit(8).lean(),
  ]);
  const card = (list: LeanProduct[]) => list.map((p) => toProductCard(p, cats));
  return {
    newArrivals: card(newArrivals),
    bestSellers: card(bestSellers),
    featured: card(featured),
    budgetCombos: card(budgetCombos),
    specialOffers: card(offers),
  };
}

/* ------------------------------- Admin -------------------------------- */

async function uniqueProductSlug(base: string, excludeId?: Types.ObjectId) {
  const root = slugify(base) || 'product';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const existing = await Product.findOne({ slug: candidate }).select('_id').lean();
    if (!existing || (excludeId && existing._id.equals(excludeId))) return candidate;
  }
  throw conflict('Could not generate a unique slug. Please set one manually.');
}

async function assertSkusAvailable(skus: string[], excludeId?: Types.ObjectId) {
  const clash = await Product.findOne({
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    $or: [{ sku: { $in: skus } }, { 'variants.sku': { $in: skus } }],
  })
    .select('sku variants.sku name')
    .lean();
  if (clash) {
    const used = new Set([clash.sku, ...clash.variants.map((v) => v.sku)]);
    const dup = skus.find((s) => used.has(s));
    throw conflict(`SKU ${dup} is already used by "${clash.name}".`, 'SKU_TAKEN', { sku: 'Already in use' });
  }
}

function mapDuplicateKey(err: unknown): never {
  if (isDuplicateKeyError(err)) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'field';
    if (field.includes('sku')) throw conflict('This SKU is already in use.', 'SKU_TAKEN', { sku: 'Already in use' });
    if (field === 'slug') throw conflict('This URL slug is already in use.', 'SLUG_TAKEN', { slug: 'Already in use' });
    throw conflict('Duplicate value.', 'DUPLICATE');
  }
  throw err;
}

export async function listAdminProducts(query: {
  page: number;
  limit: number;
  q?: string;
  category?: string;
  status?: ProductStatus;
  stock?: 'low' | 'out' | 'in';
  sort: string;
}) {
  const filter: Record<string, unknown> = {};
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { 'variants.sku': rx }, { tags: rx }];
  }
  if (query.category) filter.category = new Types.ObjectId(query.category);
  if (query.status) filter.status = query.status;
  if (query.stock === 'out') filter.stock = 0;
  if (query.stock === 'in') filter.stock = { $gt: 0 };
  if (query.stock === 'low') filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] };
  const sorts: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    name: { name: 1 },
    price_asc: { sellingPrice: 1 },
    price_desc: { sellingPrice: -1 },
    stock_asc: { stock: 1 },
    stock_desc: { stock: -1 },
    popular: { soldCount: -1 },
  };
  const { skip, limit, page } = paginate(query.page, query.limit);
  const [items, total] = await Promise.all([
    Product.find(filter).sort({ ...sorts[query.sort], _id: -1 }).skip(skip).limit(limit).populate('category', 'name').lean(),
    Product.countDocuments(filter),
  ]);
  return { items: items.map((p) => toAdminProduct(p)), meta: pageMeta(total, page, limit) };
}

export async function getAdminProduct(id: string) {
  const p = await Product.findById(id).populate('category', 'name').lean();
  if (!p) throw notFound('Product');
  return toAdminProduct(p);
}

export async function createProduct(input: ProductInput, actor: Actor) {
  if (!(await Category.exists({ _id: input.category }))) throw badRequest('Category not found.', { category: 'Not found' });
  await assertSkusAvailable([input.sku, ...input.variants.map((v) => v.sku)]);
  await assertValidImages(input.images);
  const slug = input.slug ? input.slug : await uniqueProductSlug(input.name);
  if (input.slug && (await Product.exists({ slug }))) throw conflict('This URL slug is already in use.', 'SLUG_TAKEN', { slug: 'Already in use' });

  const variants = input.variants.map((v) => ({ ...v, _id: new Types.ObjectId() }));
  const stock = variants.length ? variants.reduce((s, v) => s + v.stock, 0) : input.stock;
  const pricing = listingPricing({ price: input.price, salePrice: input.salePrice, variants });

  const product = await runInTransaction(async (session) => {
    const created = new Product({ ...input, slug, variants, stock, ...pricing, createdBy: actor.id, updatedBy: actor.id });
    try {
      await created.save({ session: session ?? undefined });
    } catch (err) {
      mapDuplicateKey(err);
    }
    const rows = variants.length
      ? variants.filter((v) => v.stock > 0).map((v) => ({ variantId: v._id, sku: v.sku, delta: v.stock, stockAfter: v.stock }))
      : stock > 0
        ? [{ variantId: null, sku: input.sku, delta: stock, stockAfter: stock }]
        : [];
    if (rows.length) {
      await InventoryAdjustment.create(
        rows.map((r) => ({ ...r, product: created._id, reason: 'initial_stock' as const, actor })),
        { session: session ?? undefined, ordered: true },
      );
    }
    return created;
  });
  await markAttached(input.images);
  return getAdminProduct(String(product._id));
}

export async function updateProduct(id: string, input: ProductInput, actor: Actor) {
  if (!(await Category.exists({ _id: input.category }))) throw badRequest('Category not found.', { category: 'Not found' });
  await assertValidImages(input.images);

  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await Product.findById(id).lean();
    if (!existing) throw notFound('Product');
    await assertSkusAvailable([input.sku, ...input.variants.map((v) => v.sku)], existing._id);
    let slug = existing.slug;
    if (input.slug && input.slug !== existing.slug) {
      if (await Product.exists({ slug: input.slug, _id: { $ne: existing._id } })) {
        throw conflict('This URL slug is already in use.', 'SLUG_TAKEN', { slug: 'Already in use' });
      }
      slug = input.slug;
    }

    // Stock is never overwritten by a product edit: existing variants keep
    // their live stock; only brand-new variants receive an initial level.
    const byId = new Map(existing.variants.map((v) => [String(v._id), v]));
    const adjustments: { variantId: Types.ObjectId | null; sku: string; delta: number; stockAfter: number; reason: AdjustmentReason; note?: string }[] = [];
    const variants = input.variants.map((v) => {
      const prev = v._id ? byId.get(v._id) : undefined;
      if (prev) {
        byId.delete(v._id!);
        return { ...v, _id: prev._id, stock: prev.stock };
      }
      const _id = new Types.ObjectId();
      if (v.stock > 0) adjustments.push({ variantId: _id, sku: v.sku, delta: v.stock, stockAfter: v.stock, reason: 'initial_stock' });
      return { ...v, _id };
    });
    for (const removed of byId.values()) {
      if (removed.stock > 0) {
        adjustments.push({ variantId: removed._id, sku: removed.sku, delta: -removed.stock, stockAfter: 0, reason: 'correction', note: 'Variant removed' });
      }
    }
    let stock: number;
    if (variants.length) {
      stock = variants.reduce((s, v) => s + v.stock, 0);
      if (!existing.variants.length && existing.stock > 0) {
        adjustments.push({ variantId: null, sku: existing.sku, delta: -existing.stock, stockAfter: 0, reason: 'correction', note: 'Converted to variants' });
      }
    } else {
      stock = existing.variants.length ? 0 : existing.stock;
    }
    const pricing = listingPricing({ price: input.price, salePrice: input.salePrice, variants });

    const { stock: _ignored, ...fields } = input;
    void _ignored;
    const updated = await runInTransaction(async (session) => {
      let doc;
      try {
        doc = await Product.findOneAndUpdate(
          { _id: existing._id, inventoryVersion: existing.inventoryVersion },
          {
            $set: { ...fields, salePrice: input.salePrice ?? null, slug, variants, stock, ...pricing, updatedBy: actor.id },
            $inc: { inventoryVersion: 1 },
          },
          { returnDocument: 'after', session, runValidators: true },
        ).lean();
      } catch (err) {
        mapDuplicateKey(err);
      }
      if (!doc) return null;
      if (adjustments.length) {
        await InventoryAdjustment.create(
          adjustments.map((a) => ({ ...a, product: existing._id, actor })),
          { session: session ?? undefined, ordered: true },
        );
      }
      return doc;
    });

    if (updated) {
      await markAttached(input.images);
      const keep = new Set(input.images.map((i) => i.publicId).filter(Boolean));
      const removedImages = existing.images.map((i) => i.publicId).filter((p): p is string => Boolean(p) && !keep.has(p));
      if (removedImages.length) await releaseImages(removedImages);
      return getAdminProduct(id);
    }
    // inventoryVersion changed (an order or stock adjustment happened) — retry with fresh data.
  }
  throw conflict('The product changed while saving. Please reload and try again.', 'PRODUCT_CHANGED');
}

export async function setProductStatus(id: string, status: ProductStatus, actor: Actor) {
  const p = await Product.findByIdAndUpdate(id, { $set: { status, updatedBy: actor.id } }, { returnDocument: 'after' }).lean();
  if (!p) throw notFound('Product');
  return getAdminProduct(id);
}

/** Hard delete is only allowed for products that never appeared on an order; otherwise archive. */
export async function deleteProduct(id: string) {
  const p = await Product.findById(id).lean();
  if (!p) throw notFound('Product');
  if (await Order.exists({ 'items.product': p._id })) {
    throw conflict('This product appears on existing orders, so it cannot be deleted. Archive it instead.', 'PRODUCT_HAS_ORDERS');
  }
  await Product.deleteOne({ _id: p._id });
  const ids = p.images.map((i) => i.publicId).filter((x): x is string => Boolean(x));
  if (ids.length) await releaseImages(ids);
  return { deleted: true };
}
