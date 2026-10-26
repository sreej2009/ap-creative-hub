import { Sparkle } from '../components/ui/Icons';

/** True only in the static demo build (`npm run build:demo`). */
export const IS_DEMO = import.meta.env.VITE_DEMO === 'true';

export const DEMO_LOGINS = {
  password: 'Demo@2026',
  admin: 'owner@demo.store',
  staff: 'staff@demo.store',
  customer: 'kavya@demo.store',
};

/** Shown on every page of the demo so nobody mistakes it for the live store. */
export function DemoBanner() {
  if (!IS_DEMO) return null;
  const reset = async () => {
    const { resetDemo } = await import('./mockApi');
    resetDemo();
    window.location.reload();
  };
  return (
    <div className="bg-ink text-ivory">
      <p className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-[12px]">
        <Sparkle className="size-2.5 text-gold-300" />
        <span>
          <strong className="font-semibold">Demo store</strong> — sample products and data. No real orders, payments or emails.
        </span>
        <button type="button" onClick={reset} className="text-gold-300 underline underline-offset-2 hover:text-white">
          Reset demo
        </button>
      </p>
    </div>
  );
}

export function DemoLoginHint({ kind, onFill }: { kind: 'admin' | 'customer'; onFill: (email: string, password: string) => void }) {
  if (!IS_DEMO) return null;
  const rows = kind === 'admin' ? [['Admin', DEMO_LOGINS.admin], ['Staff', DEMO_LOGINS.staff]] : [['Sample customer', DEMO_LOGINS.customer]];
  return (
    <div className="rounded-2xl border border-gold-300 bg-gold-200/40 p-3 text-[13px]">
      <p className="font-medium text-gold-700">Demo logins (password {DEMO_LOGINS.password})</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map(([label, email]) => (
          <li key={email} className="flex items-center justify-between gap-2">
            <span>
              {label}: <span className="font-mono text-[12px]">{email}</span>
            </span>
            <button type="button" onClick={() => onFill(email, DEMO_LOGINS.password)} className="font-medium text-rose-700 underline underline-offset-2">
              Use
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
