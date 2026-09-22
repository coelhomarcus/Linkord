import { CircleUserRound, Inbox, Mail, MessageCirclePlus, Phone, Settings, ShieldCheck, UserPlus, Users, Wifi } from 'lucide-react';
import type { CommandItem } from '@/shared/ui/motion/command-palette';
import { Avatar } from '@/shared/Avatar';
import { CountBadge } from '@/shared/CountBadge';
import { visibleGroups } from '@/features/settings/settingsCatalog';
import { ROUTES, friendsView } from '@/shared/lib/routes';
import type { Conversation, Participant, PublicUser } from '@/shared/types/protocol';
import { conversationTitle, directUser } from './conversationUtils';
import { GroupAvatar } from './GroupAvatar';

const ROW_AVATAR_SIZE = 20;

interface CommandPaletteActions {
  onOpenConversation: (conversationId: string) => void;
  onMessageUser: (userId: string) => void;
  onCall: (conversationId: string) => void;
  /** Any in-app path — used by the navigation-only shortcuts below (Amigos,
   * Ajustes, Área administrativa) that don't need conversation/room state
   * threaded through, just a route change. */
  onNavigate: (path: string) => void;
  onOpenProfile: (userId: string) => void;
}

/** The same visual identity shown everywhere else for this conversation
 * (ConversationSidebar's rows, ConversationPanel's header) — a direct
 * conversation shows the OTHER member's own avatar, a group shows its own
 * (or its initials, via GroupAvatar). Sized down for a command-row instead
 * of a sidebar row. */
function conversationAvatar(conversation: Conversation, title: string, meUserId: string | null, allUsers: Map<string, PublicUser>) {
  if (conversation.type === 'direct') {
    const other = directUser(conversation, meUserId, allUsers);
    if (other) return <Avatar id={other.id} name={other.displayName} avatar={other.avatar} avatarColor={other.avatarColor} size={ROW_AVATAR_SIZE} />;
  }
  return <GroupAvatar title={title} avatar={conversation.avatar} size={ROW_AVATAR_SIZE} />;
}

function userAvatar(user: PublicUser) {
  return <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={ROW_AVATAR_SIZE} />;
}

function countBadge(count: number) {
  return count > 0 ? <CountBadge label={`${count}`}>{count > 99 ? '99+' : count}</CountBadge> : undefined;
}

interface FriendsSummary {
  pendingFriendRequestCount: number;
  pendingInvitationCount: number;
}

/** Pure builder for the ⌘K command palette's item list — kept separate from
 * where it's assembled (App.tsx#Shell) so the grouping/dedup logic can be
 * tested without mocking the whole RoomContext. `actions` is the only
 * side-effecting part, injected by the caller.
 *
 * The root list stays short on purpose: existing conversations, calls
 * already happening, and a handful of ACTIONS that either drill into their
 * own searchable sub-list ("Ligar para…"/"Conversar com…"/"Amigos"/
 * "Ajustes", see CommandItem.stage) or go straight to one destination
 * ("Meu perfil", "Área administrativa") — never every person/setting/friend
 * dumped flat into the root. */
export function buildCommandItems(
  conversations: Conversation[],
  allUsers: Map<string, PublicUser>,
  meUserId: string | null,
  participants: Map<string, Participant>,
  activeCallConversationId: string | null,
  friendUserIds: Set<string>,
  friends: FriendsSummary,
  isAdmin: boolean,
  actions: CommandPaletteActions
): CommandItem[] {
  const items: CommandItem[] = [];

  // Which conversations currently have someone actually in a call, other
  // than the one I'm already in myself — that one gets its own "iniciar"
  // framing below instead, since "entrar" in a call I'm already in isn't a
  // meaningful new action.
  const conversationsWithActiveCall = new Set<string>();
  for (const participant of participants.values()) {
    if (participant.callConversationId && participant.callConversationId !== activeCallConversationId) {
      conversationsWithActiveCall.add(participant.callConversationId);
    }
  }

  // "Ligar para…" stage — one entry per conversation not already in a call
  // (group or direct; excluding the one I'm already in). The stage's own
  // header already says "Ligar para", so the label is just the title.
  const callStageItems: CommandItem[] = [];
  for (const conversation of conversations) {
    if (conversationsWithActiveCall.has(conversation.id) || conversation.id === activeCallConversationId) continue;
    const title = conversationTitle(conversation, meUserId, allUsers);
    callStageItems.push({
      id: `start-call:${conversation.id}`,
      label: title,
      avatar: conversationAvatar(conversation, title, meUserId, allUsers),
      onSelect: () => actions.onCall(conversation.id),
    });
  }

  // "Conversar com…" stage — one entry per FRIEND (DMs are friends-only,
  // docs/plano-rede-social.md §3). allUsers also carries non-friend
  // conversation co-members — friendUserIds is the subset that's actually
  // allowed here. Includes friends I already have a DM with too: picking
  // one just reopens that conversation (getOrCreateDirect on the server),
  // it's not a duplicate of "Conversas" — a different, searchable way in.
  const messageStageItems: CommandItem[] = [];
  for (const user of allUsers.values()) {
    if (user.id === meUserId || !friendUserIds.has(user.id)) continue;
    messageStageItems.push({
      id: `person:${user.id}`,
      label: user.displayName,
      keywords: [user.username],
      avatar: userAvatar(user),
      onSelect: () => actions.onMessageUser(user.id),
    });
  }

  // "Amigos" stage — the same destinations as the Amigos page's own tabs
  // (web/src/shared/lib/routes.ts#FRIENDS_VIEWS), so this is a shortcut to
  // navigate there, not a second implementation of anything.
  const friendsStageItems: CommandItem[] = [
    { id: 'friends:all', label: 'Todos os amigos', icon: Users, onSelect: () => actions.onNavigate(friendsView('all')) },
    { id: 'friends:online', label: 'Amigos online', icon: Wifi, onSelect: () => actions.onNavigate(friendsView('online')) },
    {
      id: 'friends:pending', label: 'Solicitações de amizade', icon: Inbox,
      badge: countBadge(friends.pendingFriendRequestCount),
      onSelect: () => actions.onNavigate(friendsView('pending')),
    },
    {
      id: 'friends:invitations', label: 'Convites de grupo', icon: Mail,
      badge: countBadge(friends.pendingInvitationCount),
      onSelect: () => actions.onNavigate(friendsView('invitations')),
    },
    { id: 'friends:add', label: 'Adicionar amigo', icon: UserPlus, onSelect: () => actions.onNavigate(friendsView('add')) },
  ];
  // "Ajustes" stage — same catalog (and the same admin-only filtering) as
  // the settings sidebar/index, see settingsCatalog.ts.
  const settingsStageItems: CommandItem[] = visibleGroups(isAdmin).flatMap((group) => group.categories).map((category) => ({
    id: `settings:${category.id}`,
    label: category.label,
    icon: category.icon,
    onSelect: () => actions.onNavigate(ROUTES.settingsTab(category.id)),
  }));

  // Call/message stay first — the two most-used actions, unchanged from
  // before the social-navigation shortcuts below were added.
  items.push({
    id: 'action:call',
    label: 'Ligar para…',
    group: 'Ações',
    icon: Phone,
    stage: { items: callStageItems, placeholder: 'Ligar pra quem?' },
  });
  items.push({
    id: 'action:message',
    label: 'Conversar com…',
    group: 'Ações',
    icon: MessageCirclePlus,
    stage: { items: messageStageItems, placeholder: 'Conversar com quem?' },
  });
  items.push({
    id: 'action:friends',
    label: 'Amigos',
    group: 'Ações',
    icon: Users,
    badge: countBadge(friends.pendingFriendRequestCount + friends.pendingInvitationCount),
    stage: { items: friendsStageItems, placeholder: 'Amigos' },
  });
  items.push({
    id: 'action:settings',
    label: 'Ajustes',
    group: 'Ações',
    icon: Settings,
    stage: { items: settingsStageItems, placeholder: 'Buscar em ajustes' },
  });
  items.push({
    id: 'action:profile',
    label: 'Meu perfil',
    group: 'Ações',
    icon: CircleUserRound,
    onSelect: () => { if (meUserId) actions.onOpenProfile(meUserId); },
  });
  if (isAdmin) {
    items.push({
      id: 'action:admin',
      label: 'Área administrativa',
      group: 'Ações',
      icon: ShieldCheck,
      onSelect: () => actions.onNavigate(ROUTES.admin),
    });
  }

  for (const conversation of conversations) {
    if (!conversationsWithActiveCall.has(conversation.id)) continue;
    const title = conversationTitle(conversation, meUserId, allUsers);
    items.push({
      id: `join-call:${conversation.id}`,
      label: `Entrar na chamada em ${title}`,
      group: 'Chamadas em andamento',
      avatar: conversationAvatar(conversation, title, meUserId, allUsers),
      onSelect: () => actions.onCall(conversation.id),
    });
  }

  for (const conversation of conversations) {
    const title = conversationTitle(conversation, meUserId, allUsers);
    items.push({
      id: `conversation:${conversation.id}`,
      label: title,
      group: 'Conversas',
      avatar: conversationAvatar(conversation, title, meUserId, allUsers),
      onSelect: () => actions.onOpenConversation(conversation.id),
    });
  }

  return items;
}
