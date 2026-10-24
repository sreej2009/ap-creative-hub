import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readJSON, writeJSON } from '../lib/storage';

/**
 * Cart lives in localStorage. The snapshot fields are only for instant
 * display — prices, stock and totals always come from the server quote.
 */
export interface CartItem {
  productId: string;
  variantId: string | null;
  quantity: number;
  name: string;
  slug: string;
  image: string | null;
  price: number;
  variantLabel: string | null;
}

export const cartKey = (i: { productId: string; variantId: string | null }) => `${i.productId}:${i.variantId ?? ''}`;

const STORAGE_KEY = 'ap_cart_v1';
const MAX_QTY = 20;

interface CartContextValue {
  items: CartItem[];
  count: number;
  add: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => readJSON<CartItem[]>(STORAGE_KEY, []).filter((i) => i && i.productId && i.quantity > 0));
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => writeJSON(STORAGE_KEY, items), [items]);

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setItems(readJSON<CartItem[]>(STORAGE_KEY, []));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback((item: Omit<CartItem, 'quantity'>, quantity = 1) => {
    setItems((all) => {
      const key = cartKey(item);
      const existing = all.find((i) => cartKey(i) === key);
      if (existing) return all.map((i) => (cartKey(i) === key ? { ...i, ...item, quantity: Math.min(i.quantity + quantity, MAX_QTY) } : i));
      return [...all, { ...item, quantity: Math.min(quantity, MAX_QTY) }];
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setItems((all) =>
      quantity <= 0 ? all.filter((i) => cartKey(i) !== key) : all.map((i) => (cartKey(i) === key ? { ...i, quantity: Math.min(quantity, MAX_QTY) } : i)),
    );
  }, []);

  const remove = useCallback((key: string) => setItems((all) => all.filter((i) => cartKey(i) !== key)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(
    () => ({ items, count: items.reduce((s, i) => s + i.quantity, 0), add, setQuantity, remove, clear, drawerOpen, setDrawerOpen }),
    [items, add, setQuantity, remove, clear, drawerOpen],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
