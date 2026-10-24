import { Schema, model, type Types } from 'mongoose';

export interface ImageRef {
  url: string;
  publicId?: string;
  alt?: string;
  width?: number;
  height?: number;
}

export const ImageSchema = new Schema<ImageRef>(
  {
    url: { type: String, required: true, maxlength: 500 },
    publicId: { type: String, maxlength: 300 },
    alt: { type: String, maxlength: 200, default: '' },
    width: Number,
    height: Number,
  },
  { _id: false },
);

export interface ICategory {
  name: string;
  slug: string;
  description?: string;
  image?: ImageRef | null;
  parent?: Types.ObjectId | null;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 90 },
    description: { type: String, trim: true, maxlength: 1000 },
    image: { type: ImageSchema, default: null },
    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    isActive: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

CategorySchema.index({ slug: 1 }, { unique: true });
CategorySchema.index({ isActive: 1, displayOrder: 1 });

export const Category = model<ICategory>('Category', CategorySchema);
