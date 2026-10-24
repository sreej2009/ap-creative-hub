export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
] as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
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

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  awaiting_payment: 'Awaiting payment',
  cod_pending: 'COD — to collect',
  paid: 'Paid',
  failed: 'Payment not completed',
  void: 'Not charged',
  refund_pending: 'Refund in progress',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
};

export type Tone = 'neutral' | 'rose' | 'gold' | 'success' | 'warning' | 'danger' | 'info';

export function statusTone(status: string): Tone {
  switch (status) {
    case 'pending_payment':
    case 'return_requested':
      return 'warning';
    case 'placed':
    case 'payment_confirmed':
      return 'rose';
    case 'processing':
    case 'packed':
      return 'gold';
    case 'shipped':
    case 'out_for_delivery':
      return 'info';
    case 'delivered':
      return 'success';
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function paymentTone(status: string): Tone {
  if (status === 'paid') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'awaiting_payment' || status === 'refund_pending') return 'warning';
  if (status === 'refunded' || status === 'partially_refunded') return 'info';
  return 'neutral';
}

/** Mirrors the server rule: strips +91 / leading 0 to a 10-digit mobile number. */
export function normalizePhone(v: string) {
  const d = v.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
}
