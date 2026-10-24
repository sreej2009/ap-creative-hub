import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';
import { Link } from 'react-router';
import type { Category } from '../../lib/types';

const MAX_TILT_X = 9; // degrees, left/right
const MAX_TILT_Y = 7; // degrees, up/down

/**
 * Category card with perspective tilt on desktop. Pointer position is
 * written to CSS variables (--tx/--ty) at most once per frame; CSS handles
 * the motion and eases back to rest when the pointer leaves. On touch
 * devices or with reduced motion no handlers run and the card is a plain link.
 */
export function CategoryArchCard({ category, index, interactive }: { category: Category; index: number; interactive: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const rect = useRef<DOMRect | null>(null);
  const frame = useRef(0);
  const target = useRef({ x: 0, y: 0 });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const write = () => {
    frame.current = 0;
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--tx', (target.current.x * MAX_TILT_X).toFixed(2));
    el.style.setProperty('--ty', (-target.current.y * MAX_TILT_Y).toFixed(2));
  };

  const onPointerEnter = (e: PointerEvent<HTMLAnchorElement>) => {
    if (!interactive || e.pointerType !== 'mouse') return;
    rect.current = e.currentTarget.getBoundingClientRect();
    e.currentTarget.dataset.tilting = 'true';
  };

  const onPointerMove = (e: PointerEvent<HTMLAnchorElement>) => {
    if (!interactive || e.pointerType !== 'mouse' || !rect.current) return;
    const r = rect.current;
    target.current = {
      x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)),
      y: Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)),
    };
    if (!frame.current) frame.current = requestAnimationFrame(write);
  };

  const onPointerLeave = (e: PointerEvent<HTMLAnchorElement>) => {
    if (!interactive) return;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    rect.current = null;
    target.current = { x: 0, y: 0 };
    const el = e.currentTarget;
    el.dataset.tilting = 'false'; // switches to the slow "settle" transition
    el.style.setProperty('--tx', '0');
    el.style.setProperty('--ty', '0');
  };

  return (
    <Link
      ref={ref}
      to={`/shop/${category.slug}`}
      className="cat-card group w-[38%] shrink-0 snap-start text-center sm:w-auto"
      style={{ '--i': index } as CSSProperties}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className="cat-tilt cat-arch arch relative aspect-[3/4] overflow-hidden border border-line bg-blush-50 group-hover:border-gold-400 group-hover:shadow-lift group-focus-visible:border-gold-400 group-focus-visible:shadow-lift">
        {category.image && (
          <div className="cat-art size-full">
            <img src={category.image.url} alt="" loading="lazy" decoding="async" draggable={false} className="cat-float size-full object-cover" />
          </div>
        )}
      </div>
      <p className="mt-3 font-display text-lg leading-tight">{category.name}</p>
      <p className="text-xs text-muted">{category.productCount} pieces</p>
    </Link>
  );
}
