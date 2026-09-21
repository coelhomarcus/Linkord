import type { NotificationEntry } from '@/shared/api/api';
import { ROUTES } from '@/shared/lib/routes';

export function describeNotification(entry: NotificationEntry): string {
  const who = entry.actor?.displayName ?? 'Alguém';
  switch (entry.kind) {
    case 'friend_request': return `${who} enviou uma solicitação de amizade`;
    case 'friend_accepted': return `${who} aceitou sua solicitação de amizade`;
    case 'group_invitation': return `${who} convidou você para ${entry.group ? `o grupo ${entry.group.title}` : 'um grupo'}`;
  }
}

export function notificationTarget(entry: NotificationEntry): string {
  switch (entry.kind) {
    case 'friend_request': return ROUTES.requests;
    case 'friend_accepted': return ROUTES.friends;
    case 'group_invitation': return `${ROUTES.requests}?tab=invitations`;
  }
}

export function formatUnread(count: number): string {
  return count > 9 ? '9+' : String(count);
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} d`;
  return new Date(then).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
