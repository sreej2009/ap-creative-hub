/**
 * Pricing rules (all values in paise):
 *  - A product sells at salePrice when set (and lower than price), else at price.
 *  - A variant with its own price uses its own price/salePrice only.
 *  - A variant without its own price inherits the product price, and uses its
 *    own salePrice if set, otherwise the product salePrice.
 */
export interface PriceSource {
  price: number;
  salePrice?: number | null;
}
export interface VariantPriceSource {
  price?: number | null;
  salePrice?: number | null;
  isActive?: boolean;
}

export interface UnitPrice {
  /** What the customer pays per unit. */
  unitPrice: number;
  /** Original price to show struck-through, or null when not discounted. */
  compareAtPrice: number | null;
}

function resolve(price: number, sale: number | null | undefined): UnitPrice {
  if (sale != null && sale < price) return { unitPrice: sale, compareAtPrice: price };
  return { unitPrice: price, compareAtPrice: null };
}

export function unitPriceFor(product: PriceSource, variant?: VariantPriceSource | null): UnitPrice {
  if (!variant) return resolve(product.price, product.salePrice);
  if (variant.price != null) return resolve(variant.price, variant.salePrice);
  return resolve(product.price, variant.salePrice ?? product.salePrice);
}

/** Computed listing fields stored on the product for filtering/sorting. */
export function listingPricing(product: PriceSource & { variants?: VariantPriceSource[] }) {
  const active = (product.variants ?? []).filter((v) => v.isActive !== false);
  const prices = active.length ? active.map((v) => unitPriceFor(product, v)) : [unitPriceFor(product)];
  return {
    sellingPrice: Math.min(...prices.map((p) => p.unitPrice)),
    isOnSale: prices.some((p) => p.compareAtPrice !== null),
  };
}
