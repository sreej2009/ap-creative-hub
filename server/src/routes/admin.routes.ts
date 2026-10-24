import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import { adminActor, requireAdmin } from '../middleware/auth.js';
import { MANUAL_ADJUSTMENT_REASONS } from '../models/InventoryAdjustment.js';
import {
  AdjustmentListQuery,
  AdminCancelSchema,
  AdminOrderListQuery,
  AdminProductListQuery,
  CategoryInputSchema,
  CodCollectedSchema,
  CouponInputSchema,
  CustomerListQuery,
  CustomerStatusSchema,
  InternalNoteSchema,
  ManualRefundSchema,
  MessageStatusSchema,
  ProductInputSchema,
  ProductStatusSchema,
  RefundSchema,
  ReturnResolutionSchema,
  SettingsSchema,
  ShipmentSchema,
  StatusUpdateSchema,
  StockAdjustSchema,
} from '../schemas/index.js';
import { objectId, pageQuery, searchText } from '../schemas/common.js';
import * as adminQuery from '../services/admin-query.service.js';
import * as categories from '../services/category.service.js';
import * as coupons from '../services/coupon.service.js';
import { getDashboard } from '../services/dashboard.service.js';
import * as fulfilment from '../services/fulfilment.service.js';
import * as inventory from '../services/inventory.service.js';
import { MAX_IMAGE_BYTES, uploadImage } from '../services/media.service.js';
import { refundOrder, recordManualRefund } from '../services/payment.service.js';
import * as products from '../services/product.service.js';
import { getSettings, integrationStatus, updateSettings } from '../services/settings.service.js';

const IdParam = z.object({ id: objectId });

export function adminRoutes() {
  const r = Router();
  // Every admin route requires an authenticated staff/admin session.
  r.use(requireAdmin());

  /* ------------------------------ Dashboard ----------------------------- */

  r.get('/dashboard', requireAdmin('dashboard:read'), async (req, res) => {
    const { range } = parseQuery(z.object({ range: z.enum(['7', '30', '90']).default('30') }), req);
    res.json(await getDashboard(Number(range)));
  });

  /* ------------------------------ Products ------------------------------ */

  r.get('/products', requireAdmin('products:read'), async (req, res) => {
    res.json(await products.listAdminProducts(parseQuery(AdminProductListQuery, req)));
  });

  r.get('/products/:id', requireAdmin('products:read'), async (req, res) => {
    res.json(await products.getAdminProduct(parseParams(IdParam, req).id));
  });

  r.post('/products', requireAdmin('products:write'), async (req, res) => {
    res.status(201).json(await products.createProduct(parseBody(ProductInputSchema, req), adminActor(req)));
  });

  r.put('/products/:id', requireAdmin('products:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    res.json(await products.updateProduct(id, parseBody(ProductInputSchema, req), adminActor(req)));
  });

  r.patch('/products/:id/status', requireAdmin('products:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    res.json(await products.setProductStatus(id, parseBody(ProductStatusSchema, req).status, adminActor(req)));
  });

  r.delete('/products/:id', requireAdmin('products:delete'), async (req, res) => {
    res.json(await products.deleteProduct(parseParams(IdParam, req).id));
  });

  /* ----------------------------- Categories ----------------------------- */

  r.get('/categories', requireAdmin('categories:read'), async (_req, res) => {
    res.json({ items: await categories.listAdminCategories() });
  });

  r.post('/categories', requireAdmin('categories:write'), async (req, res) => {
    res.status(201).json(await categories.createCategory(parseBody(CategoryInputSchema, req)));
  });

  r.put('/categories/:id', requireAdmin('categories:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    res.json(await categories.updateCategory(id, parseBody(CategoryInputSchema, req)));
  });

  r.delete('/categories/:id', requireAdmin('categories:delete'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    const { reassignTo } = parseQuery(z.object({ reassignTo: objectId.optional() }), req);
    res.json(await categories.deleteCategory(id, reassignTo));
  });

  /* -------------------------------- Media ------------------------------- */

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 },
  });

  r.post('/uploads/images', requireAdmin('media:upload'), upload.single('file'), async (req, res) => {
    if (!req.file) throw badRequest('Choose an image to upload.', { file: 'Required' }, 'FILE_REQUIRED');
    const stored = await uploadImage(req.file, req.admin!._id);
    res.status(201).json(stored);
  });

  /* ------------------------------ Inventory ----------------------------- */

  r.get('/inventory', requireAdmin('inventory:read'), async (req, res) => {
    const q = parseQuery(
      z.object({ ...pageQuery, q: searchText, stock: z.enum(['low', 'out', 'in']).optional(), category: objectId.optional() }),
      req,
    );
    res.json({ ...(await inventory.listInventory(q)), reasons: MANUAL_ADJUSTMENT_REASONS });
  });

  r.post('/inventory/:id/adjust', requireAdmin('inventory:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    res.json(await inventory.adjustStock(id, parseBody(StockAdjustSchema, req), adminActor(req)));
  });

  r.get('/inventory/adjustments', requireAdmin('inventory:read'), async (req, res) => {
    res.json(await inventory.listAdjustments(parseQuery(AdjustmentListQuery, req)));
  });

  /* ------------------------------- Orders ------------------------------- */

  r.get('/orders', requireAdmin('orders:read'), async (req, res) => {
    res.json(await adminQuery.listAdminOrders(parseQuery(AdminOrderListQuery, req)));
  });

  r.get('/orders/export', requireAdmin('orders:export'), async (req, res) => {
    const q = parseQuery(AdminOrderListQuery, req);
    const csv = await adminQuery.exportOrdersCsv(q);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${stamp}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(`﻿${csv}`);
  });

  r.get('/orders/:id', requireAdmin('orders:read'), async (req, res) => {
    res.json(await adminQuery.getAdminOrder(parseParams(IdParam, req).id));
  });

  const orderResponse = async (id: string) => adminQuery.getAdminOrder(id);

  r.post('/orders/:id/status', requireAdmin('orders:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    const body = parseBody(StatusUpdateSchema.extend({ shipment: ShipmentSchema.optional() }), req);
    await fulfilment.transitionOrder(id, body.status, adminActor(req), { note: body.note, shipment: body.shipment });
    res.json(await orderResponse(id));
  });

  r.put('/orders/:id/shipment', requireAdmin('orders:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    await fulfilment.updateShipment(id, parseBody(ShipmentSchema, req), adminActor(req));
    res.json(await orderResponse(id));
  });

  r.post('/orders/:id/notes', requireAdmin('orders:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    await fulfilment.addInternalNote(id, parseBody(InternalNoteSchema, req).note, adminActor(req));
    res.json(await orderResponse(id));
  });

  r.post('/orders/:id/clear-attention', requireAdmin('orders:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    await fulfilment.clearAttention(id, adminActor(req));
    res.json(await orderResponse(id));
  });

  r.post('/orders/:id/cancel', requireAdmin('orders:cancel'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    const { reason } = parseBody(AdminCancelSchema, req);
    await fulfilment.cancelOrder(id, adminActor(req), reason);
    res.json(await orderResponse(id));
  });

  r.post('/orders/:id/return', requireAdmin('orders:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    await fulfilment.resolveReturn(id, parseBody(ReturnResolutionSchema, req), adminActor(req));
    res.json(await orderResponse(id));
  });

  r.post('/orders/:id/cod-collected', requireAdmin('orders:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    await fulfilment.recordCodCollected(id, adminActor(req), parseBody(CodCollectedSchema, req).reference);
    res.json(await orderResponse(id));
  });

  r.post('/orders/:id/refunds', requireAdmin('orders:refund'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    const refund = await refundOrder(id, parseBody(RefundSchema, req), adminActor(req));
    res.json({ refund, order: await orderResponse(id) });
  });

  r.post('/orders/:id/manual-refunds', requireAdmin('orders:refund'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    const refund = await recordManualRefund(id, parseBody(ManualRefundSchema, req), adminActor(req));
    res.json({ refund, order: await orderResponse(id) });
  });

  /* ------------------------------ Customers ----------------------------- */

  r.get('/customers', requireAdmin('customers:read'), async (req, res) => {
    res.json(await adminQuery.listCustomers(parseQuery(CustomerListQuery, req)));
  });

  r.get('/customers/:id', requireAdmin('customers:read'), async (req, res) => {
    res.json(await adminQuery.getCustomer(parseParams(IdParam, req).id));
  });

  r.patch('/customers/:id/status', requireAdmin('customers:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    res.json(await adminQuery.setCustomerStatus(id, parseBody(CustomerStatusSchema, req).isActive));
  });

  /* ------------------------------- Coupons ------------------------------ */

  r.get('/coupons', requireAdmin('coupons:read'), async (req, res) => {
    res.json(await coupons.listCoupons(parseQuery(z.object({ ...pageQuery, q: searchText }), req)));
  });

  r.post('/coupons', requireAdmin('coupons:write'), async (req, res) => {
    res.status(201).json(await coupons.createCoupon(parseBody(CouponInputSchema, req), req.admin!._id));
  });

  r.put('/coupons/:id', requireAdmin('coupons:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    res.json(await coupons.updateCoupon(id, parseBody(CouponInputSchema, req)));
  });

  r.delete('/coupons/:id', requireAdmin('coupons:write'), async (req, res) => {
    res.json(await coupons.deleteCoupon(parseParams(IdParam, req).id));
  });

  /* ---------------------- Notifications & messages --------------------- */

  r.get('/notifications', requireAdmin('notifications:read'), async (req, res) => {
    const q = parseQuery(
      z.object({ ...pageQuery, status: z.enum(['sent', 'failed', 'skipped']).optional(), channel: z.enum(['email', 'whatsapp']).optional() }),
      req,
    );
    res.json(await adminQuery.listNotifications(q));
  });

  r.get('/messages', requireAdmin('messages:read'), async (req, res) => {
    const q = parseQuery(z.object({ ...pageQuery, status: z.enum(['new', 'read', 'resolved']).optional() }), req);
    res.json(await adminQuery.listMessages(q));
  });

  r.patch('/messages/:id', requireAdmin('messages:write'), async (req, res) => {
    const { id } = parseParams(IdParam, req);
    res.json(await adminQuery.setMessageStatus(id, parseBody(MessageStatusSchema, req).status));
  });

  /* ------------------------------- Settings ----------------------------- */

  r.get('/settings', requireAdmin('settings:read'), async (_req, res) => {
    const s = await getSettings();
    res.json({ settings: s, integrations: integrationStatus() });
  });

  r.put('/settings', requireAdmin('settings:write'), async (req, res) => {
    const input = parseBody(SettingsSchema, req);
    const s = await updateSettings(input, req.admin!._id);
    res.json({ settings: s, integrations: integrationStatus() });
  });

  return r;
}
