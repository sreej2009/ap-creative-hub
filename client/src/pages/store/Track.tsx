import { useQuery } from '@tanstack/react-query';
import { PackageSearch } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { OrderView } from '../../components/store/OrderView';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState, ErrorState, PageLoader } from '../../components/ui/Feedback';
import { useMe } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../hooks/useStore';
import { ApiError, api } from '../../lib/api';
import { orderToken, rememberOrderToken } from '../../lib/storage';
import type { CustomerOrder } from '../../lib/types';

/** /track — explains how tracking works for guests; signed-in customers go to their orders. */
export function TrackLanding() {
  useDocumentTitle('Track your order');
  const { data: user, isLoading } = useMe();
  if (isLoading) return <PageLoader />;
  if (user) return <Navigate to="/account/orders" replace />;
  return (
    <div className="container-page py-10">
      <EmptyState
        icon={<PackageSearch className="size-7" />}
        title="Track your order"
        description="Open the secure tracking link from your order confirmation email, or sign in to see all your orders. For privacy, orders can’t be looked up by number alone."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink to="/login?next=/account/orders">Sign in</ButtonLink>
            <ButtonLink to="/contact" variant="secondary">
              Contact us
            </ButtonLink>
          </div>
        }
      />
    </div>
  );
}

export default function Track() {
  const { orderNumber = '' } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') ?? orderToken(orderNumber) ?? undefined;
  const celebrate = params.get('placed') === '1';
  const paymentNotice = params.get('payment') as 'dismissed' | 'pending' | 'failed' | null;
  useDocumentTitle(`Order ${orderNumber}`);

  useEffect(() => {
    if (params.get('token')) rememberOrderToken(orderNumber, params.get('token')!);
  }, [orderNumber, params]);

  const queryKey = ['track', orderNumber, token];
  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => api.get<{ order: CustomerOrder }>(`/track/${encodeURIComponent(orderNumber)}`, { token }).then((r) => r.order),
    // Poll briefly while a payment is being confirmed.
    refetchInterval: (q) => (q.state.data?.status === 'pending_payment' && paymentNotice === 'pending' ? 5000 : false),
  });

  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="container-page py-10">
        <EmptyState
          title="We couldn’t open this order"
          description="The tracking link may be incomplete. Use the full link from your confirmation email, or sign in to the account you ordered with."
          action={<ButtonLink to="/login?next=/account/orders">Sign in</ButtonLink>}
        />
      </div>
    );
  }
  if (error || !data) return <ErrorState message="We couldn't load this order." onRetry={() => refetch()} />;

  return (
    <div className="container-page pb-10 pt-8">
      <OrderView order={data} token={token} celebrate={celebrate} paymentNotice={paymentNotice} queryKey={queryKey} />
    </div>
  );
}
