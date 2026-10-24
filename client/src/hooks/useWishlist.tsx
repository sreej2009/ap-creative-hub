import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { readJSON, writeJSON } from '../lib/storage';
import { useMe } from './useAuth';

const STORAGE_KEY = 'ap_wishlist_v1';

interface WishlistValue {
  ids: Set<string>;
  has: (id: string) => boolean;
  toggle: (id: string) => boolean;
  count: number;
}

const WishlistContext = createContext<WishlistValue | null>(null);

/**
 * Guests keep a wishlist on this device. After sign-in it is merged into the
 * account wishlist and kept in sync with the server.
 */
export function WishlistProvider({ children }: { children: ReactNode }) {
  const { data: user } = useMe();
  const qc = useQueryClient();
  const [ids, setIds] = useState<string[]>(() => readJSON<string[]>(STORAGE_KEY, []));
  const syncedFor = useRef<string | null>(null);

  useEffect(() => writeJSON(STORAGE_KEY, ids), [ids]);

  useEffect(() => {
    if (!user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    (async () => {
      try {
        const server = await api.get<{ productIds: string[] }>('/account/wishlist');
        const merged = [...new Set([...server.productIds, ...readJSON<string[]>(STORAGE_KEY, [])])].slice(0, 200);
        if (merged.length !== server.productIds.length) {
          const res = await api.put<{ productIds: string[] }>('/account/wishlist', { productIds: merged });
          setIds(res.productIds);
        } else {
          setIds(server.productIds);
        }
      } catch {
        /* keep local list */
      }
    })();
  }, [user]);

  useEffect(() => {
    if (user === null) syncedFor.current = null;
  }, [user]);

  const toggle = useCallback(
    (id: string) => {
      const added = !ids.includes(id);
      const next = added ? [id, ...ids] : ids.filter((x) => x !== id);
      setIds(next);
      if (user) {
        api
          .put('/account/wishlist', { productIds: next })
          .then(() => qc.invalidateQueries({ queryKey: ['account', 'wishlist'] }))
          .catch(() => undefined);
      }
      return added;
    },
    [ids, user, qc],
  );

  const value = useMemo(() => {
    const set = new Set(ids);
    return { ids: set, has: (id: string) => set.has(id), toggle, count: ids.length };
  }, [ids, toggle]);

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used inside WishlistProvider');
  return ctx;
}
