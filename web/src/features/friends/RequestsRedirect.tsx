import { Navigate, useSearchParams } from 'react-router';
import { friendsSection, friendsView } from '@/shared/lib/routes';

/** /app/requests no longer exists as a page: old links, bookmarks and
 * notifications still land on the right view of Friends. */
export function RequestsRedirect() {
  const [params] = useSearchParams();
  const target = params.get('tab') === 'invitations' ? friendsView('invitations') : friendsSection('received');
  return <Navigate to={target} replace />;
}
