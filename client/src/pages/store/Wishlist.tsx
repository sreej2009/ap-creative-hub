import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { ProductGrid } from '../../components/store/ProductCard';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { useMe } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { useWishlist } from '../../hooks/useWishlist';
import { api } from '../../lib/api';
import type { ProductCard } from '../../lib/types';

export default function Wishlist() {
  useDocumentTitle('Wishlist');
  const { data: user } = useMe();
  const { ids } = useWishlist();
  const idList = [...ids];

  // Signed-in: server-backed wishlist. Guests: resolve the saved ids from the catalogue.
  const { data, isLoading } = useQuery({
    queryKey: ['account', 'wishlist', user?.id ?? 'guest', idList],
    queryFn: async () => {
      if (user) return (await api.get<{ items: ProductCard[] }>('/account/wishlist')).items.filter((p) => ids.has(p.id));
      return (await api.get<{ items: ProductCard[] }>('/products/lookup', { ids: idList.join(',') })).items;
    },
    enabled: idList.length > 0,
  });

  return (
    <div className="container-page pb-10 pt-8">
      <h1 className="text-[40px] sm:text-[52px]">Wishlist</h1>
      <p className="mt-2 text-sm text-muted">{user ? 'Saved to your account.' : 'Saved on this device. Sign in to keep your wishlist everywhere.'}</p>
      <div className="mt-8">
        {idList.length === 0 ? (
          <EmptyState icon={<Heart className="size-7" />} title="Nothing saved yet" description="Tap the heart on any piece to save it for later." action={<ButtonLink to="/shop">Discover pieces</ButtonLink>} />
        ) : (
          <ProductGrid products={data} loading={isLoading} skeletons={Math.min(idList.length, 8)} />
        )}
      </div>
    </div>
  );
}
