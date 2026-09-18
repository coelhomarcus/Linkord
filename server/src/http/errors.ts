// Stable error codes — start of the "contratos de erros estáveis" from
// docs/plano-rede-social.md §8.2. Only the codes with a real caller today;
// the rest of that section's list (rate_limited, group_full,
// invitation_expired, relationship_required) waits for the etapas that
// actually need them, not added speculatively.

export const ERROR_CODES = {
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
