import { useQuery } from '@tanstack/react-query';
import { ArrowRight, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CategoryArchCard } from '../../components/store/CategoryArchCard';
import { HeroArt } from '../../components/store/HeroArt';
import { whatsappLink } from '../../components/store/Layout';
import { ProductGrid } from '../../components/store/ProductCard';
import { ButtonLink } from '../../components/ui/Button';
import { ErrorState, Skeleton } from '../../components/ui/Feedback';
import { InstagramIcon, Sparkle, WhatsAppIcon } from '../../components/ui/Icons';
import { useFinePointer, useInView, usePointerParallax, useReducedMotion } from '../../hooks/useMotion';
import { useDocumentTitle, useStoreSettings } from '../../hooks/useStore';
import { api } from '../../lib/api';
import { formatPrice } from '../../lib/format';
import type { Category, HomeData, ProductCard } from '../../lib/types';

export function SectionHeading({ eyebrow, title, action, align = 'between' }: { eyebrow?: string; title: ReactNode; action?: ReactNode; align?: 'between' | 'center' }) {
  if (align === 'center') {
    return (
      <div className="mb-8 text-center sm:mb-10">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="mt-2 text-[34px] sm:text-[42px]">{title}</h2>
        <div className="gold-rule mx-auto mt-4 max-w-[180px]">
          <Sparkle className="size-3" />
        </div>
      </div>
    );
  }
  return (
    <div className="mb-7 flex items-end justify-between gap-4 sm:mb-9">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="mt-1.5 text-[30px] sm:text-[38px]">{title}</h2>
      </div>
      {action}
    </div>
  );
}

const ViewAll = ({ to, label = 'View all' }: { to: string; label?: string }) => (
  <Link to={to} className="group inline-flex shrink-0 items-center gap-1.5 pb-2 text-sm font-medium text-rose-700">
    <span className="link-underline">{label}</span>
    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
  </Link>
);

function HeroTitle({ text }: { text: string }) {
  const words = text.trim().split(/\s+/);
  const split = Math.max(1, words.length - 2);
  return (
    <>
      {words.slice(0, split).join(' ')}{' '}
      <em className="font-medium text-rose-600">{words.slice(split).join(' ')}</em>
    </>
  );
}

function Hero({ hero }: { hero?: HomeData['hero'] }) {
  const { data: settings } = useStoreSettings();
  const section = useRef<HTMLElement>(null);
  const motion = !useReducedMotion();
  const finePointer = useFinePointer();
  // Mouse-driven depth only with a real pointer; touch screens keep the gentle float.
  usePointerParallax(section, motion && finePointer);
  return (
    <section ref={section} data-motion={motion ? 'on' : 'off'} data-pointer={motion && finePointer ? 'on' : 'off'} className="relative overflow-hidden">
      {/* Soft background glows: radial gradients instead of blur filters keep them cheap to move. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div data-depth={-18} className="hero-par absolute -right-52 -top-2">
          <div className="hero-ambient size-[620px] rounded-full bg-[radial-gradient(closest-side,rgb(250_230_236/0.75),rgb(250_230_236/0.45)_55%,transparent)]" />
        </div>
        <div data-depth={10} className="hero-par absolute -bottom-10 right-[26%] hidden lg:block">
          <div className="hero-ambient size-[340px] rounded-full bg-[radial-gradient(closest-side,rgb(241_227_196/0.4),transparent)] [animation-delay:-8s]" />
        </div>
      </div>
      <div className="container-page relative grid items-center gap-10 pb-14 pt-8 sm:pt-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-20 lg:pt-16">
        <div className="order-2 lg:order-1">
          {hero ? (
            <>
              <p className="eyebrow flex animate-rise items-center gap-2">
                <Sparkle className="size-3 text-gold-500" /> {hero.eyebrow}
              </p>
              <h1 className="mt-4 animate-rise text-[44px] leading-[1.02] [animation-delay:80ms] sm:text-[60px] lg:text-[72px]">
                <HeroTitle text={hero.title} />
              </h1>
              <p className="mt-5 max-w-lg animate-rise text-[16px] leading-relaxed text-ink-soft [animation-delay:160ms] sm:text-[17px]">{hero.subtitle}</p>
              <div className="mt-8 flex animate-rise flex-wrap gap-3 [animation-delay:240ms]">
                <ButtonLink to={hero.ctaHref} size="lg">
                  {hero.ctaLabel}
                </ButtonLink>
                <ButtonLink to="/shop?newArrival=true" size="lg" variant="secondary">
                  New arrivals
                </ButtonLink>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-16 w-full max-w-md" />
              <Skeleton className="h-16 w-3/4 max-w-sm" />
              <Skeleton className="h-5 w-full max-w-lg" />
            </div>
          )}
          {settings && (
            <ul className="mt-10 grid max-w-lg animate-rise grid-cols-3 gap-3 border-t border-line pt-6 text-[12.5px] text-ink-soft [animation-delay:320ms]">
              <li className="flex flex-col gap-1.5">
                <Truck className="size-5 text-gold-500" aria-hidden />
                {settings.shipping.freeShippingThreshold > 0 ? `Free shipping over ${formatPrice(settings.shipping.freeShippingThreshold)}` : 'Shipping across India'}
              </li>
              <li className="flex flex-col gap-1.5">
                <ShieldCheck className="size-5 text-gold-500" aria-hidden />
                {settings.payments.cod ? 'Secure payments & COD' : 'Secure online payments'}
              </li>
              <li className="flex flex-col gap-1.5">
                <RotateCcw className="size-5 text-gold-500" aria-hidden />
                {settings.returns.windowDays > 0 ? `Easy ${settings.returns.windowDays}-day returns` : 'Quality checked'}
              </li>
            </ul>
          )}
        </div>

        <HeroArt imageUrl={hero?.imageUrl} motion={motion} />
      </div>
    </section>
  );
}

function CategoryArches({ categories }: { categories?: Category[] }) {
  const items = categories?.flatMap((c) => (c.children?.length ? [c, ...c.children] : [c])).slice(0, 8);
  const grid = useRef<HTMLDivElement>(null);
  const motion = !useReducedMotion();
  const finePointer = useFinePointer();
  // Reveal as soon as the first cards peek into view, so nothing sits invisible at the fold.
  const revealed = useInView(grid, { threshold: 0.01, rootMargin: '0px 0px -40px 0px' });
  return (
    <section className="container-page py-14">
      <SectionHeading eyebrow="Find your sparkle" title="Shop by category" align="center" />
      <div
        ref={grid}
        data-motion={motion ? 'on' : 'off'}
        data-revealed={revealed ? 'true' : 'false'}
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-6 sm:overflow-visible sm:px-0 lg:grid-cols-8"
      >
        {(items ?? Array.from({ length: 8 }, () => null)).map((c, i) =>
          c ? (
            <CategoryArchCard key={c.id} category={c} index={i} interactive={motion && finePointer} />
          ) : (
            <div key={i} className="w-[38%] shrink-0 sm:w-auto">
              <Skeleton className="arch aspect-[3/4]" />
              <Skeleton className="mx-auto mt-3 h-4 w-20" />
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function ProductSection({ eyebrow, title, to, products, loading }: { eyebrow: string; title: ReactNode; to: string; products?: ProductCard[]; loading: boolean }) {
  if (!loading && !products?.length) return null;
  return (
    <section className="container-page py-12">
      <SectionHeading eyebrow={eyebrow} title={title} action={<ViewAll to={to} />} />
      <ProductGrid products={products?.slice(0, 4)} loading={loading} skeletons={4} />
    </section>
  );
}

function CombosBand({ products, loading }: { products?: ProductCard[]; loading: boolean }) {
  if (!loading && !products?.length) return null;
  return (
    <section className="my-10 bg-blush-50 py-14">
      <div className="container-page grid gap-10 lg:grid-cols-[320px_1fr] lg:items-center">
        <div>
          <p className="eyebrow">Budget combos</p>
          <h2 className="mt-2 text-[38px] sm:text-[46px]">
            Look luxe, <em className="font-medium text-rose-600">spend less</em>
          </h2>
          <p className="mt-4 text-ink-soft">Curated sets — earrings, chains and clips that go together — priced lower than buying separately.</p>
          <ButtonLink to="/shop/budget-combos" variant="dark" className="mt-6">
            Shop combos
          </ButtonLink>
        </div>
        <ProductGrid products={products?.slice(0, 3)} loading={loading} skeletons={3} className="lg:grid-cols-3" />
      </div>
    </section>
  );
}

function SocialBand() {
  const { data } = useStoreSettings();
  const c = data?.contact;
  if (!c?.instagram && !c?.whatsapp) return null;
  const handle = c.instagram ? c.instagram.replace(/\/$/, '').split('/').pop() : null;
  return (
    <section className="container-page py-14">
      <div className="relative overflow-hidden rounded-[32px] bg-plum-900 px-6 py-14 text-center text-ivory sm:px-12">
        <div aria-hidden className="arch absolute -bottom-24 left-1/2 h-72 w-56 -translate-x-1/2 border border-gold-500/40" />
        <Sparkle aria-hidden className="absolute left-[12%] top-10 size-5 animate-twinkle text-gold-400" />
        <Sparkle aria-hidden className="absolute bottom-12 right-[14%] size-4 animate-twinkle text-blush-300 [animation-delay:1.5s]" />
        <p className="eyebrow text-gold-300">Say hello</p>
        <h2 className="mx-auto mt-3 max-w-xl text-[34px] text-white sm:text-[44px]">
          Styled on Instagram, <em className="font-medium text-blush-300">answered on WhatsApp</em>
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm text-[#d8c7c4]">See new drops first, get styling ideas, or ask us anything about an order.</p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          {c.instagram && (
            <a href={c.instagram} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-medium text-ink hover:bg-gold-200">
              <InstagramIcon className="size-5" /> {handle ? `@${handle}` : 'Instagram'}
            </a>
          )}
          {c.whatsapp && (
            <a href={whatsappLink(c.whatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center gap-2 rounded-full border border-white/30 px-6 text-sm font-medium text-white hover:border-gold-400 hover:text-gold-200">
              <WhatsAppIcon className="size-5" /> Chat on WhatsApp
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  useDocumentTitle();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>('/home'), staleTime: 60_000 });
  if (isError) return <ErrorState message="We couldn't load the store right now." onRetry={() => refetch()} />;
  return (
    <>
      <Hero hero={data?.hero} />
      <CategoryArches categories={data?.categories} />
      <ProductSection eyebrow="Just in" title="New arrivals" to="/shop?newArrival=true" products={data?.newArrivals} loading={isLoading} />
      <CombosBand products={data?.budgetCombos} loading={isLoading} />
      <ProductSection eyebrow="Loved by you" title="Best sellers" to="/shop?sort=popular" products={data?.bestSellers} loading={isLoading} />
      <ProductSection eyebrow="Editor’s picks" title={<>Featured <em className="font-medium text-rose-600">favourites</em></>} to="/shop?featured=true" products={data?.featured} loading={isLoading} />
      <ProductSection eyebrow="Limited time" title="Special offers" to="/shop?onSale=true" products={data?.specialOffers} loading={isLoading} />
      <SocialBand />
    </>
  );
}
