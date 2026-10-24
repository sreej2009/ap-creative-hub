import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Boxes, ExternalLink, LayoutDashboard, LogOut, Mail, Menu, Package, Settings, Store, Tag, TicketPercent, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAdminMe } from '../../hooks/useAuth';
import { api } from '../../lib/api';
import { cn } from '../../lib/format';
import { Drawer } from '../ui/Dialog';
import { PageLoader } from '../ui/Feedback';

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; permission: string; end?: boolean }[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:read', end: true },
  { to: '/admin/orders', label: 'Orders', icon: Package, permission: 'orders:read' },
  { to: '/admin/products', label: 'Products', icon: Tag, permission: 'products:read' },
  { to: '/admin/categories', label: 'Categories', icon: Store, permission: 'categories:read' },
  { to: '/admin/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory:read' },
  { to: '/admin/customers', label: 'Customers', icon: Users, permission: 'customers:read' },
  { to: '/admin/coupons', label: 'Coupons', icon: TicketPercent, permission: 'coupons:read' },
  { to: '/admin/messages', label: 'Messages', icon: Mail, permission: 'messages:read' },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell, permission: 'notifications:read' },
  { to: '/admin/settings', label: 'Settings', icon: Settings, permission: 'settings:read' },
];

function NavItems({ permissions }: { permissions: string[] }) {
  return (
    <ul className="space-y-0.5">
      {NAV.filter((n) => permissions.includes(n.permission)).map((n) => (
        <li key={n.to}>
          <NavLink
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn(
                'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-colors',
                isActive ? 'bg-white/10 font-medium text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-gold-400' : 'text-[#d8c7c4] hover:bg-white/5 hover:text-white',
              )
            }
          >
            <n.icon className="size-[18px] shrink-0" strokeWidth={1.8} />
            {n.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function SidebarBody({ name, role, permissions, onLogout }: { name: string; role: string; permissions: string[]; onLogout: () => void }) {
  return (
    <div className="flex h-full flex-col bg-plum-900 px-3 py-5">
      <Link to="/admin" className="mb-7 flex items-baseline gap-2 px-3">
        <span className="font-display text-[28px] font-semibold italic text-white">
          A<span className="text-gold-400">&amp;</span>P
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-300">Admin</span>
      </Link>
      <nav aria-label="Admin" className="flex-1 overflow-y-auto">
        <NavItems permissions={permissions} />
      </nav>
      <div className="mt-4 space-y-1 border-t border-white/10 pt-4">
        <a href="/" target="_blank" rel="noopener" className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-[#d8c7c4] hover:bg-white/5 hover:text-white">
          <ExternalLink className="size-4" /> View store
        </a>
        <button type="button" onClick={onLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] text-[#d8c7c4] hover:bg-white/5 hover:text-white">
          <LogOut className="size-4" /> Sign out
        </button>
        <div className="px-3 pt-2 text-xs text-[#b9a6a3]">
          <p className="truncate font-medium text-white">{name}</p>
          <p className="capitalize">{role}</p>
        </div>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const { data: session, isLoading } = useAdminMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);
  const logout = useMutation({
    mutationFn: () => api.post('/auth/admin/logout'),
    onSettled: () => {
      qc.setQueryData(['admin-me'], null);
      qc.removeQueries({ queryKey: ['admin'] });
      navigate('/admin/login', { replace: true });
    },
  });

  if (isLoading) return <PageLoader />;
  if (!session) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  const body = <SidebarBody name={session.user.name} role={session.user.role} permissions={session.permissions} onLogout={() => logout.mutate()} />;
  return (
    <div className="min-h-dvh bg-ivory lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{body}</aside>
      <div className="flex items-center justify-between border-b border-line bg-paper px-4 py-3 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open admin menu" className="rounded-full p-2 text-ink-soft hover:bg-blush-50">
          <Menu className="size-5" />
        </button>
        <span className="font-display text-xl font-semibold italic">
          A<span className="text-gold-500">&amp;</span>P <span className="font-sans text-[10px] font-semibold not-italic uppercase tracking-[0.3em] text-rose-700">Admin</span>
        </span>
        <span className="w-9" />
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} title="Menu" side="left">
        <div className="h-full">{body}</div>
      </Drawer>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {back && (
          <Link to={back.to} className="mb-1 inline-block text-[13px] text-rose-700 hover:underline">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-[32px] sm:text-[38px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-line bg-paper shadow-soft', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          {title && <h2 className="font-display text-xl">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

/** Responsive table wrapper: horizontal scroll on small screens with sticky header styling. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-cream/50 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.12em] [&_th]:text-muted [&_tbody_tr]:border-b [&_tbody_tr]:border-line/70 [&_tbody_tr:last-child]:border-0 [&_tbody_tr:hover]:bg-blush-50/40">
        {children}
      </table>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-3 [&>*]:min-w-[150px]">{children}</div>;
}
