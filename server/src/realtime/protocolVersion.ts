// Realtime protocol version (docs/plano-rede-social.md §12.7). Bumped when the
// wire contract changes in a way an old client cannot cope with. A client
// that does not announce a compatible version is told to update, instead of
// half-working against a `welcome` (or a `chat`/`chat-edit`/`chat-react`
// dispatch) it does not understand.
//
// 5 is the messages redesign's wire contract: `chat` requires a
// `clientMessageId` and is always answered with `chat-send-result`;
// `chat-edit`/`chat-delete`/`chat-react` require a `requestId` and are
// always answered with `chat-action-result`; `chat-react` sets a desired
// `present` state instead of toggling; attachment uploads are always staged,
// published only through a correlated `chat` carrying `attachmentIds`. None
// of that has a fallback anymore — MIN_PROTOCOL_VERSION enforces it at join.
export const PROTOCOL_VERSION = 5;
export const MIN_PROTOCOL_VERSION = 5;

export function isClientCompatible(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= MIN_PROTOCOL_VERSION;
}
