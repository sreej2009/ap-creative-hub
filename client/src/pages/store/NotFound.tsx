import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { useDocumentTitle } from '../../hooks/useStore';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="container-page py-16">
      <EmptyState
        title="This sparkle has wandered off"
        description="The page you were looking for doesn’t exist or is no longer available."
        action={
          <div className="flex gap-3">
            <ButtonLink to="/">Go home</ButtonLink>
            <ButtonLink to="/shop" variant="secondary">
              Shop all
            </ButtonLink>
          </div>
        }
      />
    </div>
  );
}
