const DRAFT_PREFIX = 'linkord:chat-draft:';
const MAX_DRAFT_LENGTH = 2000;

function keyFor(channelId: string): string {
  return `${DRAFT_PREFIX}${channelId}`;
}

export function loadChatDraft(channelId: string): string {
  try { return localStorage.getItem(keyFor(channelId))?.slice(0, MAX_DRAFT_LENGTH) ?? ''; }
  catch { return ''; }
}

export function saveChatDraft(channelId: string, value: string): void {
  try {
    if (value) localStorage.setItem(keyFor(channelId), value.slice(0, MAX_DRAFT_LENGTH));
    else localStorage.removeItem(keyFor(channelId));
  } catch { /* storage disabled/full: keep the in-memory draft */ }
}

export function clearChatDraft(channelId: string): void {
  try { localStorage.removeItem(keyFor(channelId)); } catch { /* storage unavailable */ }
}
