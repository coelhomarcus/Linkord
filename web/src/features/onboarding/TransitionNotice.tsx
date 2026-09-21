import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '@/shared/ui/primitives/button';
import { rememberTransitionNoticeDismissed, wasTransitionNoticeDismissed } from './transitionNoticeStorage';

/** One-time, in-product explanation of the social model for accounts that
 * predate it (docs/plano-rede-social.md §12): who can create groups, how one
 * joins, where friends live, and what happened to old DMs. It sends nothing to
 * anyone and starts no friend request — the only action is a link to Amigos. */
export function TransitionNotice({ onOpenFriends }: { onOpenFriends: () => void }) {
  const [visible, setVisible] = useState(() => !wasTransitionNoticeDismissed());
  if (!visible) return null;

  function dismiss() {
    rememberTransitionNoticeDismissed();
    setVisible(false);
  }

  return (
    <section aria-label="Novidades" className="mb-2 rounded-xl border border-primary/30 bg-primary/[0.08] p-3">
      <div className="flex items-start gap-2">
        <Sparkles size={15} className="mt-0.5 flex-none text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-label font-semibold text-text-primary">O Linkord mudou</h2>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-caption text-text-secondary">
            <li>Qualquer pessoa pode criar grupos e gerenciar os próprios.</li>
            <li>Ninguém é colocado num grupo: você entra ao aceitar um convite.</li>
            <li>Amigos e solicitações ficam em <strong className="font-medium text-text-primary">Amigos</strong> e <strong className="font-medium text-text-primary">Solicitações</strong>.</li>
            <li>Conversas antigas continuam aqui para ler; para escrever numa DM, vocês precisam ser amigos.</li>
          </ul>
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" size="xs" onClick={() => { onOpenFriends(); dismiss(); }}>Ver amigos</Button>
            <Button type="button" size="xs" variant="ghost" onClick={dismiss}>Entendi</Button>
          </div>
        </div>
        <button type="button" aria-label="Dispensar aviso" onClick={dismiss} className="grid size-6 flex-none place-items-center rounded-full text-text-muted hover:bg-white/10 hover:text-text-primary">
          <X size={13} />
        </button>
      </div>
    </section>
  );
}
