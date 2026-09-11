import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { Room } from 'livekit-client';
import { RoomContext } from '../state/RoomContext';
import type { RoomContextValue } from '../state/RoomContext';
import { initialRoomState } from '../state/roomReducer';

export function createFakeRoomContextValue(overrides: Partial<RoomContextValue> = {}): RoomContextValue {
  const noop = () => {};
  const asyncNoop = async () => {};
  const base: RoomContextValue = {
    state: initialRoomState,
    dispatch: noop,
    sendWs: noop,
    tileDomRegistry: { current: new Map() },
    audioRegistry: { current: new Map() },
    audioUnlocked: false,
    deafened: false,
    toggleDeafened: noop,
    livekitRoom: new Room(),
    notifyActiveView: noop,
    registerRequestChatView: noop,
    requestChatView: noop,
    activeCallConversationId: null,
    joinCall: noop,
    leaveCall: asyncNoop,
    startSharing: asyncNoop,
    stopSharing: noop,
    startCamera: asyncNoop,
    stopCamera: noop,
    activateMic: asyncNoop,
    toggleMicMuted: asyncNoop,
    updateAvatar: noop,
    updateProfile: noop,
    uploadProfileImage: async () => '',
    menuTarget: null,
    openTileMenu: noop,
    closeTileMenu: () => false,
    reactions: [],
    sendReaction: noop,
    showStats: false,
    setShowStats: noop,
    notifyVolume: 0.65,
    setNotifyVolume: noop,
    notificationsEnabled: false,
    setNotificationsEnabled: noop,
    hideAudioOnlyTiles: false,
    setHideAudioOnlyTiles: noop,
    conversations: [],
    activeConversationId: null,
    openConversation: noop,
    openDirect: noop,
    closeConversation: noop,
    pinConversation: noop,
    createGroup: noop,
    deleteGroup: noop,
    updateGroupTitle: noop,
    updateGroupAvatar: noop,
    addGroupMembers: noop,
    removeGroupMember: noop,
    messagesByConversation: new Map(),
    hasMoreByConversation: new Map(),
    loadingOlderByConversation: new Set(),
    unreadByConversation: new Map(),
    loadOlderMessages: noop,
    allUsers: new Map(),
    onlineUserIds: new Set(),
    deleteUserAccount: noop,
    kickFromCall: noop,
    moderationError: null,
    clearModerationError: noop,
    sendChatMessage: noop,
    deleteChatMessage: noop,
    editChatMessage: noop,
    reactToChatMessage: noop,
    replyingTo: null,
    setReplyingTo: noop,
    editingMsgId: null,
    setEditingMsgId: noop,
    hasMoreAfterByConversation: new Map(),
    pendingJumpTarget: null,
    clearPendingJumpTarget: noop,
    jumpToMessage: noop,
    searchResults: [],
    searchLoading: false,
    searchError: null,
    clearSearchError: noop,
    searchMessages: noop,
    storageUsage: { totalBytes: 0, totalFiles: 0, maxBytes: 0 },
    sendAttachments: asyncNoop,
  };
  return { ...base, ...overrides };
}

export function renderWithRoom(ui: ReactElement, overrides: Partial<RoomContextValue> = {}): RenderResult {
  return render(<RoomContext.Provider value={createFakeRoomContextValue(overrides)}>{ui}</RoomContext.Provider>);
}
