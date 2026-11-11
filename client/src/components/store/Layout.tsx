import { ArrowUp, ChevronDown, Heart, Menu, Search, ShoppingBag, User as UserIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useMe } from '../../hooks/useAuth';
import { useCart } from '../../hooks/useCart';
import { useCategories, useStoreSettings } from '../../hooks/useStore';
import { useWishlist } from '../../hooks/useWishlist';
import { storeContact } from '../../lib/constants';
import { cn } from '../../lib/format';
import { Drawer, Modal } from '../ui/Dialog';
import { InstagramIcon, Logo, Sparkle, WhatsAppIcon } from '../ui/Icons';
import { CartDrawer } from './CartDrawer';

export function whatsappLink(number: string, text = 'Hi A&P Creative Hub! I have a question.') {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

function AnnouncementBar() {
  const { data } = useStoreSettings();
  if (!data?.announcement) return null;
  return (
    <div className="bg-rose-700 text-white">
      <p className="container-page flex h-9 items-center justify-center gap-2.5 text-center text-[12.5px] tracking-wide">
        <Sparkle className="size-2.5 text-gold-300" />
        <span className="truncate">{data.announcement}</span>
        <Sparkle className="size-2.5 text-gold-300" />
      </p>
    </div>
  );
}

function SearchForm({ onDone, autoFocus, className }: { onDone?: () => void; autoFocus?: boolean; className?: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
    setQ('');
    onDone?.();
  };
  return (
    <form role="search" onSubmit={submit} className={cn('relative', className)}>
      <label htmlFor="site-search" className="sr-only">
        Search products
      </label>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        id="site-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search earrings, chains, combos…"
        autoFocus={autoFocus}
        maxLength={100}
        className="h-10 w-full rounded-full border border-line-strong bg-paper pl-10 pr-4 text-sm placeholder:text-muted/70 focus:border-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-600/20"
      />
    </form>
  );
}

function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-[18px] text-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}

function Header() {
  const { data: categories } = useCategories();
  const { data: user } = useMe();
  const { count, setDrawerOpen } = useCart();
  const wishlist = useWishlist();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    setOpenCat(null);
  }, [location.pathname, location.search]);

  const iconBtn = 'relative inline-flex size-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-blush-50 hover:text-rose-700';

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ivory/95 backdrop-blur supports-[backdrop-filter]:bg-ivory/85">
      <div className="container-page grid h-[68px] grid-cols-[1fr_auto_1fr] items-center gap-3 lg:h-[76px]">
        <div className="flex items-center gap-1">
          <button type="button" className={cn(iconBtn, 'lg:hidden')} onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <button type="button" className={cn(iconBtn, 'lg:hidden')} onClick={() => setSearchOpen(true)} aria-label="Search">
            <Search className="size-5" />
          </button>
          <SearchForm className="hidden w-full max-w-[280px] lg:block" />
        </div>

        <Link to="/" aria-label="A&P Creative Hub — home" className="justify-self-center">
          <Logo />
        </Link>

        <div className="flex items-center justify-end gap-0.5">
          <Link to={user ? '/account' : '/login'} className={cn(iconBtn, 'hidden sm:inline-flex')} aria-label={user ? 'My account' : 'Sign in'}>
            <UserIcon className="size-5" strokeWidth={1.8} />
          </Link>
          <Link to="/wishlist" className={iconBtn} aria-label={`Wishlist, ${wishlist.count} items`}>
            <Heart className="size-5" strokeWidth={1.8} />
            <CountBadge n={wishlist.count} />
          </Link>
          <button type="button" onClick={() => setDrawerOpen(true)} className={iconBtn} aria-label={`Shopping bag, ${count} items`}>
            <ShoppingBag className="size-5" strokeWidth={1.8} />
            <CountBadge n={count} />
          </button>
        </div>
      </div>

      <nav aria-label="Categories" className="hidden border-t border-line/70 lg:block">
        <ul className="container-page flex h-12 items-center justify-center gap-8 text-[13.5px] font-medium tracking-wide">
          <li>
            <NavLink to="/shop" end className={({ isActive }) => cn('link-underline py-1', isActive ? 'text-rose-700' : 'text-ink-soft hover:text-rose-700')}>
              Shop all
            </NavLink>
          </li>
          {categories?.map((c) => (
            <li key={c.id} className="group relative" onMouseLeave={() => setOpenCat(null)}>
              <div className="flex items-center gap-1">
                <NavLink
                  to={`/shop/${c.slug}`}
                  className={({ isActive }) => cn('link-underline py-1', isActive ? 'text-rose-700' : 'text-ink-soft hover:text-rose-700')}
                  onMouseEnter={() => c.children?.length && setOpenCat(c.id)}
                >
                  {c.name}
                </NavLink>
                {!!c.children?.length && (
                  <button
                    type="button"
                    aria-label={`Show ${c.name} sub-categories`}
                    aria-expanded={openCat === c.id}
                    onClick={() => setOpenCat(openCat === c.id ? null : c.id)}
                    className="rounded p-0.5 text-muted hover:text-rose-700"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                )}
              </div>
              {!!c.children?.length && openCat === c.id && (
                <div className="absolute left-1/2 top-full z-50 w-56 -translate-x-1/2 pt-3">
                  <ul className="animate-rise rounded-2xl border border-line bg-paper p-2 shadow-lift">
                    {c.children.map((child) => (
                      <li key={child.id}>
                        <Link to={`/shop/${child.slug}`} className="flex items-center justify-between rounded-xl px-3 py-2 text-ink-soft hover:bg-blush-50 hover:text-rose-700">
                          {child.name}
                          <span className="text-xs text-muted">{child.productCount}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
          <li>
            <NavLink to="/shop?onSale=true" className="link-underline py-1 text-rose-700">
              Offers
            </NavLink>
          </li>
        </ul>
      </nav>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title={<Logo compact />} side="left">
        <div className="space-y-6 p-5">
          <SearchForm onDone={() => setMenuOpen(false)} />
          <ul className="divide-y divide-line">
            <li>
              <Link to="/shop" className="block py-3 font-display text-xl">
                Shop all
              </Link>
            </li>
            {categories?.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex items-center justify-between">
                  <Link to={`/shop/${c.slug}`} className="font-display text-xl">
                    {c.name}
                  </Link>
                  {!!c.children?.length && (
                    <button
                      type="button"
                      onClick={() => setOpenCat(openCat === c.id ? null : c.id)}
                      aria-expanded={openCat === c.id}
                      aria-label={`Toggle ${c.name}`}
                      className="rounded-full p-1.5 text-muted"
                    >
                      <ChevronDown className={cn('size-4 transition-transform', openCat === c.id && 'rotate-180')} />
                    </button>
                  )}
                </div>
                {openCat === c.id && (
                  <ul className="mt-2 space-y-1 border-l border-gold-300 pl-4">
                    {c.children?.map((child) => (
                      <li key={child.id}>
                        <Link to={`/shop/${child.slug}`} className="block py-1.5 text-ink-soft">
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            <li>
              <Link to="/shop?onSale=true" className="block py-3 font-display text-xl text-rose-700">
                Offers
              </Link>
            </li>
          </ul>
          <ul className="space-y-3 text-sm text-ink-soft">
            <li>
              <Link to={user ? '/account' : '/login'}>{user ? 'My account' : 'Sign in / Create account'}</Link>
            </li>
            <li>
              <Link to={user ? '/account/orders' : '/track'}>Track an order</Link>
            </li>
            <li>
              <Link to="/contact">Contact us</Link>
            </li>
            <li>
              <Link to="/faq">FAQ</Link>
            </li>
          </ul>
        </div>
      </Drawer>

      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Search" size="sm">
        <SearchForm autoFocus onDone={() => setSearchOpen(false)} />
      </Modal>
    </header>
  );
}

const FOOTER_LINKS = [
  { to: '/about', label: 'About' },
  { to: '/shop', label: 'Shop' },
  { to: '/track', label: 'Track Order' },
  { to: '/shipping', label: 'Shipping & Returns' },
  { to: '/refund-policy', label: 'Refund Policy' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/terms', label: 'Terms & Conditions' },
  { to: '/faq', label: 'FAQ' },
  { to: '/contact', label: 'Contact' },
];

function Footer() {
  const { data: settings } = useStoreSettings();
  const c = settings ? { ...settings.contact, ...storeContact(settings.contact) } : undefined;
  const social = 'inline-flex size-10 items-center justify-center rounded-full border border-line-strong text-ink-soft transition-colors hover:border-rose-600 hover:text-rose-700';
  return (
    <footer className="mt-24 border-t border-line bg-paper">
      <div className="container-page flex flex-col items-center gap-6 pb-36 pt-10 text-center sm:py-12">
        <Link to="/" aria-label="A&P Creative Hub home">
          <Logo />
        </Link>
        <nav aria-label="Footer">
          <ul className="flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-3 text-sm text-ink-soft">
            {FOOTER_LINKS.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className="hover:text-rose-700">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {(c?.instagram || c?.whatsapp) && (
          <div className="flex gap-3">
            {c.instagram && (
              <a href={c.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className={social}>
                <InstagramIcon className="size-[18px]" />
              </a>
            )}
            {c.whatsapp && (
              <a href={whatsappLink(c.whatsapp)} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className={social}>
                <WhatsAppIcon className="size-[18px]" />
              </a>
            )}
          </div>
        )}
        {c && (
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-[13px] text-ink-soft">
            <li>
              <a href={`mailto:${c.email}`} className="hover:text-rose-700">{c.email}</a>
            </li>
            <li>
              <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="hover:text-rose-700">{c.phone}</a>
            </li>
            <li>{c.address}</li>
          </ul>
        )}
        <p className="text-xs text-muted">© {new Date().getFullYear()} A&amp;P Creative Hub. All rights reserved.</p>
      </div>
    </footer>
  );
}

/** WhatsApp chat button plus a back-to-top button that appears once the page is scrolled. */
function FloatingButtons() {
  const { data } = useStoreSettings();
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const toTop = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };
  return (
    <div className="fixed bottom-5 right-5 z-30 flex flex-col items-center gap-3">
      {data && (
        <a
          href={whatsappLink(storeContact(data.contact).whatsapp)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat with us on WhatsApp"
          className="inline-flex size-13 items-center justify-center rounded-full bg-[#1f9d55] text-white shadow-lift transition-transform hover:scale-105"
        >
          <WhatsAppIcon className="size-6" />
        </a>
      )}
      <button
        type="button"
        onClick={toTop}
        aria-label="Back to top"
        tabIndex={showTop ? 0 : -1}
        aria-hidden={!showTop}
        className={cn(
          'inline-flex size-11 items-center justify-center rounded-full bg-ink text-ivory shadow-lift transition-all duration-300 hover:bg-rose-700',
          showTop ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
      >
        <ArrowUp className="size-5" />
      </button>
    </div>
  );
}

export function StoreLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-ivory">
        Skip to content
      </a>
      <AnnouncementBar />
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
      <FloatingButtons />
    </div>
  );
}
