import { useEffect, useState, type RefObject } from 'react';

/**
 * Small, dependency-free motion helpers. All effects are progressive:
 * without JS support, with reduced motion, or on touch screens the page
 * renders in its normal static state.
 */

function matches(query: string) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

export function useMediaQuery(query: string) {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const update = () => setValue(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return value;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** True only for a real mouse/trackpad — mouse-driven effects are skipped on touch devices. */
export const useFinePointer = () => useMediaQuery('(hover: hover) and (pointer: fine)');

/** Becomes true once the element enters the viewport (then stops observing). */
export function useInView<T extends Element>(ref: RefObject<T | null>, options: { threshold?: number; rootMargin?: string } = {}) {
  const { threshold = 0.15, rootMargin = '0px 0px -6% 0px' } = options;
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, inView, threshold, rootMargin]);
  return inView;
}

interface DepthLayer {
  el: HTMLElement;
  d: number;
  z: string;
}

/**
 * Mouse-driven depth for elements inside `ref`:
 *  - every `[data-depth="N"]` element is translated by N px at full pointer
 *    deflection (plus an optional fixed `data-z` such as "24px");
 *  - every `[data-tilt]` element is rotated a few degrees toward the pointer.
 *
 * The pointer position is eased with a short requestAnimationFrame loop that
 * stops once it settles. Values are written as inline `translate`/`transform`
 * on just those elements — non-inherited properties, so no descendant (e.g.
 * the many SVG nodes inside a layer) is restyled per frame. React never
 * re-renders, and everything is removed again on cleanup.
 */
export function usePointerParallax(ref: RefObject<HTMLElement | null>, enabled: boolean, ease = 0.075) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let rect = el.getBoundingClientRect();
    let layers: DepthLayer[] = [];
    let tilts: HTMLElement[] = [];
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let raf = 0;
    let last = 0;

    // Layers can mount after this effect (e.g. once hero data loads), so collect lazily.
    const collect = () => {
      layers = [...el.querySelectorAll<HTMLElement>('[data-depth]')].map((n) => ({
        el: n,
        d: Number(n.dataset.depth) || 0,
        z: n.dataset.z ?? '0px',
      }));
      tilts = [...el.querySelectorAll<HTMLElement>('[data-tilt]')];
    };
    const write = () => {
      for (const l of layers) l.el.style.translate = `${(cx * l.d).toFixed(2)}px ${(cy * l.d).toFixed(2)}px ${l.z}`;
      for (const t of tilts) t.style.transform = `rotateX(${(cy * 3).toFixed(3)}deg) rotateY(${(-cx * 4).toFixed(3)}deg)`;
    };
    const tick = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 16.7;
      last = now;
      const k = 1 - Math.pow(1 - ease, dt / 16.7);
      cx += (tx - cx) * k;
      cy += (ty - cy) * k;
      const settled = Math.abs(tx - cx) < 0.0005 && Math.abs(ty - cy) < 0.0005;
      if (settled) {
        cx = tx;
        cy = ty;
      }
      write();
      raf = settled ? 0 : requestAnimationFrame(tick);
      if (settled) last = 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const measure = () => {
      rect = el.getBoundingClientRect();
    };
    const onEnter = () => {
      measure();
      collect();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      if (!layers.length && !tilts.length) collect();
      tx = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1);
      ty = clamp(((e.clientY - rect.top) / rect.height) * 2 - 1);
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      kick();
    };

    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(raf);
      collect();
      for (const l of layers) l.el.style.removeProperty('translate');
      for (const t of tilts) t.style.removeProperty('transform');
    };
  }, [ref, enabled, ease]);
}
