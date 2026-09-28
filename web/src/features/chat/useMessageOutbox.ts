import { useCallback, useEffect, useRef, useState } from 'react';
import { discardStagedFile, stageFileInChunks, type StagedFile } from '@/shared/lib/chunkedUpload';
import { compressImageFile } from '@/shared/lib/compressImageFile';
import type { ChatMessage, ChatReplyRef, ClientMessage, ServerMessage } from '@/shared/types/protocol';
import { markArrival } from './arrivals';

/** `uploading`: files still being staged; the message itself waits. */
export type OutboxState = 'uploading' | 'sending' | 'unknown' | 'failed';

export interface OutboxAttachment {
  localId: string;
  name: string;
  mime: string;
  size: number;
  previewUrl: string | null;
  /** 0..1 of the bytes; 1 once the server has the file staged */
  progress: number;
  failed: boolean;
}

export interface OutboxEntry {
  clientMessageId: string;
  conversationId: string;
  text: string;
  replyTo?: ChatReplyRef;
  createdAt: number;
  state: OutboxState;
  error?: string;
  attachments?: OutboxAttachment[];
}

// No answer in this long and the send is "unknown": it may or may not have
// been stored. Resending with the same key is safe (the server is idempotent
// per key), so that's what happens, a few times, before asking the user.
const RESULT_TIMEOUT_MS = 10_000;
const MAX_AUTO_ATTEMPTS = 3;
// Files staged at once across every pending batch — big uploads in parallel
// only split the same bandwidth and multiply memory.
const MAX_CONCURRENT_FILES = 2;
// Previews stay alive a moment after confirmation so the row doesn't blink
// while the server's copies load.
const PREVIEW_RELEASE_DELAY_MS = 10_000;

interface TrackedFile {
  file: File;
  compress: boolean;
  stagedId?: string;
  abort?: AbortController;
}

interface Tracking {
  entry: OutboxEntry;
  replyToMsgId?: number;
  files: Map<string, TrackedFile>;
  attempts: number;
  requestId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface OutboxDeps {
  sendWs: (msg: ClientMessage) => boolean;
  onConfirmed: (message: ChatMessage) => void;
  stageFile?: typeof stageFileInChunks;
  discardStaged?: (id: string) => void;
  compress?: (file: File) => Promise<File>;
}

/** Messages the user sent that the server hasn't confirmed yet. One send in
 * flight per conversation, so your own messages are stored in the order you
 * wrote them — a batch still uploading holds back what was written after it. */
export function useMessageOutbox({ sendWs, onConfirmed, stageFile = stageFileInChunks, discardStaged = discardStagedFile, compress = compressImageFile }: OutboxDeps) {
  // insertion order is submission order; the ref is the source of truth so
  // socket callbacks never act on a stale render's copy
  const trackingRef = useRef(new Map<string, Tracking>());
  const [pendingByConversation, setPendingByConversation] = useState<Map<string, OutboxEntry[]>>(new Map());
  const onConfirmedRef = useRef(onConfirmed);
  useEffect(() => { onConfirmedRef.current = onConfirmed; }, [onConfirmed]);
  const activeFilesRef = useRef(0);
  const fileQueueRef = useRef<(() => void)[]>([]);

  const publish = useCallback(() => {
    const next = new Map<string, OutboxEntry[]>();
    for (const { entry } of trackingRef.current.values()) {
      const list = next.get(entry.conversationId);
      if (list) list.push(entry); else next.set(entry.conversationId, [entry]);
    }
    setPendingByConversation(next);
  }, []);

  const update = useCallback((clientMessageId: string, patch: Partial<OutboxEntry>) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (tracked) tracked.entry = { ...tracked.entry, ...patch };
  }, []);

  const updateAttachment = useCallback((clientMessageId: string, localId: string, patch: Partial<OutboxAttachment>) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (!tracked?.entry.attachments) return;
    tracked.entry = { ...tracked.entry, attachments: tracked.entry.attachments.map((a) => (a.localId === localId ? { ...a, ...patch } : a)) };
  }, []);

  const clearTimer = (tracked: Tracking) => {
    if (tracked.timer) clearTimeout(tracked.timer);
    tracked.timer = null;
  };

  const releasePreviews = (entry: OutboxEntry, delayMs: number) => {
    const urls = (entry.attachments ?? []).flatMap((a) => (a.previewUrl ? [a.previewUrl] : []));
    if (!urls.length) return;
    const revoke = () => urls.forEach((url) => URL.revokeObjectURL(url));
    if (delayMs > 0) setTimeout(revoke, delayMs); else revoke();
  };

  const pumpRef = useRef<(conversationId: string) => void>(() => {});

  const transmit = useCallback((tracked: Tracking) => {
    const { entry } = tracked;
    tracked.requestId = crypto.randomUUID();
    tracked.attempts += 1;
    const attachmentIds = (entry.attachments ?? []).map((a) => tracked.files.get(a.localId)!.stagedId!);
    const sent = sendWs({
      t: 'chat', conversationId: entry.conversationId, text: entry.text,
      ...(tracked.replyToMsgId ? { replyTo: tracked.replyToMsgId } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      requestId: tracked.requestId, clientMessageId: entry.clientMessageId,
    });
    // offline: it waits for the next welcome instead of counting as a try
    if (!sent) { tracked.requestId = null; tracked.attempts -= 1; return; }
    tracked.timer = setTimeout(() => {
      tracked.timer = null;
      tracked.requestId = null;
      if (tracked.attempts >= MAX_AUTO_ATTEMPTS) {
        update(entry.clientMessageId, { state: 'failed', error: 'Não foi possível confirmar o envio.' });
      } else {
        update(entry.clientMessageId, { state: 'unknown' });
      }
      publish();
      pumpRef.current(entry.conversationId);
    }, RESULT_TIMEOUT_MS);
  }, [sendWs, update, publish]);

  const pump = useCallback((conversationId: string) => {
    let head: Tracking | null = null;
    for (const tracked of trackingRef.current.values()) {
      if (tracked.entry.conversationId !== conversationId || tracked.entry.state === 'failed') continue;
      if (tracked.requestId) return; // one in flight per conversation
      head ??= tracked;
    }
    if (head && head.entry.state !== 'uploading') transmit(head);
  }, [transmit]);
  useEffect(() => { pumpRef.current = pump; }, [pump]);

  const withFileSlot = useCallback(<T,>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const run = () => {
      activeFilesRef.current += 1;
      task().then(resolve, reject).finally(() => {
        activeFilesRef.current -= 1;
        fileQueueRef.current.shift()?.();
      });
    };
    if (activeFilesRef.current < MAX_CONCURRENT_FILES) run(); else fileQueueRef.current.push(run);
  }), []);

  /** Stages every file of the batch not staged yet; when the last one lands,
   * the message joins the send queue. */
  const stageMissing = useCallback((clientMessageId: string) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (!tracked?.entry.attachments) return;
    const { conversationId } = tracked.entry;
    const missing = tracked.entry.attachments.filter((a) => !tracked.files.get(a.localId)!.stagedId);
    let failures = 0;
    let remaining = missing.length;
    const finishOne = () => {
      remaining -= 1;
      if (remaining > 0 || !trackingRef.current.has(clientMessageId)) return;
      if (failures) {
        update(clientMessageId, { state: 'failed', error: failures === 1 ? 'Um anexo não foi enviado.' : `${failures} anexos não foram enviados.` });
      } else {
        update(clientMessageId, { state: 'sending' });
      }
      publish();
      pumpRef.current(conversationId);
    };
    for (const attachment of missing) {
      const trackedFile = tracked.files.get(attachment.localId)!;
      const abort = new AbortController();
      trackedFile.abort = abort;
      updateAttachment(clientMessageId, attachment.localId, { failed: false, progress: 0 });
      void withFileSlot(async (): Promise<StagedFile> => {
        if (abort.signal.aborted) throw abort.signal.reason;
        const file = trackedFile.compress && trackedFile.file.type.startsWith('image/')
          ? await compress(trackedFile.file).catch(() => trackedFile.file)
          : trackedFile.file;
        return stageFile({
          conversationId, file, signal: abort.signal,
          onProgress: (fraction) => { updateAttachment(clientMessageId, attachment.localId, { progress: Math.min(fraction, 0.99) }); publish(); },
        });
      }).then((staged) => {
        if (!trackingRef.current.has(clientMessageId)) { discardStaged(staged.id); return; }
        trackedFile.stagedId = staged.id;
        updateAttachment(clientMessageId, attachment.localId, { progress: 1 });
      }, () => {
        if (abort.signal.aborted) return;
        failures += 1;
        updateAttachment(clientMessageId, attachment.localId, { failed: true });
      }).finally(() => {
        trackedFile.abort = undefined;
        finishOne();
      });
    }
    publish();
  }, [compress, discardStaged, publish, stageFile, update, updateAttachment, withFileSlot]);

  const enqueue = useCallback((conversationId: string, text: string, replyTo?: ChatReplyRef, files: { file: File; compress: boolean }[] = []) => {
    const clientMessageId = crypto.randomUUID();
    const tracked: Tracking = {
      entry: { clientMessageId, conversationId, text, replyTo, createdAt: Date.now(), state: files.length ? 'uploading' : 'sending' },
      replyToMsgId: replyTo?.msgId,
      files: new Map(),
      attempts: 0,
      requestId: null,
      timer: null,
    };
    if (files.length) {
      tracked.entry.attachments = files.map(({ file, compress: shouldCompress }) => {
        const localId = crypto.randomUUID();
        tracked.files.set(localId, { file, compress: shouldCompress });
        return {
          localId, name: file.name, mime: file.type || 'application/octet-stream', size: file.size,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
          progress: 0, failed: false,
        };
      });
    }
    trackingRef.current.set(clientMessageId, tracked);
    // the stored copy keeps this key, so confirming it won't enter again
    markArrival(`c:${clientMessageId}`);
    publish();
    if (files.length) stageMissing(clientMessageId); else pump(conversationId);
    return clientMessageId;
  }, [publish, pump, stageMissing]);

  const settle = useCallback((clientMessageId: string, message: ChatMessage | null, error?: { code: string; message: string }) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (!tracked) return;
    clearTimer(tracked);
    tracked.requestId = null;
    if (message) {
      trackingRef.current.delete(clientMessageId);
      releasePreviews(tracked.entry, PREVIEW_RELEASE_DELAY_MS);
      onConfirmedRef.current(message);
    } else {
      // expired or otherwise gone on the server: the files are still here,
      // so a retry uploads them again instead of asking to pick them anew
      if (error?.code === 'attachments_unavailable') for (const file of tracked.files.values()) file.stagedId = undefined;
      update(clientMessageId, { state: 'failed', error: error?.message });
    }
    publish();
    pump(tracked.entry.conversationId);
  }, [publish, pump, update]);

  const onChatSendResult = useCallback((m: Extract<ServerMessage, { t: 'chat-send-result' }>) => {
    // an answer to an attempt we already gave up on still settles the intent
    if (!trackingRef.current.has(m.clientMessageId)) return;
    if (m.message) settle(m.clientMessageId, m.message);
    else if (m.error) settle(m.clientMessageId, null, m.error);
  }, [settle]);

  /** The broadcast of one of our own sends can beat its result. */
  const onEcho = useCallback((message: ChatMessage) => {
    if (message.clientMessageId && trackingRef.current.has(message.clientMessageId)) settle(message.clientMessageId, message);
  }, [settle]);

  /** A (re)join: whatever was in flight on the old socket is resent with
   * its same key — the server answers a duplicate with the original. */
  const onReconnected = useCallback(() => {
    const conversations = new Set<string>();
    for (const tracked of trackingRef.current.values()) {
      clearTimer(tracked);
      tracked.requestId = null;
      conversations.add(tracked.entry.conversationId);
    }
    for (const id of conversations) pump(id);
  }, [pump]);

  const retry = useCallback((clientMessageId: string) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (!tracked || tracked.entry.state !== 'failed') return;
    tracked.attempts = 0;
    const needsUpload = [...tracked.files.values()].some((file) => !file.stagedId);
    update(clientMessageId, { state: needsUpload ? 'uploading' : 'sending', error: undefined });
    publish();
    if (needsUpload) stageMissing(clientMessageId); else pump(tracked.entry.conversationId);
  }, [publish, pump, stageMissing, update]);

  const discard = useCallback((clientMessageId: string) => {
    const tracked = trackingRef.current.get(clientMessageId);
    if (!tracked) return;
    clearTimer(tracked);
    trackingRef.current.delete(clientMessageId);
    for (const file of tracked.files.values()) {
      file.abort?.abort();
      if (file.stagedId) discardStaged(file.stagedId);
    }
    releasePreviews(tracked.entry, 0);
    publish();
    pump(tracked.entry.conversationId);
  }, [discardStaged, publish, pump]);

  useEffect(() => () => {
    for (const tracked of trackingRef.current.values()) clearTimer(tracked);
  }, []);

  return { pendingByConversation, enqueue, onChatSendResult, onEcho, onReconnected, retry, discard };
}
