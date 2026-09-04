import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { Room } from 'livekit-client';
import { RoomContext } from '../state/RoomContext';
import type { RoomContextValue } from '../state/RoomContext';
import { initialRoomState } from '../state/roomReducer';

/** Um valor-padrao pra CADA campo de RoomContextValue — quase tudo vira
 * no-op/vazio, ja que testar um componente isolado so precisa da fatia
 * pequena do contexto que ELE usa. `livekitRoom` e uma instancia real de
 * `Room` (o construtor nao conecta nada sozinho), nao um mock — o resto e
 * so pra satisfazer a interface sem precisar de overrides toda vez. Passe
 * `overrides` so com o que o componente sob teste realmente le/chama. */
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
    activeVoiceChannelId: null,
    joinVoiceChannel: noop,
    startSharing: asyncNoop,
    stopSharing: noop,
    startCamera: asyncNoop,
    stopCamera: noop,
    activateMic: asyncNoop,
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

/** `render` do RTL ja embrulhado num <RoomContext.Provider> — quase todo
 * componente do app chama useRoom(), entao renderizar sem isso lanca. */
export function renderWithRoom(ui: ReactElement, overrides: Partial<RoomContextValue> = {}): RenderResult {
  return render(<RoomContext.Provider value={createFakeRoomContextValue(overrides)}>{ui}</RoomContext.Provider>);
}
