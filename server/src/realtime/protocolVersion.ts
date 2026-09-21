// Realtime protocol version (docs/plano-rede-social.md §12.7). Bumped when the
// wire contract changes in a way an old client cannot cope with — version 2 is
// the social model: no global user directory in `welcome`, invitations instead
// of direct member adds, scoped presence. A client that does not announce a
// compatible version is told to update, instead of half-working against a
// `welcome` it does not understand.
export const PROTOCOL_VERSION = 2;
export const MIN_PROTOCOL_VERSION = 2;

export function isClientCompatible(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= MIN_PROTOCOL_VERSION;
}
