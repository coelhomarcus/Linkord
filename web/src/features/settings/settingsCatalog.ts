import { Bell, IdCard, Lock, Settings2, ShieldCheck, SlidersHorizontal, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SettingsTab } from '@/shared/lib/routes';

export interface SettingsCategory {
  id: SettingsTab;
  label: string;
  /** one line under the page title */
  description: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export interface SettingsGroup {
  label: string;
  categories: SettingsCategory[];
}

// One catalog feeds the desktop sidebar and the compact index, so the two can't
// drift apart. Ids are the public URLs (/app/settings/:id): labels can change,
// ids can't.
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: 'Você',
    categories: [
      { id: 'profile', label: 'Perfil', description: 'Edite direto no seu perfil — o que você vê aqui é exatamente o que os outros vão ver.', icon: User },
      { id: 'account', label: 'Minha conta', description: 'Identificação, e-mail, armazenamento e sessão.', icon: IdCard },
      { id: 'privacy', label: 'Privacidade', description: 'Quem você bloqueou e o que isso muda.', icon: Lock },
    ],
  },
  {
    label: 'Aplicativo',
    categories: [
      { id: 'av', label: 'Áudio e vídeo', description: 'Dispositivos e o processamento do seu microfone.', icon: SlidersHorizontal },
      { id: 'notifications', label: 'Notificações', description: 'Avisos do sistema e sons do app.', icon: Bell },
      { id: 'prefs', label: 'Preferências', description: 'Como a chamada aparece e como imagens são enviadas — só neste navegador, não acompanha a conta entre dispositivos.', icon: Settings2 },
    ],
  },
  {
    label: 'Administração',
    categories: [
      { id: 'moderation', label: 'Administração', description: 'Acesso à área administrativa da instância.', icon: ShieldCheck, adminOnly: true },
    ],
  },
];

/** The groups this account may see — an admin-only category is not listed for anyone else. */
export function visibleGroups(isAdmin: boolean): SettingsGroup[] {
  return SETTINGS_GROUPS
    .map((group) => ({ ...group, categories: group.categories.filter((category) => isAdmin || !category.adminOnly) }))
    .filter((group) => group.categories.length > 0);
}

export function findCategory(id: SettingsTab): SettingsCategory {
  for (const group of SETTINGS_GROUPS) {
    const found = group.categories.find((category) => category.id === id);
    if (found) return found;
  }
  throw new Error(`unknown settings category: ${id}`);
}

/** Carried by a link that leaves the compact index, so "back" can return to the
 * previous history entry instead of pushing the index again. */
export const FROM_INDEX_STATE = { fromIndex: true } as const;
