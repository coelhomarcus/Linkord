import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { Loader2, UserPlus } from 'lucide-react';
import { sendFriendRequest } from '@/shared/api/api';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { friendsSection } from '@/shared/lib/routes';
import { describeOutcome, describeSendError, normalizeUsernameInput } from './friendsText';

type Result = { text: string; tone: 'success' | 'info' | 'error'; linkToRequests?: boolean };

/** Discovery is by EXACT @username only — no catalog, no partial search
 * (docs/plano-rede-social.md §3): nothing here ever lists accounts. */
export function AddFriendForm({ onSent, autoFocus }: { onSent: () => void; autoFocus?: boolean }) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const username = normalizeUsernameInput(value);
    if (!username || pending) return;
    setPending(true);
    setResult(null);
    try {
      const outcome = await sendFriendRequest(username);
      setResult({ ...describeOutcome(outcome, username), linkToRequests: outcome === 'pending_received' });
      if (outcome === 'created') setValue('');
      onSent();
    } catch (err) {
      setResult({ text: describeSendError(err), tone: 'error' });
    } finally {
      setPending(false);
    }
  }

  const toneClass = result?.tone === 'error' ? 'text-red' : result?.tone === 'success' ? 'text-green' : 'text-text-muted';

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-2">
      <label htmlFor="add-friend-username" className="text-body font-medium text-text-primary">Adicionar amigo</label>
      <p className="text-label text-text-muted">Digite o @nome de usuário exato da pessoa.</p>
      <div className="flex gap-2">
        <Input
          id="add-friend-username"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="@nomedeusuario"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={autoFocus}
          maxLength={40}
        />
        <Button type="submit" disabled={pending || !normalizeUsernameInput(value)} className="flex-none">
          {pending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          <span>Enviar</span>
        </Button>
      </div>
      {result && (
        <p role="status" className={`text-label ${toneClass}`}>
          {result.text}
          {result.linkToRequests && <> <Link to={friendsSection('received')} className="underline underline-offset-2">Ver solicitação recebida</Link></>}
        </p>
      )}
    </form>
  );
}
