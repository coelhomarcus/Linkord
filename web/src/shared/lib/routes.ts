// URL contract of the app (docs/plano-rede-social.md §5.2). Lives in shared/
// because both app/ (which owns the router) and features (sidebar links,
// profile actions) need the same paths, and features must never import app/.

export const SETTINGS_TABS = ['profile', 'account', 'av', 'notifications', 'prefs', 'privacy', 'moderation'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function isSettingsTab(value: string | undefined): value is SettingsTab {
  return !!value && (SETTINGS_TABS as readonly string[]).includes(value);
}

/** The views of the unified Friends page. The view lives in the URL
 * (`?tab=`), so history, links and notifications all mean the same thing. */
export const FRIENDS_VIEWS = ['all', 'online', 'pending', 'invitations', 'add'] as const;
export type FriendsView = (typeof FRIENDS_VIEWS)[number];
export type FriendsSection = 'received' | 'sent';

/** An unknown or missing value is "everyone" — never an empty page. */
export function parseFriendsView(raw: string | null | undefined): FriendsView {
  return (FRIENDS_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as FriendsView) : 'all';
}

export const ROUTES = {
  conversations: '/app/conversations',
  conversation: (id: string) => `/app/conversations/${encodeURIComponent(id)}`,
  friends: '/app/friends',
  /** legacy: redirects to the pending view of Friends; new links use friendsView/friendsSection */
  requests: '/app/requests',
  settings: '/app/settings',
  admin: '/admin/users',
  settingsTab: (tab: SettingsTab) => `/app/settings/${tab}`,
} as const;

export function friendsView(view: FriendsView, query?: string): string {
  const params = new URLSearchParams();
  if (view !== 'all') params.set('tab', view);
  if (query) params.set('q', query);
  const text = params.toString();
  return text ? `${ROUTES.friends}?${text}` : ROUTES.friends;
}

export function friendsSection(section: FriendsSection): string {
  return `${friendsView('pending')}#${section}`;
}

/** The conversation id in a `/app/conversations/:id` path, or null on any
 * other page (or on the bare list route). */
export function conversationIdFromPath(pathname: string): string | null {
  const match = /^\/app\/conversations\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]!); } catch { return null; }
}

export function isConversationsPath(pathname: string): boolean {
  return pathname === ROUTES.conversations || pathname.startsWith(`${ROUTES.conversations}/`);
}

/** Navigation options for "take me to the conversations page, the specific
 * conversation is about to be opened" (a friend's Message button, a
 * notification click). Without the flag, the URL sync would immediately
 * canonicalize the bare route to whatever conversation was active a moment
 * ago — a flash of the wrong conversation and an extra history entry. */
export const AWAITING_OPEN = { state: { awaitingOpen: true } } as const;

export function isAwaitingOpen(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as { awaitingOpen?: unknown }).awaitingOpen === true;
}
