import { Schema, model, type Types } from 'mongoose';
import { ActorSchema, type Actor } from './Order.js';

export const ADJUSTMENT_REASONS = [
  'initial_stock',
  'restock',
  'correction',
  'damaged',
  'lost',
  'order_reserved',
  'order_released',
  'return_restock',
  'other',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** Manual reasons an admin may pick; the rest are recorded by the system. */
export const MANUAL_ADJUSTMENT_REASONS: AdjustmentReason[] = ['restock', 'correction', 'damaged', 'lost', 'other'];

export interface IInventoryAdjustment {
  product: Types.ObjectId;
  variantId?: Types.ObjectId | null;
  sku: string;
  delta: number;
  stockAfter: number;
  reason: AdjustmentReason;
  order?: Types.ObjectId | null;
  actor: Actor;
  note?: string;
  createdAt: Date;
}

const InventoryAdjustmentSchema = new Schema<IInventoryAdjustment>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    sku: { type: String, required: true },
    delta: { type: Number, required: true },
    stockAfter: { type: Number, required: true },
    reason: { type: String, enum: ADJUSTMENT_REASONS, required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    actor: { type: ActorSchema, required: true },
    note: { type: String, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

InventoryAdjustmentSchema.index({ product: 1, createdAt: -1 });
InventoryAdjustmentSchema.index({ order: 1 });
InventoryAdjustmentSchema.index({ createdAt: -1 });

export const InventoryAdjustment = model<IInventoryAdjustment>('InventoryAdjustment', InventoryAdjustmentSchema);
