import { useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useInView } from '../../hooks/useMotion';
import { cn } from '../../lib/format';
import { Sparkle } from '../ui/Icons';

/**
 * Hero artwork with layered 2.5D depth.
 *
 * The default illustration (/samples/hero.svg) is re-drawn as separate
 * layers with the same geometry, so the niche backdrop, floor shadow,
 * necklace, earrings and sparkles can sit at different depths. A custom hero
 * photo set in Admin → Settings is shown as a single layer instead.
 *
 * Depth model ("looking into a display niche"): on mouse move the parent
 * section's usePointerParallax shifts every `data-depth` layer by that many px
 * at full deflection — positive for things behind the arch plane, negative for
 * things in front of it (badge, outer sparkles), so the badge drifts toward an
 * approaching cursor rather than away from it — and turns the `data-tilt`
 * group a few degrees toward the viewer's eye.
 *
 * Performance: the SVGs themselves never animate. Floating, twinkling, the
 * floor shadow and the gold light sweep are all transform/opacity animations
 * on HTML layers, which the browser composites without repainting.
 * With motion off, every layer renders exactly at rest — identical to the
 * static artwork.
 */

export const DEFAULT_HERO_ART = '/samples/hero.svg';

const GOLD = '#c39b57';
const GOLD_L = '#e8cf9c';
const GOLD_D = '#86642c';
const ROSE = '#a63a5f';
const PEARL = '#fbf7f1';

const COINS = Array.from({ length: 9 }, (_, i) => {
  const a = Math.PI * (0.15 + 0.7 * (i / 8));
  return { x: 400 - Math.cos(a) * 230, y: 330 + Math.sin(a) * 300, r: i === 4 ? 48 : 30, inner: i === 4 ? 30 : 18, centre: i === 4 };
});
const EARRING_X = [290, 510];
const PEARL_PATH = 'M0 560c-55 60-70 120-70 160a70 70 0 0 0 140 0c0-40-15-100-70-160Z';
const NECKLACE_TF = 'translate(400 470) scale(.9) translate(-400 -470)';
const EARRINGS_TF = 'translate(120 520) scale(.45)';

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/* Silhouettes used as masks for the light sweep (same geometry as the art). */
const svgUri = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1000'>${body}</svg>`)}")`;
const NECKLACE_MASK = svgUri(
  `<g transform='${NECKLACE_TF}'><path d='M170 330c40 360 420 360 460 0' fill='none' stroke='#000' stroke-width='6'/>${COINS.map(
    (c) => `<circle cx='${c.x.toFixed(1)}' cy='${c.y.toFixed(1)}' r='${c.r}'/>`,
  ).join('')}</g>`,
);
const EARRINGS_MASK = svgUri(
  `<g transform='${EARRINGS_TF}'>${EARRING_X.map(
    (x) => `<g transform='translate(${x} 0)'><circle cy='380' r='22'/><path d='M-30 520h60l-30 40z'/><path d='${PEARL_PATH}'/></g>`,
  ).join('')}</g>`,
);

function Layer({ depth, z, className, children }: { depth: number; z?: string; className?: string; children: ReactNode }) {
  return (
    <div
      aria-hidden
      data-depth={depth}
      data-z={z}
      className={cn('hero-par pointer-events-none absolute inset-0', className)}
      style={z ? ({ '--z': z } as Vars) : undefined}
    >
      {children}
    </div>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" focusable="false" aria-hidden>
      {children}
    </svg>
  );
}

function GoldDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={GOLD_L} />
        <stop offset=".5" stopColor={GOLD} />
        <stop offset="1" stopColor={GOLD_D} />
      </linearGradient>
      <radialGradient id={`${id}-pearl`} cx=".35" cy=".3" r=".75">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset=".6" stopColor={PEARL} />
        <stop offset="1" stopColor="#e6d9cc" />
      </radialGradient>
    </defs>
  );
}

/** A soft champagne light band that sweeps across the metal, then rests. Masked to the jewellery's shape. */
function Sheen({ mask, delay }: { mask: string; delay: string }) {
  return (
    <div className="hero-sheen absolute inset-0" style={{ maskImage: mask, WebkitMaskImage: mask }}>
      <div className="hero-sheen-band absolute inset-y-0 -left-1/2 w-1/2" style={{ '--delay-s': delay } as Vars} />
    </div>
  );
}

/** Positions an HTML sparkle at SVG coordinates (x, y) with the original scale. */
function SvgSparkle({ x, y, s, color, delay }: { x: number; y: number; s: number; color: string; delay: string }) {
  const w = (24 * s) / 8; // % of the 800-wide artboard
  return (
    <span
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x / 8}%`, top: `${y / 10}%`, width: `${w}%`, aspectRatio: '1', color }}
    >
      <Sparkle className="hero-twinkle block size-full" style={{ '--delay-t': delay } as Vars} />
    </span>
  );
}

function IllustrationLayers({ motion }: { motion: boolean }) {
  const id = `ha${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <>
      {/* Back wall of the niche: deepest, drifts furthest with the pointer. */}
      <Layer depth={10} className="scale-[1.04]">
        <Svg>
          <defs>
            <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fae6ec" />
              <stop offset="1" stopColor="#f1e3c4" />
            </linearGradient>
          </defs>
          <rect width="800" height="1000" fill={`url(#${id}-bg)`} />
          <path d="M150 900V430a250 250 0 0 1 500 0v470" fill="none" stroke={GOLD} strokeOpacity=".45" strokeWidth="2" />
          <text x="400" y="965" textAnchor="middle" fontFamily="Georgia,serif" fontSize="22" letterSpacing="8" fill={GOLD_D} fillOpacity=".7">
            SAMPLE IMAGE
          </text>
        </Svg>
      </Layer>

      {/* Floor shadow (ellipse cx 400 cy 860 rx 230 ry 26): tightens as the jewellery floats up. */}
      <Layer depth={8}>
        <div className="absolute left-[21.25%] top-[83.4%] h-[5.2%] w-[57.5%]">
          <div className="hero-floor size-full rounded-[50%] bg-ink/[0.06]" />
        </div>
      </Layer>

      {/* Necklace */}
      <Layer depth={6}>
        <div className="hero-enter-drop absolute inset-0" style={{ '--delay': '260ms' } as Vars}>
          <div className="hero-float absolute inset-0" style={{ '--dur': '7.5s' } as Vars}>
            <Svg>
              <GoldDefs id={`${id}n`} />
              <g transform={NECKLACE_TF}>
                <path d="M170 330c40 360 420 360 460 0" fill="none" stroke={`url(#${id}n-gold)`} strokeWidth="6" />
                {COINS.map((c) => (
                  <g key={c.x} transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`}>
                    <circle r={c.r} fill={`url(#${id}n-gold)`} stroke={GOLD_D} strokeWidth="2" />
                    <circle r={c.inner} fill="none" stroke={GOLD_D} strokeOpacity=".6" strokeWidth="2" />
                    {c.centre && (
                      <>
                        <path d="M0-16l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill={GOLD_D} fillOpacity=".7" />
                        <circle cy="58" r="10" fill={ROSE} />
                      </>
                    )}
                  </g>
                ))}
              </g>
            </Svg>
            {motion && <Sheen mask={NECKLACE_MASK} delay="1.8s" />}
          </div>
        </div>
      </Layer>

      {/* Earrings: nearer the arch opening than the necklace, on their own rhythm. */}
      <Layer depth={3}>
        <div className="hero-enter-drop absolute inset-0" style={{ '--delay': '420ms' } as Vars}>
          <div className="hero-float hero-float-soft absolute inset-0" style={{ '--dur': '6.2s', '--delay-f': '-2.1s' } as Vars}>
            <Svg>
              <GoldDefs id={`${id}e`} />
              <g transform={EARRINGS_TF}>
                {EARRING_X.map((x) => (
                  <g key={x} transform={`translate(${x} 0)`}>
                    <circle cx="0" cy="380" r="22" fill={`url(#${id}e-gold)`} />
                    <circle cx="0" cy="380" r="9" fill={ROSE} />
                    <path d="M0 402v120" stroke={`url(#${id}e-gold)`} strokeWidth="6" />
                    <path d="M-30 520h60l-30 40z" fill={`url(#${id}e-gold)`} />
                    <path d={PEARL_PATH} fill={`url(#${id}e-pearl)`} stroke="#e1d2c2" strokeWidth="2" />
                    <ellipse cx="-22" cy="690" rx="12" ry="24" fill="#fff" fillOpacity=".8" />
                  </g>
                ))}
              </g>
            </Svg>
            {motion && <Sheen mask={EARRINGS_MASK} delay="3.6s" />}
          </div>
        </div>
      </Layer>

      {/* Sparkles at the arch opening. */}
      <Layer depth={0}>
        <div className="hero-enter-pop absolute inset-0" style={{ '--delay': '700ms' } as Vars}>
          <SvgSparkle x={170} y={230} s={1.4} color={GOLD} delay="0s" />
          <SvgSparkle x={640} y={330} s={0.9} color={ROSE} delay="1.3s" />
          <SvgSparkle x={610} y={760} s={0.7} color={GOLD} delay="2.4s" />
        </div>
      </Layer>
    </>
  );
}

export function HeroArt({ imageUrl, motion }: { imageUrl?: string; motion: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const entered = useInView(stage, { threshold: 0.1, rootMargin: '0px' });
  const illustration = imageUrl === DEFAULT_HERO_ART;

  return (
    <div
      ref={stage}
      data-motion={motion ? 'on' : 'off'}
      data-entered={entered ? 'true' : 'false'}
      className="hero-stage relative order-1 mx-auto w-full max-w-[280px] sm:max-w-[380px] lg:order-2 lg:max-w-[460px]"
    >
      <div data-tilt className="hero-tilt relative">
        {/* Offset gold outline sits behind the arch plane. */}
        <Layer depth={5} z="-18px">
          <div className="hero-enter-arch absolute inset-0" style={{ '--delay': '80ms' } as Vars}>
            <div className="arch absolute inset-0 translate-x-4 translate-y-4 border border-gold-400 sm:translate-x-6 sm:translate-y-6" />
          </div>
        </Layer>

        <div className="hero-enter-arch arch relative aspect-[4/5] overflow-hidden bg-blush-100 shadow-lift" style={{ '--delay': '0ms' } as Vars}>
          {illustration ? (
            <IllustrationLayers motion={motion} />
          ) : imageUrl ? (
            <Layer depth={8} className="scale-[1.05]">
              <img src={imageUrl} alt="" className="size-full animate-fade object-cover" fetchPriority="high" />
            </Layer>
          ) : null}
          {/* Soft champagne light that drifts against the pointer, like a moving spotlight. */}
          {motion && imageUrl && (
            <Layer depth={-22}>
              <div className="hero-light absolute -inset-[20%]" />
            </Layer>
          )}
        </div>

        {/* In front of the arch: these drift against the pointer. */}
        <Layer depth={-14} z="16px">
          <span className="hero-enter-pop absolute -left-4 top-16" style={{ '--delay': '820ms' } as Vars}>
            <Sparkle aria-hidden className="block size-7 animate-twinkle text-gold-400" />
          </span>
        </Layer>
        <Layer depth={-20} z="16px">
          <span className="hero-enter-pop absolute -right-2 bottom-24" style={{ '--delay': '960ms' } as Vars}>
            <Sparkle aria-hidden className="block size-4 animate-twinkle text-rose-500 [animation-delay:1.2s]" />
          </span>
        </Layer>

        {/* "Festive edit" badge floats just in front of the arch. */}
        <div data-depth={-10} data-z="24px" className="hero-par hero-front absolute -bottom-5 left-4 sm:left-[-28px]" style={{ '--z': '24px' } as Vars}>
          <div className="hero-enter-rise" style={{ '--delay': '600ms' } as Vars}>
            <Link to="/shop/one-gram-gold" className="hero-badge flex items-center gap-3 rounded-2xl border border-line bg-paper/95 px-4 py-3 shadow-lift">
              <span className="arch flex h-11 w-9 items-end justify-center bg-gold-200 pb-1.5 text-gold-700">
                <Sparkle className="size-3.5" />
              </span>
              <span>
                <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-700">Festive edit</span>
                <span className="font-display text-lg leading-none">One Gram Gold</span>
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
