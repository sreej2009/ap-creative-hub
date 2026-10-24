import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CartProvider, cartKey, useCart } from './useCart';

const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;
const item = { productId: 'p1', variantId: null, name: 'Pearl Drops', slug: 'pearl-drops', image: null, price: 29900, variantLabel: null };

beforeEach(() => localStorage.clear());

describe('cart store', () => {
  it('adds, merges and caps quantities per line', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add(item, 2));
    act(() => result.current.add(item, 3));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.count).toBe(5);
    act(() => result.current.add(item, 50));
    expect(result.current.items[0].quantity).toBe(20);
  });

  it('keeps variants as separate lines and removes at zero quantity', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add({ ...item, variantId: 'gold', variantLabel: 'Gold' }));
    act(() => result.current.add({ ...item, variantId: 'silver', variantLabel: 'Silver' }));
    expect(result.current.items).toHaveLength(2);
    act(() => result.current.setQuantity(cartKey({ productId: 'p1', variantId: 'gold' }), 0));
    expect(result.current.items.map((i) => i.variantId)).toEqual(['silver']);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add(item));
    expect(JSON.parse(localStorage.getItem('ap_cart_v1')!)).toHaveLength(1);
    const second = renderHook(() => useCart(), { wrapper });
    expect(second.result.current.count).toBe(1);
  });
});
