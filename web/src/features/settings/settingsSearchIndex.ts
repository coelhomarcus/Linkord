import type { SettingsTab } from '@/shared/lib/routes';

export interface SearchEntry {
  categoryId: SettingsTab;
  /** Matches a `<SettingsSection id="...">` — the destination becomes
   * `/app/settings/:categoryId#:sectionId`. Profile has none: it's a single
   * card, not a sequence of SettingsSection blocks. */
  sectionId?: string;
  title: string;
  keywords: string[];
  adminOnly?: boolean;
}

// One entry per SettingsSection that exists today (grep '<SettingsSection id='
// across features/settings/*.tsx to keep this honest) — curated, not
// generated, since the sections live scattered across several files.
export const SETTINGS_SEARCH_INDEX: SearchEntry[] = [
  { categoryId: 'profile', title: 'Perfil', keywords: ['foto', 'avatar', 'banner', 'nome de exibição', 'bio', 'links', 'cor'] },
  { categoryId: 'account', sectionId: 'identity', title: 'Identificação', keywords: ['nome de usuário', 'username', 'admin'] },
  { categoryId: 'account', sectionId: 'email', title: 'E-mail', keywords: ['email', 'trocar e-mail', 'confirmar e-mail', 'código'] },
  { categoryId: 'account', sectionId: 'storage', title: 'Armazenamento de anexos', keywords: ['espaço', 'cota', 'arquivos', 'storage'] },
  { categoryId: 'account', sectionId: 'session', title: 'Sessão', keywords: ['sair', 'logout', 'encerrar sessão'] },
  { categoryId: 'privacy', sectionId: 'blocked', title: 'Pessoas bloqueadas', keywords: ['bloqueado', 'desbloquear', 'bloquear'] },
  { categoryId: 'av', sectionId: 'microphone', title: 'Microfone', keywords: ['mic', 'entrada de áudio', 'dispositivo'] },
  { categoryId: 'av', sectionId: 'voice-processing', title: 'Supressão de ruído', keywords: ['ruído', 'processamento de voz', 'rnnoise'] },
  { categoryId: 'av', sectionId: 'speaker', title: 'Alto-falante', keywords: ['saída de áudio', 'som', 'fone'] },
  { categoryId: 'av', sectionId: 'camera', title: 'Câmera', keywords: ['vídeo', 'webcam'] },
  { categoryId: 'notifications', sectionId: 'system', title: 'Notificações do sistema', keywords: ['permissão', 'avisos', 'mensagens'] },
  { categoryId: 'notifications', sectionId: 'sounds', title: 'Sons', keywords: ['volume', 'som', 'testar som', 'mudo'] },
  { categoryId: 'prefs', sectionId: 'call-appearance', title: 'Aparência da chamada', keywords: ['banner', 'estatísticas', 'ocultar participantes', 'tiles'] },
  { categoryId: 'prefs', sectionId: 'image-uploads', title: 'Envio de imagens', keywords: ['compactar', 'imagem', 'anexo'] },
  { categoryId: 'moderation', sectionId: 'admin-area', title: 'Área administrativa', keywords: ['admin', 'denúncia', 'auditoria', 'usuários', 'grupos'], adminOnly: true },
];
