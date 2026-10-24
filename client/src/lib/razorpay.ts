import type { RazorpayCheckout } from './types';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, cb: (resp: unknown) => void): void };
  }
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading: Promise<void> | null = null;

export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load the payment window. Check your connection and try again.'));
    };
    document.body.appendChild(s);
  });
  return loading;
}

export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/**
 * Opens Razorpay Checkout. Resolves with the signed response on success,
 * or null if the customer closes the window. The signature is verified by
 * our server — success here does NOT mean the order is paid.
 */
export async function openRazorpay(payment: RazorpayCheckout): Promise<RazorpaySuccess | null> {
  await loadRazorpay();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: payment.keyId,
      order_id: payment.razorpayOrderId,
      amount: payment.amount,
      currency: payment.currency,
      name: payment.name,
      description: payment.description,
      prefill: payment.prefill,
      theme: { color: '#a63a5f' },
      handler: (resp: RazorpaySuccess) => resolve(resp),
      modal: { ondismiss: () => resolve(null), confirm_close: true },
    });
    rzp.on('payment.failed', () => {
      /* Razorpay shows the failure and lets the customer retry inside the modal. */
    });
    try {
      rzp.open();
    } catch (err) {
      reject(err);
    }
  });
}
