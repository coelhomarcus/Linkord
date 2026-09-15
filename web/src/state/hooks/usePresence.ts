import { useCallback, useEffect, useRef, useState } from 'react';
import type { Participant, PublicUser, ServerMessage } from '../../types/protocol';

function mergeUserFromParticipant(prev: Map<string, PublicUser>, participant: Participant): Map<string, PublicUser> {
  const existing = prev.get(participant.userId);
  if (!existing || (
    existing.avatar === participant.avatar
    && existing.avatarColor === participant.avatarColor
    && existing.displayName === participant.displayName
    && existing.banner === participant.banner
    && existing.bio === participant.bio
    && JSON.stringify(existing.profileLinks) === JSON.stringify(participant.profileLinks)
    && existing.role === participant.role
  )) return prev;
  const next = new Map(prev);
  next.set(participant.userId, {
    ...existing, avatar: participant.avatar, avatarColor: participant.avatarColor,
    displayName: participant.displayName, banner: participant.banner, bio: participant.bio,
    profileLinks: participant.profileLinks, role: participant.role,
  });
  return next;
}

/** The room's account directory (`allUsers`, keyed by userId — distinct
 * from the reducer's own `participants` map, which is only who's actually
 * connected right now) plus who's online. `setAllUsers` is returned raw (not
 * just wrapped actions) because RoomProvider's own updateProfile still needs
 * to patch the local user's entry directly when a profile edit is applied
 * optimistically. */
export function usePresence() {
  const [allUsers, setAllUsers] = useState<Map<string, PublicUser>>(new Map());
  const allUsersRef = useRef<Map<string, PublicUser>>(new Map());
  useEffect(() => { allUsersRef.current = allUsers; }, [allUsers]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  const setInitial = useCallback((users: PublicUser[], onlineIds: string[]) => {
    setAllUsers(new Map(users.map((u) => [u.id, u])));
    setOnlineUserIds(new Set(onlineIds));
  }, []);

  const onParticipantJoined = useCallback((m: Extract<ServerMessage, { t: 'participant-joined' }>) => {
    setAllUsers((prev) => mergeUserFromParticipant(prev, m.participant));
  }, []);
  const onParticipantUpdated = useCallback((m: Extract<ServerMessage, { t: 'participant-updated' }>) => {
    setAllUsers((prev) => mergeUserFromParticipant(prev, m.participant));
  }, []);
  const onUserOnline = useCallback((m: Extract<ServerMessage, { t: 'user-online' }>) => {
    setOnlineUserIds((prev) => (prev.has(m.userId) ? prev : new Set(prev).add(m.userId)));
  }, []);
  const onUserOffline = useCallback((m: Extract<ServerMessage, { t: 'user-offline' }>) => {
    setOnlineUserIds((prev) => {
      if (!prev.has(m.userId)) return prev;
      const next = new Set(prev);
      next.delete(m.userId);
      return next;
    });
  }, []);
  const onUserRegistered = useCallback((m: Extract<ServerMessage, { t: 'user-registered' }>) => {
    setAllUsers((prev) => new Map(prev).set(m.user.id, m.user));
  }, []);
  const onUserDeleted = useCallback((m: Extract<ServerMessage, { t: 'user-deleted' }>) => {
    setAllUsers((prev) => {
      if (!prev.has(m.userId)) return prev;
      const next = new Map(prev);
      next.delete(m.userId);
      return next;
    });
    setOnlineUserIds((prev) => {
      if (!prev.has(m.userId)) return prev;
      const next = new Set(prev);
      next.delete(m.userId);
      return next;
    });
  }, []);

  return {
    allUsers, allUsersRef, setAllUsers, onlineUserIds, setInitial,
    onParticipantJoined, onParticipantUpdated, onUserOnline, onUserOffline, onUserRegistered, onUserDeleted,
  };
}
