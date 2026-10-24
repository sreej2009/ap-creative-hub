/**
 * Seeds categories, store settings and a SAMPLE catalogue.
 *
 *   npm run seed                 # create categories/settings, add sample products if none exist
 *   npm run seed -- --reset-samples   # delete and recreate sample products only
 *   npm run seed -- --no-samples      # categories and settings only
 *
 * Every sample product has `isSample: true`, a "SAMPLE-" SKU prefix and
 * placeholder artwork from client/public/samples. Replace or archive them
 * before launch: Admin → Products → filter by search "SAMPLE".
 * Real customer data is never touched.
 */
import { parseArgs } from 'node:util';
import type { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { isProd } from '../config/env.js';
import { listingPricing } from '../lib/pricing.js';
import { slugify } from '../lib/util.js';
import { Category } from '../models/Category.js';
import { InventoryAdjustment } from '../models/InventoryAdjustment.js';
import { StoreSettings } from '../models/misc.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';

const CATEGORIES: { name: string; slug: string; description: string; image: string; parent?: string; order: number }[] = [
  { name: 'Accessories & Jewellery', slug: 'accessories-jewellery', description: 'Everyday sparkle — clips, chains, earrings and bracelets.', image: '/samples/cat-jewellery.svg', order: 1 },
  { name: 'Clips', slug: 'clips', description: 'Claw clips, pearl pins and bows for every hair day.', image: '/samples/clip.svg', parent: 'accessories-jewellery', order: 1 },
  { name: 'Chains', slug: 'chains', description: 'Dainty pendants and layered necklaces.', image: '/samples/chain.svg', parent: 'accessories-jewellery', order: 2 },
  { name: 'Earrings', slug: 'earrings', description: 'Studs, hoops, drops and jhumkas.', image: '/samples/earrings.svg', parent: 'accessories-jewellery', order: 3 },
  { name: 'Bracelets', slug: 'bracelets', description: 'Charm bracelets, kadas and stackables.', image: '/samples/bracelet.svg', parent: 'accessories-jewellery', order: 4 },
  { name: 'One Gram Gold', slug: 'one-gram-gold', description: 'Festive one-gram gold jewellery with a rich finish.', image: '/samples/gold.svg', order: 2 },
  { name: 'Budget Combos', slug: 'budget-combos', description: 'Curated sets that look luxe for less.', image: '/samples/combo.svg', order: 3 },
  { name: 'Games & Gifts', slug: 'games-gifts', description: 'Fun games and thoughtful gift hampers.', image: '/samples/gift.svg', order: 4 },
];

type SampleProduct = {
  name: string;
  category: string;
  price: number; // rupees
  sale?: number; // rupees
  stock: number;
  image: string;
  description: string;
  attrs: [string, string][];
  tags: string[];
  featured?: boolean;
  newArrival?: boolean;
  variants?: { label: string; stock: number }[];
};

const PRODUCTS: SampleProduct[] = [
  { name: 'Pearl Bow Hair Clip Set', category: 'clips', price: 249, sale: 199, stock: 40, image: 'clip', description: 'A set of three faux-pearl bow clips with a soft gold-tone finish. Lightweight and gentle on hair.', attrs: [['Material', 'Alloy'], ['Colour', 'Gold']], tags: ['hair', 'pearl', 'bow'], featured: true, newArrival: true },
  { name: 'Butterfly Claw Clips (Pack of 4)', category: 'clips', price: 299, stock: 25, image: 'clip', description: 'Matte pastel claw clips that hold thick hair all day.', attrs: [['Material', 'Acrylic'], ['Colour', 'Multicolour']], tags: ['hair', 'claw clip'], newArrival: true },
  { name: 'Dainty Heart Pendant Chain', category: 'chains', price: 399, sale: 349, stock: 0, image: 'chain', description: 'A delicate heart pendant on an adjustable 16–18" chain. Anti-tarnish coating.', attrs: [['Material', 'Brass'], ['Occasion', 'Everyday']], tags: ['pendant', 'heart'], featured: true, variants: [{ label: 'Gold', stock: 12 }, { label: 'Silver', stock: 8 }, { label: 'Rose Gold', stock: 3 }] },
  { name: 'Layered Coin Necklace', category: 'chains', price: 549, stock: 14, image: 'chain', description: 'Two-layer necklace with tiny coin charms — the perfect boho stack.', attrs: [['Material', 'Brass'], ['Colour', 'Gold']], tags: ['layered', 'coin'] },
  { name: 'Pearl Drop Earrings', category: 'earrings', price: 299, stock: 30, image: 'earrings', description: 'Classic teardrop pearls on gold-tone hooks. Hypoallergenic posts.', attrs: [['Material', 'Alloy'], ['Colour', 'Gold'], ['Occasion', 'Party']], tags: ['pearl', 'drops'], featured: true },
  { name: 'Oxidised Jhumka Earrings', category: 'earrings', price: 349, sale: 299, stock: 4, image: 'earrings', description: 'Handcrafted oxidised silver-tone jhumkas with a filigree dome.', attrs: [['Material', 'Oxidised Silver'], ['Colour', 'Silver'], ['Occasion', 'Festive']], tags: ['jhumka', 'ethnic'], newArrival: true },
  { name: 'Crystal Huggie Hoops', category: 'earrings', price: 279, stock: 22, image: 'earrings', description: 'Small hoops lined with sparkling crystals. Snap-closure.', attrs: [['Material', 'Alloy'], ['Colour', 'Silver']], tags: ['hoops', 'crystal'] },
  { name: 'Evil Eye Charm Bracelet', category: 'bracelets', price: 249, stock: 35, image: 'bracelet', description: 'Adjustable chain bracelet with a blue evil-eye charm for good vibes.', attrs: [['Material', 'Brass'], ['Colour', 'Gold']], tags: ['evil eye', 'charm'], featured: true },
  { name: 'Adjustable Kada Bangle', category: 'bracelets', price: 449, stock: 3, image: 'bracelet', description: 'Sleek open kada with an adjustable fit. Stacks beautifully.', attrs: [['Material', 'Brass'], ['Colour', 'Gold']], tags: ['kada', 'bangle'] },
  { name: 'One Gram Gold Lakshmi Coin Necklace', category: 'one-gram-gold', price: 1299, sale: 1099, stock: 8, image: 'gold', description: 'Traditional coin necklace in one-gram gold plating with Lakshmi motifs. Comes in a gift pouch.', attrs: [['Material', 'One Gram Gold'], ['Occasion', 'Festive']], tags: ['temple', 'coin', 'festive'], featured: true, newArrival: true },
  { name: 'One Gram Gold Bridal Bangles (Set of 2)', category: 'one-gram-gold', price: 1599, stock: 6, image: 'gold', description: 'Intricately carved bangles with a rich gold finish. Available in common sizes.', attrs: [['Material', 'One Gram Gold'], ['Occasion', 'Bridal']], tags: ['bangles', 'bridal'], variants: [{ label: 'Size 2.4', stock: 3 }, { label: 'Size 2.6', stock: 4 }, { label: 'Size 2.8', stock: 2 }] },
  { name: 'One Gram Gold Stud Earrings', category: 'one-gram-gold', price: 599, stock: 18, image: 'gold', description: 'Floral studs with a ruby-red stone centre. Screw-back closure.', attrs: [['Material', 'One Gram Gold'], ['Occasion', 'Everyday']], tags: ['studs'] },
  { name: 'Everyday Essentials Combo', category: 'budget-combos', price: 599, sale: 499, stock: 20, image: 'combo', description: 'Earrings + pendant chain + hair clip — a complete everyday look at a combo price.', attrs: [['Colour', 'Gold']], tags: ['combo', 'value'], featured: true },
  { name: 'Festive Glam Gift Box', category: 'budget-combos', price: 799, stock: 10, image: 'combo', description: 'Jhumkas, a kada and a velvet pouch, packed in a keepsake box.', attrs: [['Occasion', 'Festive']], tags: ['combo', 'gift'], newArrival: true },
  { name: 'Mini Ludo Travel Game', category: 'games-gifts', price: 199, stock: 50, image: 'game', description: 'Pocket-size magnetic Ludo board for trips and family evenings.', attrs: [['Age', '5+']], tags: ['game', 'travel'] },
  { name: 'Personalised Gift Hamper', category: 'games-gifts', price: 999, sale: 899, stock: 7, image: 'gift', description: 'A jewellery piece, a scented candle and a handwritten note — wrapped and ready to gift.', attrs: [['Occasion', 'Birthday']], tags: ['hamper', 'gift'], featured: true },
];

async function main() {
  const { values } = parseArgs({
    options: {
      'reset-samples': { type: 'boolean', default: false },
      'no-samples': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  });
  if (isProd && !values.force) {
    console.error('Refusing to seed in production without --force. Sample products should not reach a live store.');
    process.exit(1);
  }
  await connectDb();

  await StoreSettings.findOneAndUpdate({ _id: 'store' }, { $setOnInsert: { _id: 'store' } }, { upsert: true, setDefaultsOnInsert: true });
  console.log('✔ store settings ready');

  const ids = new Map<string, Types.ObjectId>();
  for (const c of CATEGORIES) {
    const parent = c.parent ? (ids.get(c.parent) ?? null) : null;
    const doc = await Category.findOneAndUpdate(
      { slug: c.slug },
      { $setOnInsert: { name: c.name, slug: c.slug, description: c.description, image: { url: c.image, alt: c.name }, parent, displayOrder: c.order, isActive: true } },
      { upsert: true, returnDocument: 'after' },
    );
    ids.set(c.slug, doc!._id);
  }
  console.log(`✔ ${CATEGORIES.length} categories ready`);

  if (values['no-samples']) return;

  if (values['reset-samples']) {
    const samples = await Product.find({ isSample: true }).select('_id').lean();
    const used = await Order.distinct('items.product', { 'items.product': { $in: samples.map((s) => s._id) } });
    const removable = samples.filter((s) => !used.some((u) => String(u) === String(s._id)));
    await Product.deleteMany({ _id: { $in: removable.map((r) => r._id) } });
    await InventoryAdjustment.deleteMany({ product: { $in: removable.map((r) => r._id) } });
    console.log(`✔ removed ${removable.length} sample products (${samples.length - removable.length} kept because they appear on orders)`);
  } else if (await Product.exists({ isSample: true })) {
    console.log('• sample products already exist — skipping (use --reset-samples to recreate)');
    return;
  }

  let created = 0;
  for (const [i, p] of PRODUCTS.entries()) {
    const sku = `SAMPLE-${String(i + 1).padStart(3, '0')}`;
    if (await Product.exists({ sku })) continue;
    const price = p.price * 100;
    const salePrice = p.sale ? p.sale * 100 : null;
    const variants = (p.variants ?? []).map((v, vi) => ({ sku: `${sku}-${vi + 1}`, label: v.label, stock: v.stock, isActive: true }));
    const stock = variants.length ? variants.reduce((s, v) => s + v.stock, 0) : p.stock;
    const product = await Product.create({
      name: p.name,
      slug: slugify(p.name),
      sku,
      description: `${p.description}\n\nSample product for demonstration — replace with your real catalogue before launch.`,
      shortDescription: p.description.split('.')[0] + '.',
      category: ids.get(p.category)!,
      tags: p.tags,
      images: [
        { url: `/samples/${p.image}.svg`, alt: p.name },
        { url: `/samples/${p.image}-alt.svg`, alt: `${p.name} — detail` },
      ],
      price,
      salePrice,
      stock,
      lowStockThreshold: 5,
      attributes: p.attrs.map(([name, value]) => ({ name, value })),
      variants,
      isFeatured: !!p.featured,
      isNewArrival: !!p.newArrival,
      status: 'active',
      isSample: true,
      ...listingPricing({ price, salePrice, variants }),
    });
    const rows = product.variants.length
      ? product.variants.filter((v) => v.stock > 0).map((v) => ({ variantId: v._id, sku: v.sku, delta: v.stock, stockAfter: v.stock }))
      : stock > 0
        ? [{ variantId: null, sku, delta: stock, stockAfter: stock }]
        : [];
    if (rows.length) {
      await InventoryAdjustment.create(rows.map((r) => ({ ...r, product: product._id, reason: 'initial_stock' as const, actor: { type: 'system' as const, name: 'Seed script' }, note: 'Sample data' })));
    }
    created++;
  }
  console.log(`✔ created ${created} SAMPLE products (SKUs SAMPLE-001…, flagged isSample=true)`);
}

main()
  .then(() => disconnectDb())
  .catch(async (err) => {
    console.error(err);
    await disconnectDb().catch(() => undefined);
    process.exit(1);
  });
