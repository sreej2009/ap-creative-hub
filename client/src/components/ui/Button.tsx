import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '../../lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger' | 'link';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-wide transition-[background-color,color,border-color,box-shadow,transform] duration-200 disabled:opacity-55 disabled:cursor-not-allowed select-none whitespace-nowrap active:translate-y-px';

const variants: Record<Variant, string> = {
  primary: 'bg-rose-600 text-white shadow-[0_6px_18px_-8px_rgb(166_58_95/0.7)] hover:bg-rose-700',
  secondary: 'border border-line-strong bg-paper text-ink hover:border-rose-600 hover:text-rose-700',
  ghost: 'text-ink-soft hover:bg-blush-50 hover:text-rose-700',
  dark: 'bg-ink text-ivory hover:bg-plum-800',
  danger: 'bg-danger text-white hover:brightness-95',
  link: 'text-rose-700 underline-offset-4 hover:underline rounded-md px-0 h-auto',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-6 text-sm',
  lg: 'h-12 px-8 text-[15px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, variants[variant], variant !== 'link' && sizes[size], block && 'w-full', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  block,
  className,
  children,
  icon,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; block?: boolean; icon?: ReactNode }) {
  return (
    <Link className={cn(base, variants[variant], variant !== 'link' && sizes[size], block && 'w-full', className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({
  label,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-blush-50 hover:text-rose-700 disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
