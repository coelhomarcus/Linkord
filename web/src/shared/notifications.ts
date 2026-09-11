
const ENABLED_KEY = 'ss-notifications-enabled';

export function loadNotificationsEnabled(): boolean {
  const stored = localStorage.getItem(ENABLED_KEY);
  return stored === null ? true : stored === '1';
}

export function saveNotificationsEnabled(value: boolean): void {
  localStorage.setItem(ENABLED_KEY, value ? '1' : '0');
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.requestPermission();
}

let enabled = false;
export function setNotificationsModuleEnabled(value: boolean): void {
  enabled = value;
}

let onClick: ((conversationId: string) => void) | null = null;
export function setNotificationClickHandler(fn: ((conversationId: string) => void) | null): void {
  onClick = fn;
}

interface Buffered {
  conversationName: string;
  senders: Map<string, { name: string; count: number }>;
  lastSenderName: string;
  lastText: string;
  count: number;
  mentioned: boolean;
  firstAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const buffers = new Map<string, Buffered>();

const QUIET_MS = 2000;
const MAX_WAIT_MS = 6000;
const BODY_TEXT_LIMIT = 120;

export interface IncomingChatEvent {
  conversationId: string;
  conversationName: string;
  senderId: string | null;
  senderName: string;
  text: string;
  mentioned: boolean;
}

export function notifyIncomingChatMessage(evt: IncomingChatEvent): void {
  if (!enabled) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const key = evt.senderId ?? '?';
  const conversationId = evt.conversationId;
  let buf = buffers.get(conversationId);
  if (!buf) {
    buf = {
      conversationName: evt.conversationName,
      senders: new Map(),
      lastSenderName: evt.senderName,
      lastText: evt.text,
      count: 0,
      mentioned: false,
      firstAt: Date.now(),
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    buffers.set(conversationId, buf);
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
  buf.timer = setTimeout(() => flush(conversationId), delay);
}

function flush(conversationId: string): void {
  const buf = buffers.get(conversationId);
  if (!buf) return;
  buffers.delete(conversationId);

  const title = buf.mentioned ? `Voce foi mencionado em ${buf.conversationName}` : buf.conversationName;
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
      icon: '/favicon.svg',
      tag: `chat-${conversationId}`,
    });
    notif.onclick = () => {
      window.focus();
      onClick?.(conversationId);
      notif.close();
    };
  } catch {
  }
}
