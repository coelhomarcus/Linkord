import { useCallback, useEffect, useRef } from 'react';
import type { ClientMessage, ServerMessage } from '@/shared/types/protocol';

type ActionMessage = Extract<ClientMessage, { t: 'chat-edit' } | { t: 'chat-delete' }>;

// Edits and deletes are idempotent on the server (same text; already gone
// counts as done), so a lost answer only costs the user a retry click.
const RESULT_TIMEOUT_MS = 10_000;

export class MessageActionError extends Error {}

/** chat-edit/chat-delete as promises settled by the server's
 * chat-action-result — so the UI can keep an editor open on failure
 * instead of assuming success. */
export function useMessageActionRequests(sendWs: (msg: ClientMessage) => boolean) {
  const pendingRef = useRef(new Map<string, { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>());

  const request = useCallback((msg: ActionMessage): Promise<void> => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    if (!sendWs({ ...msg, requestId })) {
      reject(new MessageActionError('Sem conexão com o servidor. Tente de novo quando reconectar.'));
      return;
    }
    const timer = setTimeout(() => {
      pendingRef.current.delete(requestId);
      reject(new MessageActionError('O servidor não respondeu. Tente de novo.'));
    }, RESULT_TIMEOUT_MS);
    pendingRef.current.set(requestId, { resolve, reject, timer });
  }), [sendWs]);

  const onChatActionResult = useCallback((m: Extract<ServerMessage, { t: 'chat-action-result' }>) => {
    const pending = pendingRef.current.get(m.requestId);
    if (!pending) return;
    pendingRef.current.delete(m.requestId);
    clearTimeout(pending.timer);
    if (m.error) pending.reject(new MessageActionError(m.error.message)); else pending.resolve();
  }, []);

  useEffect(() => () => {
    for (const pending of pendingRef.current.values()) clearTimeout(pending.timer);
  }, []);

  return { request, onChatActionResult };
}
