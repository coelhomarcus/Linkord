import { ConfirmDialog } from '@/shared/ConfirmDialog';

export type SocialConfirm = { kind: 'remove' | 'block'; userId: string; displayName: string };

/** The two destructive social actions, worded once so the friends list and a
 * profile never explain "block" differently (docs/plano-rede-social.md §5.7:
 * say concretely what it does). Accepting a request is deliberately NOT here
 * — trivial confirmations are noise (§5.8). */
export function SocialConfirmDialog({ target, onCancel, onConfirm }: {
  target: SocialConfirm | null;
  onCancel: () => void;
  onConfirm: (target: SocialConfirm) => void;
}) {
  const isBlock = target?.kind === 'block';
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title={isBlock ? 'Bloquear pessoa' : 'Remover amizade'}
      description={
        isBlock
          ? `Bloquear ${target?.displayName ?? ''} remove a amizade e impede mensagens e chamadas privadas entre vocês. Grupos em comum continuam. Desbloquear depois não restaura a amizade.`
          : `Remover ${target?.displayName ?? ''} dos seus amigos? Vocês ainda podem ver o histórico da conversa, mas não conseguem mais trocar mensagens até serem amigos de novo.`
      }
      confirmLabel={isBlock ? 'Bloquear' : 'Remover'}
      destructive
      onConfirm={() => { if (target) onConfirm(target); }}
    />
  );
}
