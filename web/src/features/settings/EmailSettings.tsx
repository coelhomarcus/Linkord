import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/state/AuthContext';
import { Label } from '@/shared/ui/primitives/label';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { ApiError, confirmEmailChange, requestEmailChange } from '@/shared/api/api';
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// RFC 5321's own limit — just enough to keep the input from growing forever,
// the server is still the real authority on what's a valid address.
const MAX_EMAIL_LEN = 254;

type Phase = 'view' | 'edit' | 'requested' | 'success';

function validateNewEmail(value: string, currentEmail: string | null): string | null {
  if (!value) return 'Informe um e-mail.';
  if (!EMAIL_RE.test(value)) return 'Informe um e-mail válido.';
  if (currentEmail && value.toLowerCase() === currentEmail.toLowerCase()) return 'Informe um e-mail diferente do atual.';
  return null;
}

export function EmailSettings({ currentEmail }: { currentEmail: string | null }) {
  const { refresh } = useAuth();
  // `view` reads `currentEmail` straight from the prop, so a phase reset
  // effect keyed on it isn't needed — and isn't safe to have anyway:
  // confirming triggers refresh() right after showing `success`, which
  // changes `currentEmail` the very next render, and that used to wipe the
  // success message before anyone could read it (caught only in the
  // browser, not by a test — nothing here exercises AuthContext for real).
  const [phase, setPhase] = useState<Phase>('view');
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  // Frozen the moment a code is requested — editing again means starting a
  // fresh request, never silently confirming a different address than the
  // one the code was actually sent to.
  const [targetEmail, setTargetEmail] = useState('');
  const [code, setCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<OTPStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);
  // `pending` alone isn't enough to stop onComplete (typing the 6th digit)
  // and the "Confirmar e-mail" click from both firing handleConfirm in the
  // same tick, before the setPending(true) render has committed.
  const confirmingRef = useRef(false);

  useEffect(() => {
    if (phase !== 'success') return;
    const timeout = window.setTimeout(() => setPhase('view'), 2500);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  useEffect(() => {
    if (!resent) return;
    const timeout = window.setTimeout(() => setResent(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [resent]);

  function startEdit() {
    setEmail(currentEmail ?? '');
    setValidationError(null);
    setError(null);
    setPhase('edit');
  }

  async function handleRequest() {
    const trimmed = email.trim();
    const invalid = validateNewEmail(trimmed, currentEmail);
    if (invalid) { setValidationError(invalid); return; }
    setValidationError(null);
    setError(null);
    setPending(true);
    try {
      await requestEmailChange(trimmed);
      setTargetEmail(trimmed);
      setCode('');
      setOtpStatus('idle');
      setPhase('requested');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar o código.');
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    setError(null);
    setPending(true);
    try {
      await requestEmailChange(targetEmail);
      setResent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível reenviar o código.');
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm(nextCode = code) {
    if (nextCode.length !== 6 || confirmingRef.current) return;
    confirmingRef.current = true;
    setError(null);
    setOtpStatus('idle');
    setPending(true);
    try {
      await confirmEmailChange(targetEmail, nextCode);
      setOtpStatus('success');
      setPhase('success');
      await refresh();
    } catch (err) {
      setOtpStatus('error');
      setError(err instanceof ApiError ? err.message : 'Não foi possível confirmar o e-mail.');
    } finally {
      setPending(false);
      confirmingRef.current = false;
    }
  }

  if (phase === 'success') {
    return (
      <p className="flex items-center gap-1.5 text-label text-green">
        <CheckCircle2 size={15} aria-hidden /> E-mail alterado para {targetEmail}.
      </p>
    );
  }

  if (phase === 'view') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-all text-body text-text-primary">{currentEmail ?? 'Nenhum e-mail cadastrado.'}</span>
        <Button type="button" variant="secondary" size="sm" onClick={startEdit}>
          <span>Alterar e-mail</span>
        </Button>
      </div>
    );
  }

  if (phase === 'edit') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-label text-text-muted">Usado para recuperar sua conta. A alteração será confirmada por código.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="accountEmail" className="text-label text-text-muted">Novo e-mail</Label>
            <Input
              id="accountEmail"
              type="email"
              autoComplete="email"
              autoFocus
              maxLength={MAX_EMAIL_LEN}
              value={email}
              onChange={(event) => { setEmail(event.target.value); setValidationError(null); }}
            />
          </div>
          <Button type="button" size="sm" disabled={pending} onClick={() => void handleRequest()}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
            <span>{pending ? 'Enviando…' : 'Enviar código'}</span>
          </Button>
        </div>
        <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={pending} onClick={() => setPhase('view')}>
          <span>Cancelar</span>
        </Button>
        {(validationError ?? error) && <p role="alert" className="text-label text-red">{validationError ?? error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-label text-text-muted">Digite o código enviado para {targetEmail}. Ele expira em 30 minutos.</p>
      <OTPInput
        label="Código de confirmação"
        hint="Digite os 6 dígitos enviados para seu e-mail."
        errorMessage={error ?? 'Confira o código e tente novamente.'}
        successMessage="E-mail alterado com sucesso."
        value={code}
        status={otpStatus}
        disabled={pending}
        onChange={(value) => { setCode(value); setOtpStatus('idle'); setError(null); }}
        onComplete={(value) => { void handleConfirm(value); }}
        aria-label="Código de confirmação de e-mail"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending || code.length !== 6} onClick={() => void handleConfirm()}>
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          <span>{pending ? 'Confirmando…' : 'Confirmar e-mail'}</span>
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void handleResend()}>
          <span>{resent ? 'Código reenviado' : 'Reenviar código'}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => { setPhase('edit'); setCode(''); setError(null); setOtpStatus('idle'); }}
        >
          <span>Usar outro e-mail</span>
        </Button>
      </div>
    </div>
  );
}
