import { useState } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Input } from '@/shared/ui/primitives/input';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { REASON_MAX, REASON_MIN, describeAdminError } from './adminErrors';

/** Every restrictive or destructive admin action asks for a written reason
 * (§7.5), optionally a typed confirmation, and closes only once the server
 * answers — nothing here is optimistic. */
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, destructive, confirmText, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  /** when set, the admin must type exactly this (case-insensitive) to proceed */
  confirmText?: string;
  onSubmit: (reason: string, confirm: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonOk = reason.trim().length >= REASON_MIN;
  const confirmOk = !confirmText || confirm.trim().toLowerCase() === confirmText.toLowerCase();

  function close() {
    onOpenChange(false);
    setReason('');
    setConfirm('');
    setError(null);
    setBusy(false);
  }

  async function submit() {
    if (!reasonOk || !confirmOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason.trim(), confirm.trim());
      close();
    } catch (err) {
      setError(describeAdminError(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 bg-bg-modal p-0 sm:max-w-md">
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle className="text-title font-bold text-text-primary">{title}</DialogTitle>
          <DialogDescription className="text-body text-text-secondary">{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-4">
          <label className="flex flex-col gap-1.5 text-label text-text-muted">
            Motivo (fica registrado na auditoria)
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={3} className="resize-none border-white/10 bg-white/[0.04]" />
          </label>
          {confirmText && (
            <label className="flex flex-col gap-1.5 text-label text-text-muted">
              <span>Para confirmar, digite <span className="font-medium text-text-primary">{confirmText}</span></span>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="border-white/10 bg-white/[0.04]" />
            </label>
          )}
          {error && <p role="alert" className="text-label text-red-text">{error}</p>}
        </div>
        <DialogFooter className="border-subtle bg-bg-tertiary/60 px-6 py-4">
          <Button type="button" variant="ghost" onClick={close}>Cancelar</Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} disabled={!reasonOk || !confirmOk || busy} onClick={() => void submit()}>
            {busy ? 'Aguarde…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
