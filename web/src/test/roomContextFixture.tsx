import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { Room } from 'livekit-client';
import { RoomContext } from '../state/RoomContext';
import type { RoomContextValue } from '../state/RoomContext';
import { initialRoomState } from '../state/roomReducer';

/** A default value for EVERY RoomContextValue field — almost all no-op/
 * empty, since testing one isolated component only needs the small slice
 * of context IT uses. `livekitRoom` is a real `Room` instance (the
 * constructor connects nothing by itself), not a mock. Pass `overrides`
 * with only what the component under test actually reads/calls. */
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
    activeVoiceChannelId: null,
    voiceConnection: { status: 'idle', channelId: null, mode: 'voice', joinMuted: true, error: null },
    joinVoiceChannel: asyncNoop,
    retryVoiceChannel: noop,
    cancelVoiceJoin: asyncNoop,
    startSharing: asyncNoop,
    stopSharing: noop,
    startCamera: asyncNoop,
    stopCamera: noop,
    enableMicrophone: asyncNoop,
    toggleMicMuted: asyncNoop,
    leaveVoiceChannel: asyncNoop,
    quality: 'standard',
    setQuality: noop,
    updateAvatar: noop,
    uploadAvatarFile: async () => '',
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
    categories: [],
    activeChannelId: null,
    openChannel: noop,
    messagesByChannel: new Map(),
    unreadByChannel: new Map(),
    allUsers: new Map(),
    onlineUserIds: new Set(),
    channelsError: null,
    clearChannelsError: noop,
    deleteUserAccount: noop,
    moderationError: null,
    clearModerationError: noop,
    sendChatMessage: noop,
    retryChatMessage: noop,
    discardFailedChatMessage: noop,
    deleteChatMessage: noop,
    editChatMessage: noop,
    reactToChatMessage: noop,
    createCategory: noop,
    deleteCategory: noop,
    renameCategory: noop,
    createChannel: noop,
    deleteChannel: noop,
    renameChannel: noop,
    reorderCategories: noop,
    reorderChannels: noop,
    storageUsage: { totalBytes: 0, totalFiles: 0, maxBytes: 0 },
    sendAttachment: asyncNoop,
  };
  return { ...base, ...overrides };
}

/** RTL's `render` already wrapped in a <RoomContext.Provider> — almost
 * every component calls useRoom(), so rendering without this throws. */
export function renderWithRoom(ui: ReactElement, overrides: Partial<RoomContextValue> = {}): RenderResult {
  return render(<RoomContext.Provider value={createFakeRoomContextValue(overrides)}>{ui}</RoomContext.Provider>);
}
