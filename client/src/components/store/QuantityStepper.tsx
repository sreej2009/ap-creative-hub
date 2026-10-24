import { Minus, Plus } from 'lucide-react';
import { cn } from '../../lib/format';

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 20,
  size = 'md',
  label,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md';
  label: string;
  disabled?: boolean;
}) {
  const btn = cn(
    'inline-flex items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-blush-50 hover:text-rose-700 disabled:opacity-30 disabled:hover:bg-transparent',
    size === 'sm' ? 'size-8' : 'size-10',
  );
  return (
    <div
      role="group"
      aria-label={`Quantity for ${label}`}
      className={cn('inline-flex items-center rounded-full border border-line-strong bg-paper', size === 'sm' ? 'h-9 px-0.5' : 'h-11 px-1')}
    >
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label="Decrease quantity">
        <Minus className="size-3.5" />
      </button>
      <output aria-live="polite" className={cn('text-center font-semibold tabular-nums', size === 'sm' ? 'w-7 text-sm' : 'w-9')}>
        {value}
      </output>
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label="Increase quantity">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
