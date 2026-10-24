import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/format';
import { Sparkle } from './Icons';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-muted', className)}>
      <LoaderCircle className="size-5 animate-spin text-rose-600" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

type Tone = 'neutral' | 'rose' | 'gold' | 'success' | 'warning' | 'danger' | 'info';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-cream text-ink-soft',
  rose: 'bg-blush-100 text-rose-800',
  gold: 'bg-gold-200 text-gold-700',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-[#e9f0f7] text-[#2c5680]',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold tracking-wide whitespace-nowrap', toneClass[tone], className)}>
      {children}
    </span>
  );
}

const alertIcon = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const Icon = alertIcon[tone];
  const colors = {
    info: 'border-[#cfdcea] bg-[#f2f6fa] text-[#28486b]',
    success: 'border-[#cde5d6] bg-success-bg text-success',
    warning: 'border-[#efdcb3] bg-warning-bg text-warning',
    danger: 'border-[#f1c7cd] bg-danger-bg text-danger',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-2xl border px-4 py-3 text-sm', colors, className)}>
      <Icon className="mt-0.5 size-[18px] shrink-0" aria-hidden />
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(!!title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

/** Empty state framed in the brand's arch motif. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <div className="arch relative mb-6 flex h-28 w-24 items-end justify-center border border-gold-300 bg-gradient-to-b from-blush-50 to-paper pb-6 text-rose-600">
        {icon ?? <Sparkle className="size-8" />}
        <Sparkle className="absolute -right-3 top-3 size-3.5 text-gold-500 animate-twinkle" />
      </div>
      <h2 className="font-display text-2xl text-ink">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <CircleAlert className="size-8 text-danger" aria-hidden />
      <p className="max-w-md text-sm text-ink-soft">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-sm font-medium text-rose-700 underline underline-offset-4">
          Try again
        </button>
      )}
    </div>
  );
}
