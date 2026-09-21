import { useState } from 'react';
import { UsersRound } from 'lucide-react';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Label } from '@/shared/ui/primitives/label';
import { ApiError, createGroup } from '@/shared/api/api';
import type { InviteResult, SocialUser } from '@/shared/api/api';
import { FriendPicker } from './FriendPicker';
import { describeInviteOutcome } from './inviteOutcome';
import { ERROR_CODES } from '@/shared/api/errorCodes';

interface GroupCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function GroupCreateDialog({ open, onOpenChange, onCreated }: GroupCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Map<string, SocialUser>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // set once the group exists but some invitations didn't go out — the
  // dialog stays open to say which, instead of swallowing it
  const [failures, setFailures] = useState<{ user: SocialUser; text: string }[] | null>(null);

  function toggle(user: SocialUser) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });
  }

  function reset() {
    setTitle('');
    setSelected(new Map());
    setError(null);
    setFailures(null);
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  async function handleSubmit() {
    const name = title.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { results } = await createGroup(name, [...selected.keys()]);
      const failed = results
        .filter((r: InviteResult) => r.outcome !== 'sent')
        .flatMap((r) => {
          const user = selected.get(r.userId);
          return user ? [{ user, text: describeInviteOutcome(r.outcome) }] : [];
        });
      onCreated?.();
      if (failed.length === 0) close();
      else setFailures(failed);
    } catch (err) {
      setError(err instanceof ApiError && err.code === ERROR_CODES.quota_exceeded ? err.message : 'Não foi possível criar o grupo. Tente de novo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-w-lg border-white/10 bg-[rgb(18_18_20)] p-0 text-text-primary">
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-title">
            <UsersRound size={18} />
            {failures ? 'Grupo criado' : 'Novo grupo'}
          </DialogTitle>
        </DialogHeader>
        {failures ? (
          <div className="flex flex-col gap-2 px-5 py-4">
            <p className="text-label text-text-secondary">O grupo foi criado, mas alguns convites não foram enviados:</p>
            <ul className="flex flex-col gap-1 text-label text-text-muted">
              {failures.map(({ user, text }) => (
                <li key={user.id}><span className="font-medium text-text-secondary">{user.displayName}</span> — {text}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="group-title" className="text-label text-text-muted">Nome</Label>
              <Input
                id="group-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={80}
                placeholder="Ex: Produto, familia, squad"
                className="border-white/10 bg-white/[0.04]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="group-users" className="text-label text-text-muted">Convidar amigos</Label>
              <p className="text-caption text-text-muted">Seus amigos receberão um convite e só entram no grupo ao aceitar.</p>
              <FriendPicker selected={selected} onToggle={toggle} inputId="group-users" />
            </div>
            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>
        )}
        <DialogFooter className="border-t border-white/10 px-5 py-4">
          {failures ? (
            <Button type="button" onClick={close}>Fechar</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={close}>Cancelar</Button>
              <Button type="button" onClick={() => void handleSubmit()} disabled={!title.trim() || submitting}>
                {submitting ? 'Criando…' : selected.size > 0 ? `Criar e convidar (${selected.size})` : 'Criar grupo'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
