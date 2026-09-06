/** Desktop (OS-level) notifications for incoming chat, batched to avoid
 * flooding — plain module (not a hook), same shape as shared/sounds.ts:
 * RoomProvider's handleServerMessage is a stable useCallback that can only
 * safely reach cross-cutting effects through refs/module state, never
 * fresh hook values, so this mirrors that. */

const ENABLED_KEY = 'ss-notifications-enabled';

/** Opt-in, default OFF — never request OS permission without the user
 * explicitly turning this on in Settings. */
export function loadNotificationsEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === '1';
}

export function saveNotificationsEnabled(value: boolean): void {
  localStorage.setItem(ENABLED_KEY, value ? '1' : '0');
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.requestPermission();
}

let enabled = false; // mirrored from RoomProvider via setNotificationsModuleEnabled
export function setNotificationsModuleEnabled(value: boolean): void {
  enabled = value;
}

let onClick: ((channelId: string) => void) | null = null;
export function setNotificationClickHandler(fn: (channelId: string) => void): void {
  onClick = fn;
}

interface Buffered {
  channelName: string;
  senders: Map<string, { name: string; count: number }>; // key: senderId ?? '?'
  lastSenderName: string;
  lastText: string;
  count: number;
  mentioned: boolean;
  firstAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const buffers = new Map<string, Buffered>(); // channelId -> buffer

// trailing debounce, reset on every message in the channel, so a quiet
// burst collapses into one notification...
const QUIET_MS = 2000;
// ...but a continuous flood still flushes periodically instead of
// buffering forever.
const MAX_WAIT_MS = 6000;
const BODY_TEXT_LIMIT = 120;

export interface IncomingChatEvent {
  channelId: string;
  channelName: string;
  senderId: string | null;
  senderName: string;
  text: string;
  mentioned: boolean;
}

export function notifyIncomingChatMessage(evt: IncomingChatEvent): void {
  if (!enabled) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const key = evt.senderId ?? '?';
  let buf = buffers.get(evt.channelId);
  if (!buf) {
    buf = {
      channelName: evt.channelName,
      senders: new Map(),
      lastSenderName: evt.senderName,
      lastText: evt.text,
      count: 0,
      mentioned: false,
      firstAt: Date.now(),
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    buffers.set(evt.channelId, buf);
  }
  buf.count++;
  buf.lastSenderName = evt.senderName;
  buf.lastText = evt.text;
  buf.mentioned = buf.mentioned || evt.mentioned;
  const sender = buf.senders.get(key);
  if (sender) sender.count++;
  else buf.senders.set(key, { name: evt.senderName, count: 1 });

  clearTimeout(buf.timer);
  const elapsed = Date.now() - buf.firstAt;
  const delay = Math.min(QUIET_MS, Math.max(0, MAX_WAIT_MS - elapsed));
  buf.timer = setTimeout(() => flush(evt.channelId), delay);
}

function flush(channelId: string): void {
  const buf = buffers.get(channelId);
  if (!buf) return;
  buffers.delete(channelId);

  const title = buf.mentioned ? `Voce foi mencionado em #${buf.channelName}` : `#${buf.channelName}`;
  let body: string;
  if (buf.count === 1) {
    body = `${buf.lastSenderName}: ${buf.lastText.slice(0, BODY_TEXT_LIMIT)}`;
  } else if (buf.senders.size === 1) {
    body = `${buf.lastSenderName} enviou ${buf.count} mensagens`;
  } else {
    body = `${buf.senders.size} pessoas enviaram mensagens`;
  }

  try {
    const notif = new Notification(title, {
      body,
      icon: '/icon-192.png',
      // collapses in the OS tray: a later notification for the same
      // channel replaces this one instead of stacking up.
      tag: `chat-${channelId}`,
    });
    notif.onclick = () => {
      window.focus();
      onClick?.(channelId);
      notif.close();
    };
  } catch {
    // Notification() can throw in some embedded/restricted contexts —
    // never let a notification failure break message handling.
  }
}
