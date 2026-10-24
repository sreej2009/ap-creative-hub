import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { CartQuote, Category, StoreSettings } from '../lib/types';
import type { CartItem } from './useCart';

export function useStoreSettings() {
  return useQuery({
    queryKey: ['store-settings'],
    queryFn: () => api.get<StoreSettings>('/store/settings'),
    staleTime: 5 * 60_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ items: Category[] }>('/categories').then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}

/** Authoritative cart pricing from the server. */
export function useCartQuote(
  items: CartItem[],
  opts: { couponCode?: string; paymentMethod?: 'razorpay' | 'cod'; email?: string; phone?: string; enabled?: boolean } = {},
) {
  const payload = {
    items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
    couponCode: opts.couponCode || undefined,
    paymentMethod: opts.paymentMethod,
    email: opts.email || undefined,
    phone: opts.phone && /^[6-9]\d{9}$/.test(opts.phone) ? opts.phone : undefined,
  };
  return useQuery({
    queryKey: ['quote', payload],
    queryFn: () => api.post<CartQuote>('/cart/quote', payload),
    enabled: (opts.enabled ?? true) && items.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · A&P Creative Hub` : 'A&P Creative Hub — Jewellery, Accessories & Gifts';
  }, [title]);
}
