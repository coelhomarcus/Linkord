import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/state/AuthContext';
import { Label } from '@/shared/ui/primitives/label';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { ApiError, confirmEmailChange, requestEmailChange } from '@/shared/api/api';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';

export function EmailSettings({ currentEmail }: { currentEmail: string | null }) {
  const { refresh } = useAuth();
  const [email, setEmail] = useState(currentEmail ?? '');
  const [code, setCode] = useState('');
  const [requested, setRequested] = useState(false);
  const [status, setStatus] = useState<OTPStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setEmail(currentEmail ?? '');
    setCode('');
    setRequested(false);
    setStatus('idle');
    setError(null);
  }, [currentEmail]);

  async function handleRequest() {
    setError(null);
    setPending(true);
    try {
      await requestEmailChange(email);
      setRequested(true);
      setStatus('idle');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar o código.');
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm(nextCode = code) {
    if (nextCode.length !== 6 || pending) return;
    setError(null);
    setStatus('idle');
    setPending(true);
    try {
      await confirmEmailChange(email, nextCode);
      setStatus('success');
      await refresh();
    } catch (err) {
      setStatus('error');
      setError(err instanceof ApiError ? err.message : 'Não foi possível confirmar o e-mail.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!requested ? (
        <>
          <p className="text-label text-text-muted">Usado para recuperar sua conta. A alteração será confirmada por código.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Label htmlFor="accountEmail" className="text-label text-text-muted">Novo e-mail</Label>
              <Input id="accountEmail" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <Button type="button" size="sm" disabled={pending || !email} onClick={() => void handleRequest()}>
              {pending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
              {pending ? 'Enviando…' : 'Enviar código'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-label text-text-muted">Digite o código enviado para {email}. Ele expira em 30 minutos.</p>
          <OTPInput
            label="Código de confirmação"
            hint="Digite os 6 dígitos enviados para seu e-mail."
            errorMessage={error ?? 'Confira o código e tente novamente.'}
            successMessage="E-mail alterado com sucesso."
            value={code}
            status={status}
            onChange={(value) => { setCode(value); setStatus('idle'); setError(null); }}
            onComplete={(value) => { void handleConfirm(value); }}
            aria-label="Código de confirmação de e-mail"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || code.length !== 6} onClick={() => void handleConfirm()}>
              {pending ? <Loader2 size={15} className="animate-spin" /> : status === 'success' ? <CheckCircle2 size={15} /> : <Check size={15} />}
              {pending ? 'Confirmando…' : status === 'success' ? 'Confirmado' : 'Confirmar e-mail'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setRequested(false); setStatus('idle'); setError(null); }}>Usar outro e-mail</Button>
          </div>
        </>
      )}
      {error && !requested && <p className="text-label text-red">{error}</p>}
    </div>
  );
}
