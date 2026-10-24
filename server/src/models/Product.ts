import { Schema, model, type Types } from 'mongoose';
import { ImageSchema, type ImageRef } from './Category.js';

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** All money values are stored as integer paise (₹1 = 100 paise). */
export interface Variant {
  _id: Types.ObjectId;
  sku: string;
  label: string;
  price?: number | null;
  salePrice?: number | null;
  stock: number;
  isActive: boolean;
}

export interface Attribute {
  name: string;
  value: string;
}

export interface IProduct {
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription?: string;
  category: Types.ObjectId;
  tags: string[];
  images: ImageRef[];
  price: number;
  salePrice?: number | null;
  /** Lowest current selling price (computed on save) — used for price filters and sorting. */
  sellingPrice: number;
  /** Computed: true when the product or any active variant is discounted. */
  isOnSale: boolean;
  /** Total sellable units. For products with variants this is the sum of variant stock. */
  stock: number;
  lowStockThreshold: number;
  /** Incremented on every stock change; product edits use it for compare-and-set. */
  inventoryVersion: number;
  attributes: Attribute[];
  variants: Variant[];
  isFeatured: boolean;
  isNewArrival: boolean;
  status: ProductStatus;
  soldCount: number;
  /** Marks seed/demo catalogue entries so they are easy to find and remove. */
  isSample: boolean;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const intMin0 = { validator: (v: number) => Number.isInteger(v) && v >= 0, message: 'must be a whole number ≥ 0' };
const money = {
  validator: (v: number | null | undefined) => v == null || (Number.isInteger(v) && v > 0),
  message: 'must be a positive amount in paise',
};

const VariantSchema = new Schema<Variant>({
  sku: { type: String, required: true, uppercase: true, trim: true, maxlength: 40 },
  label: { type: String, required: true, trim: true, maxlength: 80 },
  price: { type: Number, default: null, validate: money },
  salePrice: { type: Number, default: null, validate: money },
  stock: { type: Number, required: true, default: 0, validate: intMin0 },
  isActive: { type: Boolean, default: true },
});

const ProductSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 160 },
    sku: { type: String, required: true, uppercase: true, trim: true, maxlength: 40 },
    description: { type: String, default: '', maxlength: 5000 },
    shortDescription: { type: String, maxlength: 300 },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    tags: { type: [String], default: [] },
    images: { type: [ImageSchema], default: [] },
    price: { type: Number, required: true, validate: money },
    salePrice: { type: Number, default: null, validate: money },
    sellingPrice: { type: Number, required: true },
    isOnSale: { type: Boolean, default: false },
    stock: { type: Number, required: true, default: 0, validate: intMin0 },
    lowStockThreshold: { type: Number, default: 5, validate: intMin0 },
    inventoryVersion: { type: Number, default: 0 },
    attributes: {
      type: [new Schema<Attribute>({ name: { type: String, maxlength: 40 }, value: { type: String, maxlength: 80 } }, { _id: false })],
      default: [],
    },
    variants: { type: [VariantSchema], default: [] },
    isFeatured: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },
    status: { type: String, enum: PRODUCT_STATUSES, default: 'draft' },
    soldCount: { type: Number, default: 0 },
    isSample: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

ProductSchema.index({ slug: 1 }, { unique: true });
ProductSchema.index({ sku: 1 }, { unique: true });
// Variant SKUs are unique across all products (multikey unique index).
ProductSchema.index(
  { 'variants.sku': 1 },
  { unique: true, partialFilterExpression: { 'variants.sku': { $exists: true } } },
);
ProductSchema.index({ status: 1, category: 1, createdAt: -1 });
ProductSchema.index({ status: 1, isFeatured: 1 });
ProductSchema.index({ status: 1, isNewArrival: 1 });
ProductSchema.index({ status: 1, soldCount: -1 });
ProductSchema.index({ status: 1, sellingPrice: 1 });
ProductSchema.index({ name: 'text', tags: 'text', description: 'text' }, { weights: { name: 10, tags: 5, description: 1 } });

export const effectivePrice = (p: { price: number; salePrice?: number | null }) =>
  p.salePrice != null && p.salePrice < p.price ? p.salePrice : p.price;

export const Product = model<IProduct>('Product', ProductSchema);
