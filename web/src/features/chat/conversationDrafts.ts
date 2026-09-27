import { useCallback, useSyncExternalStore } from 'react';

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

export interface ConversationDraft {
  text: string;
  pendingFiles: PendingAttachment[];
  attachError: string | null;
  /** Non-null while a batch is uploading — it also blocks a second submit. */
  upload: { activeFileId: string | null; progress: number } | null;
  /** The message a partially-failed batch already created; the next submit
   * appends the remaining files to it instead of publishing a second one. */
  partialBatchMsgId: number | null;
}

// The composer is one instance shared by every conversation, and an upload
// outlives whichever conversation is on screen when it finishes — so the
// draft lives here, keyed by conversation, instead of in component state
// where a late callback would clear whatever conversation is open by then.

const EMPTY_DRAFT: ConversationDraft = { text: '', pendingFiles: [], attachError: null, upload: null, partialBatchMsgId: null };
const STORAGE_PREFIX = 'linkord:draft:v1:';
const PERSIST_DELAY_MS = 300;

const drafts = new Map<string, ConversationDraft>();
const listeners = new Set<() => void>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function draftKey(accountId: string, conversationId: string): string {
  return `${accountId}:${conversationId}`;
}

function readStoredText(key: string): string {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + key) ?? '';
  } catch {
    return '';
  }
}

// Only the text survives a reload: File objects can't be stored, and
// pretending the files are still attached would be a lie.
function persistText(key: string, text: string): void {
  const pending = persistTimers.get(key);
  if (pending) clearTimeout(pending);
  persistTimers.set(key, setTimeout(() => {
    persistTimers.delete(key);
    try {
      if (text) sessionStorage.setItem(STORAGE_PREFIX + key, text);
      else sessionStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      // storage full or blocked — the in-memory draft still works
    }
  }, PERSIST_DELAY_MS));
}

function getDraft(key: string): ConversationDraft {
  let draft = drafts.get(key);
  if (!draft) {
    const text = readStoredText(key);
    draft = text ? { ...EMPTY_DRAFT, text } : EMPTY_DRAFT;
    drafts.set(key, draft);
  }
  return draft;
}

function revokePreviews(files: PendingAttachment[]): void {
  for (const file of files) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}

/** The current draft, for event handlers that must not act on a stale
 * render's copy (a double submit landing in the same tick). */
export function readDraft(accountId: string, conversationId: string): ConversationDraft {
  return getDraft(draftKey(accountId, conversationId));
}

export function updateDraft(accountId: string, conversationId: string, update: (draft: ConversationDraft) => Partial<ConversationDraft>): void {
  const key = draftKey(accountId, conversationId);
  const prev = getDraft(key);
  const next = { ...prev, ...update(prev) };
  const kept = new Set(next.pendingFiles);
  revokePreviews(prev.pendingFiles.filter((file) => !kept.has(file)));
  drafts.set(key, next);
  if (next.text !== prev.text) persistText(key, next.text);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Drops every draft, in memory and in sessionStorage — on logout, so the
 * next account in this tab never sees the previous one's unsent text. */
export function clearAllDrafts(): void {
  for (const draft of drafts.values()) revokePreviews(draft.pendingFiles);
  drafts.clear();
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // nothing persisted if storage is unavailable
  }
  for (const listener of listeners) listener();
}

export function useConversationDraft(accountId: string, conversationId: string) {
  const key = draftKey(accountId, conversationId);
  const draft = useSyncExternalStore(subscribe, () => getDraft(key));
  const update = useCallback(
    (fn: (draft: ConversationDraft) => Partial<ConversationDraft>) => updateDraft(accountId, conversationId, fn),
    [accountId, conversationId],
  );
  return [draft, update] as const;
}
