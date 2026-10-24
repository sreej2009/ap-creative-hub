import type { IOrder, OrderStatus } from '../models/Order.js';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Awaiting Payment',
  placed: 'Order Placed',
  payment_confirmed: 'Payment Confirmed',
  processing: 'Processing',
  packed: 'Packed',
  shipped: 'Shipped',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  return_requested: 'Return Requested',
  returned: 'Returned',
  refunded: 'Refunded',
};

/**
 * Manual fulfilment transitions an admin may make with the generic status
 * action. Payment confirmation, cancellation, return resolution and refunds
 * have dedicated workflows with their own side effects and checks.
 */
export const ADMIN_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: [],
  placed: ['processing'],
  payment_confirmed: ['processing'],
  processing: ['packed'],
  packed: ['shipped', 'processing'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: ['return_requested'],
  return_requested: [],
  returned: [],
  cancelled: [],
  refunded: [],
};

export const CANCELLABLE_BY_ADMIN: OrderStatus[] = ['pending_payment', 'placed', 'payment_confirmed', 'processing', 'packed'];
export const CANCELLABLE_BY_CUSTOMER: OrderStatus[] = ['pending_payment', 'placed', 'payment_confirmed'];
export const SHIPMENT_EDITABLE: OrderStatus[] = ['processing', 'packed', 'shipped', 'out_for_delivery'];
export const REFUNDABLE_STATUSES: OrderStatus[] = ['cancelled', 'returned'];

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return ADMIN_TRANSITIONS[from].includes(to);
}

type OrderLike = Pick<IOrder, 'status' | 'payment' | 'shipment'>;

export function refundableAmount(order: OrderLike) {
  return Math.max(0, order.payment.amountPaid - order.payment.amountRefunded - (order.payment.refundReserved ?? 0));
}

/** Actions available to admins in the UI; every one is re-validated by the backend. */
export function adminActions(order: OrderLike) {
  const paid = ['paid', 'partially_refunded'].includes(order.payment.status);
  return {
    transitions: ADMIN_TRANSITIONS[order.status],
    canCancel: CANCELLABLE_BY_ADMIN.includes(order.status),
    canEditShipment: SHIPMENT_EDITABLE.includes(order.status),
    canResolveReturn: order.status === 'return_requested',
    canRefund:
      order.payment.method === 'razorpay' && paid && REFUNDABLE_STATUSES.includes(order.status) && refundableAmount(order) > 0,
    canRecordManualRefund:
      order.payment.method === 'cod' && paid && REFUNDABLE_STATUSES.includes(order.status) && refundableAmount(order) > 0,
    canRecordCodPayment:
      order.payment.method === 'cod' &&
      order.payment.status === 'cod_pending' &&
      ['shipped', 'out_for_delivery', 'delivered'].includes(order.status),
  };
}

export function customerActions(order: OrderLike & { reservationExpiresAt?: Date | null }, returnWindowDays: number) {
  const deliveredAt = order.shipment?.deliveredAt;
  const withinWindow =
    order.status === 'delivered' &&
    returnWindowDays > 0 &&
    !!deliveredAt &&
    Date.now() - new Date(deliveredAt).getTime() <= returnWindowDays * 86400_000;
  return {
    canCancel: CANCELLABLE_BY_CUSTOMER.includes(order.status),
    canRequestReturn: withinWindow,
    canPay:
      order.status === 'pending_payment' &&
      order.payment.method === 'razorpay' &&
      !!order.reservationExpiresAt &&
      new Date(order.reservationExpiresAt) > new Date(),
  };
}
