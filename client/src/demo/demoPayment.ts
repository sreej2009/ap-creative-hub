import type { RazorpaySuccess } from '../lib/razorpay';
import type { RazorpayCheckout } from '../lib/types';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Demo-only stand-in for the Razorpay window. Nothing is charged; the mock
 * backend "verifies" the fake response and marks the order paid.
 */
export function openDemoPayment(payment: RazorpayCheckout): Promise<RazorpaySuccess | null> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[90] flex items-center justify-center bg-ink/50 px-4';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'demo-pay-title');
    root.innerHTML = `
      <div class="w-full max-w-sm rounded-[24px] bg-paper p-6 text-center shadow-lift">
        <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-700">Demo payment</p>
        <h2 id="demo-pay-title" class="mt-2 font-display text-3xl">${rupees(payment.amount)}</h2>
        <p class="mt-1 text-sm text-muted"></p>
        <p class="mt-4 rounded-xl bg-blush-50 px-3 py-2 text-[13px] text-ink-soft">This is a demo store. No money will be charged. The live store opens Razorpay (UPI, cards, net banking) here.</p>
        <div class="mt-5 grid gap-2">
          <button type="button" data-pay class="h-12 rounded-full bg-ink text-sm font-medium text-ivory hover:bg-rose-700">Pay ${rupees(payment.amount)} (demo)</button>
          <button type="button" data-cancel class="h-11 rounded-full text-sm text-ink-soft hover:text-rose-700">Cancel</button>
        </div>
      </div>`;
    root.querySelector('.text-muted')!.textContent = payment.description;

    const close = (result: RazorpaySuccess | null) => {
      document.removeEventListener('keydown', onKey);
      root.remove();
      previous?.focus?.();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
    };
    root.querySelector('[data-pay]')!.addEventListener('click', () =>
      close({
        razorpay_order_id: payment.razorpayOrderId,
        razorpay_payment_id: `pay_demo_${Math.random().toString(36).slice(2, 12)}`,
        razorpay_signature: 'demo',
      }),
    );
    root.querySelector('[data-cancel]')!.addEventListener('click', () => close(null));
    root.addEventListener('click', (e) => {
      if (e.target === root) close(null);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    (root.querySelector('[data-pay]') as HTMLButtonElement).focus();
  });
}
