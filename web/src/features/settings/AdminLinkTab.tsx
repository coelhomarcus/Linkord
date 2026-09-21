import { Link } from 'react-router';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';

/** The old Moderation tab is gone: administration has its own area now
 * (/admin), with audited actions, so this only points there. */
export function AdminLinkTab() {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-label text-text-muted">
        Usuários, grupos, denúncias e auditoria ficam na área administrativa. Toda ação pede um motivo e fica registrada.
      </p>
      <Link to={ROUTES.admin} className={buttonVariants()}>Abrir a área administrativa</Link>
    </div>
  );
}
