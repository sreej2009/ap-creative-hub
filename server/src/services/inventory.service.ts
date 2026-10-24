import { Types, type ClientSession } from 'mongoose';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { runInTransaction } from '../lib/transaction.js';
import { escapeRegex, pageMeta, paginate } from '../lib/util.js';
import { InventoryAdjustment, type AdjustmentReason } from '../models/InventoryAdjustment.js';
import type { Actor } from '../models/Order.js';
import { Product } from '../models/Product.js';

/**
 * Inventory is only ever changed through atomic, conditional `$inc`
 * updates. A decrement matches only when enough stock exists, so stock can
 * never go negative even under concurrent checkouts. Every change writes an
 * InventoryAdjustment audit record.
 */

export interface StockLine {
  productId: Types.ObjectId;
  variantId?: Types.ObjectId | null;
  quantity: number;
  sku: string;
  name?: string;
}

interface Ctx {
  session: ClientSession | null;
  actor: Actor;
  orderId?: Types.ObjectId | null;
  note?: string;
}

async function applyDelta(line: StockLine, delta: number, session: ClientSession | null) {
  const inc: Record<string, number> = { stock: delta, inventoryVersion: 1 };
  let filter: Record<string, unknown>;
  if (line.variantId) {
    inc['variants.$.stock'] = delta;
    filter =
      delta < 0
        ? { _id: line.productId, variants: { $elemMatch: { _id: line.variantId, stock: { $gte: -delta } } } }
        : { _id: line.productId, 'variants._id': line.variantId };
  } else {
    filter = delta < 0 ? { _id: line.productId, stock: { $gte: -delta } } : { _id: line.productId };
  }
  const updated = await Product.findOneAndUpdate(filter, { $inc: inc }, { returnDocument: 'after', session })
    .select('stock variants._id variants.stock')
    .lean();
  if (!updated) return null;
  const stockAfter = line.variantId
    ? (updated.variants.find((v) => v._id.equals(line.variantId!))?.stock ?? 0)
    : updated.stock;
  return stockAfter;
}

async function availableFor(line: StockLine, session: ClientSession | null = null) {
  const p = await Product.findById(line.productId).select('stock variants').session(session).lean();
  if (!p) return 0;
  if (line.variantId) return p.variants.find((v) => v._id.equals(line.variantId!))?.stock ?? 0;
  return p.stock;
}

async function writeAdjustments(
  rows: { line: StockLine; delta: number; stockAfter: number }[],
  reason: AdjustmentReason,
  ctx: Ctx,
) {
  if (!rows.length) return;
  await InventoryAdjustment.create(
    rows.map((r) => ({
      product: r.line.productId,
      variantId: r.line.variantId ?? null,
      sku: r.line.sku,
      delta: r.delta,
      stockAfter: r.stockAfter,
      reason,
      order: ctx.orderId ?? null,
      actor: ctx.actor,
      note: ctx.note,
    })),
    { session: ctx.session ?? undefined, ordered: true },
  );
}

/**
 * Decrements stock for every line or none. Inside a transaction a failure
 * aborts everything; without transactions, already-applied decrements are
 * compensated before the error is thrown.
 */
export async function reserveStock(lines: StockLine[], ctx: Ctx) {
  const applied: { line: StockLine; delta: number; stockAfter: number }[] = [];
  try {
    for (const line of lines) {
      const stockAfter = await applyDelta(line, -line.quantity, ctx.session);
      if (stockAfter === null) {
        const available = await availableFor(line, ctx.session);
        throw new AppError(409, 'OUT_OF_STOCK', `Sorry, "${line.name ?? line.sku}" does not have enough stock.`, {
          productId: String(line.productId),
          variantId: line.variantId ? String(line.variantId) : null,
          requested: line.quantity,
          available,
        });
      }
      applied.push({ line, delta: -line.quantity, stockAfter });
    }
    await writeAdjustments(applied, 'order_reserved', ctx);
    return applied;
  } catch (err) {
    if (!ctx.session) {
      for (const a of applied) await applyDelta(a.line, a.line.quantity, null);
    }
    throw err;
  }
}

export async function restoreStock(lines: StockLine[], reason: AdjustmentReason, ctx: Ctx) {
  const applied: { line: StockLine; delta: number; stockAfter: number }[] = [];
  for (const line of lines) {
    const stockAfter = await applyDelta(line, line.quantity, ctx.session);
    // The product or variant may have been deleted since; nothing to restore then.
    if (stockAfter !== null) applied.push({ line, delta: line.quantity, stockAfter });
  }
  await writeAdjustments(applied, reason, ctx);
  return applied;
}

/** Manual stock change by an admin, by delta or to an absolute level. */
export async function adjustStock(
  productId: string,
  input: { variantId?: string; mode: 'delta' | 'set'; quantity: number; reason: string; note?: string },
  actor: Actor,
) {
  const product = await Product.findById(productId).lean();
  if (!product) throw notFound('Product');
  const variantId = input.variantId ? new Types.ObjectId(input.variantId) : null;
  if (product.variants.length && !variantId) throw conflict('Choose which variant to adjust.', 'VARIANT_REQUIRED');
  const variant = variantId ? product.variants.find((v) => v._id.equals(variantId)) : null;
  if (variantId && !variant) throw notFound('Variant');
  const line: StockLine = { productId: product._id, variantId, quantity: 0, sku: variant?.sku ?? product.sku };

  // For "set" we need the current level; retry if it changes under us.
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await availableFor(line);
    const delta = input.mode === 'set' ? input.quantity - current : input.quantity;
    if (delta === 0) return { stock: current, delta: 0 };
    if (current + delta < 0) {
      throw conflict(`Stock cannot go below zero (currently ${current}).`, 'NEGATIVE_STOCK', { quantity: 'Too large' });
    }
    const result = await runInTransaction(async (session) => {
      const filter: Record<string, unknown> = { _id: product._id };
      const inc: Record<string, number> = { stock: delta, inventoryVersion: 1 };
      if (variantId) {
        filter.variants = { $elemMatch: { _id: variantId, stock: current } };
        inc['variants.$.stock'] = delta;
      } else {
        filter.stock = current;
      }
      const updated = await Product.findOneAndUpdate(filter, { $inc: inc }, { returnDocument: 'after', session }).lean();
      if (!updated) return null;
      const after = variantId ? updated.variants.find((v) => v._id.equals(variantId))!.stock : updated.stock;
      await writeAdjustments([{ line, delta, stockAfter: after }], input.reason as AdjustmentReason, {
        session,
        actor,
        note: input.note,
      });
      return { stock: after, delta };
    });
    if (result) return result;
  }
  throw conflict('Stock changed while saving. Please try again.', 'STOCK_CHANGED');
}

export async function listInventory(query: { page: number; limit: number; q?: string; stock?: 'low' | 'out' | 'in'; category?: string }) {
  const filter: Record<string, unknown> = { status: { $ne: 'archived' } };
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { 'variants.sku': rx }];
  }
  if (query.category) filter.category = new Types.ObjectId(query.category);
  if (query.stock === 'out') filter.stock = 0;
  if (query.stock === 'in') filter.stock = { $gt: 0 };
  if (query.stock === 'low') filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] };
  const { skip, limit, page } = paginate(query.page, query.limit);
  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort({ stock: 1, name: 1 })
      .skip(skip)
      .limit(limit)
      .select('name sku stock lowStockThreshold status variants images category')
      .populate('category', 'name')
      .lean(),
    Product.countDocuments(filter),
  ]);
  return {
    items: items.map((p) => ({
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      status: p.status,
      stock: p.stock,
      lowStockThreshold: p.lowStockThreshold,
      image: p.images[0]?.url ?? null,
      category: (p.category as unknown as { name?: string })?.name ?? null,
      stockState: p.stock === 0 ? 'out' : p.stock <= p.lowStockThreshold ? 'low' : 'in',
      variants: p.variants.map((v) => ({ id: String(v._id), sku: v.sku, label: v.label, stock: v.stock, isActive: v.isActive })),
    })),
    meta: pageMeta(total, page, limit),
  };
}

export async function listAdjustments(query: { page: number; limit: number; product?: string; reason?: string }) {
  const filter: Record<string, unknown> = {};
  if (query.product) filter.product = new Types.ObjectId(query.product);
  if (query.reason) filter.reason = query.reason;
  const { skip, limit, page } = paginate(query.page, query.limit);
  const [items, total] = await Promise.all([
    InventoryAdjustment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('product', 'name')
      .populate('order', 'orderNumber')
      .lean(),
    InventoryAdjustment.countDocuments(filter),
  ]);
  return {
    items: items.map((a) => ({
      id: String(a._id),
      product: a.product ? { id: String((a.product as unknown as { _id: Types.ObjectId })._id), name: (a.product as unknown as { name: string }).name } : null,
      sku: a.sku,
      delta: a.delta,
      stockAfter: a.stockAfter,
      reason: a.reason,
      order: a.order ? (a.order as unknown as { orderNumber: string }).orderNumber : null,
      actor: a.actor,
      note: a.note ?? null,
      createdAt: a.createdAt,
    })),
    meta: pageMeta(total, page, limit),
  };
}

export async function lowStockProducts(limit = 10) {
  return Product.find({ status: 'active', $expr: { $lte: ['$stock', '$lowStockThreshold'] } })
    .sort({ stock: 1 })
    .limit(limit)
    .select('name sku stock lowStockThreshold images')
    .lean();
}
