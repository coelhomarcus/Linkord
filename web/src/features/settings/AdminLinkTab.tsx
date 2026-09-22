import { Link } from 'react-router';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

/** The old Moderation tab is gone: administration has its own area now
 * (/admin), with audited actions, so this only points there. */
export function AdminLinkTab() {
  return (
    <SettingsSections>
      <SettingsSection id="admin-area" title="Área administrativa">
        <SettingsRow
          label="Usuários, grupos, denúncias e auditoria"
          description="Toda ação pede um motivo e fica registrada."
        >
          <Link to={ROUTES.admin} className={buttonVariants()}>Abrir a área administrativa</Link>
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}
