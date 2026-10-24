import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import { customerActor, loadCustomer, requireCustomer } from '../middleware/auth.js';
import { rateLimits } from '../middleware/security.js';
import { ContactMessage } from '../models/misc.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { User, toPublicUser } from '../models/User.js';
import {
  AccountAddressSchema,
  CartQuoteSchema,
  CheckoutSchema,
  ContactSchema,
  CustomerCancelSchema,
  OrderTokenQuery,
  ProductListQuery,
  ProfileSchema,
  RetryPaymentSchema,
  ReturnRequestSchema,
  VerifyPaymentSchema,
  WishlistSchema,
} from '../schemas/index.js';
import { objectId, pageQuery } from '../schemas/common.js';
import { quoteCart } from '../services/cart.service.js';
import { getPublicCategory, listPublicCategories } from '../services/category.service.js';
import { placeOrder } from '../services/checkout.service.js';
import { cancelOrder, requestReturn } from '../services/fulfilment.service.js';
import { notifications } from '../services/notification.service.js';
import { findAccessibleOrder, toCustomerOrder } from '../services/order-helpers.js';
import { retryPayment, verifyCheckoutPayment } from '../services/payment.service.js';
import { getPublicProduct, homeSections, listPublicProducts, relatedProducts, toProductCard } from '../services/product.service.js';
import { getSettings, publicSettings } from '../services/settings.service.js';
import { activeCategoryIds } from '../services/category.service.js';
import { Category } from '../models/Category.js';
import { pageMeta, paginate } from '../lib/util.js';

const SlugParam = z.object({ slug: z.string().trim().toLowerCase().max(160) });
const OrderParam = z.object({ orderNumber: z.string().trim().toUpperCase().max(40) });

export function storeRoutes() {
  const r = Router();
  const checkoutLimit = rateLimits.checkout();
  const trackingLimit = rateLimits.tracking();
  const contactLimit = rateLimits.contact();
  const couponLimit = rateLimits.coupon();

  /* ------------------------------ Catalog ------------------------------ */

  r.get('/store/settings', async (_req, res) => {
    res.json(await publicSettings());
  });

  r.get('/home', async (_req, res) => {
    const [sections, categories, settings] = await Promise.all([homeSections(), listPublicCategories(), publicSettings()]);
    res.json({ ...sections, categories, hero: settings.hero });
  });

  r.get('/categories', async (_req, res) => {
    res.json({ items: await listPublicCategories() });
  });

  r.get('/categories/:slug', async (req, res) => {
    const { slug } = parseParams(SlugParam, req);
    res.json(await getPublicCategory(slug));
  });

  r.get('/products', async (req, res) => {
    res.json(await listPublicProducts(parseQuery(ProductListQuery, req)));
  });

  /** Cards for a set of product ids (guest wishlist). Only sellable products are returned. */
  r.get('/products/lookup', async (req, res) => {
    const { ids } = parseQuery(z.object({ ids: z.string().max(2600).default('') }), req);
    const list = ids.split(',').filter((id) => /^[a-f0-9]{24}$/i.test(id)).slice(0, 100);
    const active = await activeCategoryIds();
    const products = list.length ? await Product.find({ _id: { $in: list }, status: 'active', category: { $in: active } }).lean() : [];
    const cats = new Map((await Category.find().select('name slug').lean()).map((c) => [String(c._id), c]));
    res.json({ items: products.map((p) => toProductCard(p, cats)) });
  });

  r.get('/products/:slug', async (req, res) => {
    const { slug } = parseParams(SlugParam, req);
    res.json(await getPublicProduct(slug));
  });

  r.get('/products/:slug/related', async (req, res) => {
    const { slug } = parseParams(SlugParam, req);
    res.json({ items: await relatedProducts(slug) });
  });

  /* ------------------------------- Cart -------------------------------- */

  r.post('/cart/quote', couponLimit, loadCustomer, async (req, res) => {
    const input = parseBody(CartQuoteSchema, req);
    const quote = await quoteCart({ ...input, email: req.customer?.email ?? input.email });
    // usageKeys are internal; strip before responding.
    if (quote.coupon?.valid) {
      const { usageKeys: _k, couponId: _c, ...coupon } = quote.coupon;
      void _k;
      void _c;
      return res.json({ ...quote, coupon });
    }
    res.json(quote);
  });

  /* ------------------------------ Checkout ----------------------------- */

  r.post('/checkout/orders', checkoutLimit, loadCustomer, async (req, res) => {
    const input = parseBody(CheckoutSchema, req);
    const result = await placeOrder(input, req.customer);
    res.status(201).json(result);
  });

  r.post('/payments/razorpay/verify', checkoutLimit, async (req, res) => {
    const input = parseBody(VerifyPaymentSchema, req);
    res.json(await verifyCheckoutPayment({ ...input, orderNumber: input.orderNumber.toUpperCase() }));
  });

  r.post('/payments/razorpay/retry', checkoutLimit, loadCustomer, async (req, res) => {
    const { orderNumber, token } = parseBody(RetryPaymentSchema, req);
    const order = await findAccessibleOrder(orderNumber.toUpperCase(), { userId: req.customer?._id, token });
    if (!order) throw notFound('Order');
    res.json({ payment: await retryPayment(order) });
  });

  /* ------------------------- Tracking (guest + owner) ------------------ */

  r.get('/track/:orderNumber', trackingLimit, loadCustomer, async (req, res) => {
    const { orderNumber } = parseParams(OrderParam, req);
    const { token } = parseQuery(OrderTokenQuery, req);
    const order = await findAccessibleOrder(orderNumber, { userId: req.customer?._id, token });
    if (!order) throw notFound('Order');
    const settings = await getSettings();
    const isOwner = !!req.customer && !!order.user && order.user.equals(req.customer._id);
    // Token links may be forwarded, so they show less personal data than the signed-in view.
    res.json({ order: toCustomerOrder(order, settings.returns.windowDays, { maskContact: !isOwner }) });
  });

  r.post('/track/:orderNumber/cancel', trackingLimit, loadCustomer, async (req, res) => {
    const { orderNumber } = parseParams(OrderParam, req);
    const { reason, token } = parseBody(CustomerCancelSchema, req);
    const order = await findAccessibleOrder(orderNumber, { userId: req.customer?._id, token });
    if (!order) throw notFound('Order');
    await cancelOrder(order._id, customerActor(req), reason);
    const fresh = await findAccessibleOrder(orderNumber, { userId: req.customer?._id, token });
    const settings = await getSettings();
    res.json({ order: toCustomerOrder(fresh!, settings.returns.windowDays, { maskContact: !req.customer }) });
  });

  r.post('/track/:orderNumber/return', trackingLimit, loadCustomer, async (req, res) => {
    const { orderNumber } = parseParams(OrderParam, req);
    const { reason, token } = parseBody(ReturnRequestSchema, req);
    const order = await findAccessibleOrder(orderNumber, { userId: req.customer?._id, token });
    if (!order) throw notFound('Order');
    await requestReturn(order, reason, customerActor(req));
    const fresh = await findAccessibleOrder(orderNumber, { userId: req.customer?._id, token });
    const settings = await getSettings();
    res.json({ order: toCustomerOrder(fresh!, settings.returns.windowDays, { maskContact: !req.customer }) });
  });

  /* ------------------------------ Contact ------------------------------ */

  r.post('/contact', contactLimit, async (req, res) => {
    const input = parseBody(ContactSchema, req);
    if (input.website) return res.status(201).json({ ok: true }); // honeypot: silently drop bots
    const { website: _w, ...data } = input;
    void _w;
    await ContactMessage.create({ ...data, ip: req.ip });
    await notifications.contactMessage(data);
    res.status(201).json({ ok: true });
  });

  /* ------------------------------ Account ------------------------------ */

  const account = Router();
  account.use(requireCustomer);

  account.get('/profile', (req, res) => {
    res.json({ user: toPublicUser(req.customer!), addresses: req.customer!.addresses });
  });

  account.patch('/profile', async (req, res) => {
    const input = parseBody(ProfileSchema, req);
    const user = req.customer!;
    user.set({ name: input.name, phone: input.phone ?? undefined, ...(input.whatsappOptIn !== undefined ? { whatsappOptIn: input.whatsappOptIn } : {}) });
    await user.save();
    res.json({ user: toPublicUser(user) });
  });

  account.get('/addresses', (req, res) => {
    res.json({ items: req.customer!.addresses });
  });

  account.post('/addresses', async (req, res) => {
    const input = parseBody(AccountAddressSchema, req);
    const user = req.customer!;
    if (user.addresses.length >= 10) return res.status(400).json({ error: { code: 'LIMIT', message: 'You can save up to 10 addresses.' } });
    const makeDefault = input.isDefault || user.addresses.length === 0;
    if (makeDefault) user.addresses.forEach((a) => (a.isDefault = false));
    user.addresses.push({ ...input, country: 'IN', isDefault: makeDefault });
    await user.save();
    res.status(201).json({ items: user.addresses });
  });

  account.put('/addresses/:id', async (req, res) => {
    const { id } = parseParams(z.object({ id: objectId }), req);
    const input = parseBody(AccountAddressSchema, req);
    const user = req.customer!;
    const addr = user.addresses.id(id);
    if (!addr) throw notFound('Address');
    if (input.isDefault) user.addresses.forEach((a) => (a.isDefault = false));
    addr.set({ ...input, isDefault: input.isDefault ?? addr.isDefault });
    await user.save();
    res.json({ items: user.addresses });
  });

  account.delete('/addresses/:id', async (req, res) => {
    const { id } = parseParams(z.object({ id: objectId }), req);
    const user = req.customer!;
    const addr = user.addresses.id(id);
    if (!addr) throw notFound('Address');
    const wasDefault = addr.isDefault;
    addr.deleteOne();
    if (wasDefault && user.addresses[0]) user.addresses[0].isDefault = true;
    await user.save();
    res.json({ items: user.addresses });
  });

  account.get('/wishlist', async (req, res) => {
    const active = await activeCategoryIds();
    const products = await Product.find({ _id: { $in: req.customer!.wishlist }, status: 'active', category: { $in: active } }).lean();
    const cats = new Map((await Category.find().select('name slug').lean()).map((c) => [String(c._id), c]));
    res.json({ items: products.map((p) => toProductCard(p, cats)), productIds: req.customer!.wishlist.map(String) });
  });

  /** Replaces the wishlist (used to merge a guest wishlist after sign-in). */
  account.put('/wishlist', async (req, res) => {
    const { productIds } = parseBody(WishlistSchema, req);
    const existing = await Product.find({ _id: { $in: productIds } }).select('_id').lean();
    await User.updateOne({ _id: req.customer!._id }, { $set: { wishlist: existing.map((p) => p._id) } });
    res.json({ productIds: existing.map((p) => String(p._id)) });
  });

  account.get('/orders', async (req, res) => {
    const q = parseQuery(z.object(pageQuery), req);
    const { skip, limit, page } = paginate(q.page, q.limit);
    const filter = { user: req.customer!._id };
    const [orders, total, settings] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
      getSettings(),
    ]);
    res.json({ items: orders.map((o) => toCustomerOrder(o, settings.returns.windowDays)), meta: pageMeta(total, page, limit) });
  });

  account.get('/orders/:orderNumber', async (req, res) => {
    const { orderNumber } = parseParams(OrderParam, req);
    const order = await findAccessibleOrder(orderNumber, { userId: req.customer!._id });
    if (!order) throw notFound('Order');
    const settings = await getSettings();
    res.json({ order: toCustomerOrder(order, settings.returns.windowDays) });
  });

  r.use('/account', account);
  return r;
}
