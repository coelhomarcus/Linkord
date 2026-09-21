import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { loadIdentity } from '@/shared/lib/identitySession';
import { PROTOCOL_VERSION } from '@/shared/types/protocol';
import type { ClientMessage, ServerMessage } from '@/shared/types/protocol';
import type { RoomAction } from '@/state/roomReducer';

interface SocketConnectionDeps {
  socketRef: MutableRefObject<Socket | null>;
  intentionalCloseRef: MutableRefObject<boolean>;
  sendWs: (msg: ClientMessage) => void;
  dispatch: Dispatch<RoomAction>;
  refreshAuth: () => Promise<void>;
  onMessage: (m: ServerMessage) => void;
}

/** The websocket transport itself — connect on mount, join with whatever
 * identity is saved locally, route every incoming message to `onMessage`,
 * flag reconnecting on an unintentional drop. Doesn't know about any
 * domain hook; `onMessage` is kept in a ref so passing a new function
 * identity every render (RoomProvider's message router depends on nearly
 * every other hook, so it's never stable) doesn't tear down and reconnect
 * the socket. `socketRef`/`intentionalCloseRef` are owned by the caller,
 * not this hook: `sendWs` (RoomProvider) reads `socketRef` directly and is
 * constructed before this hook runs, since nearly every domain hook needs
 * `sendWs` too; `intentionalCloseRef` is flipped by RoomProvider's own
 * `disconnectIntentionally` for the server's `full` error, so the
 * `disconnect` handler below doesn't flag that as a drop. */
export function useSocketConnection(deps: SocketConnectionDeps) {
  const { socketRef, intentionalCloseRef, sendWs, dispatch, refreshAuth, onMessage } = deps;

  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  useEffect(() => {
    intentionalCloseRef.current = false;
    const socket = io(location.origin, { path: '/ws', transports: ['websocket'], withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      const saved = loadIdentity();
      sendWs({ t: 'join', id: saved?.id, token: saved?.token, v: PROTOCOL_VERSION });
    });

    socket.onAny((_eventName: string, payload: ServerMessage) => onMessageRef.current(payload));

    socket.on('disconnect', () => {
      if (intentionalCloseRef.current) return;
      dispatch({ type: 'SET_RECONNECTING', value: true });
    });

    socket.on('connect_error', () => {
      if (!socket.active) refreshAuth();
    });

    return () => {
      intentionalCloseRef.current = true;
      socketRef.current?.disconnect();
    };
  }, [socketRef, intentionalCloseRef, sendWs, dispatch, refreshAuth]);
}
