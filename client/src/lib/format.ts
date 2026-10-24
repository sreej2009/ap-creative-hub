const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formats integer paise as rupees: 129900 → "₹1,299", 12950 → "₹129.50". */
export function formatPrice(paise: number | null | undefined): string {
  if (paise == null || Number.isNaN(paise)) return '—';
  return paise % 100 === 0 ? inr0.format(paise / 100) : inr2.format(paise / 100);
}

/** Rupee input string → integer paise (null when empty/invalid). */
export function rupeesToPaise(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function paiseToRupees(paise: number | null | undefined): string {
  if (paise == null) return '';
  return (paise / 100).toFixed(paise % 100 === 0 ? 0 : 2);
}

export function discountPercent(price: number, compareAt: number | null | undefined) {
  if (!compareAt || compareAt <= price) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

export const formatDate = (d: string | Date | null | undefined) => (d ? dateFmt.format(new Date(d)) : '—');
export const formatDateTime = (d: string | Date | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : '—');

export function relativeTime(d: string | Date) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return formatDate(d);
}

export const pluralize = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
