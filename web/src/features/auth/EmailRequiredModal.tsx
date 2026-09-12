import { useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, Mail, LogOut } from 'lucide-react';
import { useAuth } from '../../state/AuthContext';
import { ApiError } from '../../shared/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function EmailRequiredModal() {
  const { user, linkEmail, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await linkEmail(email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível vincular o e-mail.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={Boolean(user && !user.email)} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="max-w-md bg-bg-modal">
        <DialogHeader>
          <DialogTitle>Vincule seu e-mail</DialogTitle>
          <DialogDescription>
            Para proteger sua conta e permitir a recuperação de senha, informe um e-mail.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            aria-label="E-mail"
            type="email"
            autoFocus
            autoComplete="email"
            placeholder="voce@exemplo.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {error && <p className="text-label text-red">{error}</p>}
          <Button type="submit" disabled={pending || !email}>
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
            {pending ? 'Salvando…' : 'Vincular e-mail'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void logout()}>
            <LogOut size={16} />
            Sair da conta
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
