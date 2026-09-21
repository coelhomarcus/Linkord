import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Textarea } from '@/shared/ui/primitives/textarea';
import { ApiError, submitReport } from '@/shared/api/api';
import { cn } from '@/shared/lib/utils';
import { MAX_REPORT_DETAILS, REPORT_CATEGORIES } from './reportCategories';
import type { ReportCategory, ReportTarget } from './reportCategories';

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Você enviou muitas denúncias. Espere um pouco.';
    if (err.status === 404) return 'Não foi possível encontrar o que você quer denunciar.';
  }
  return 'Não foi possível enviar a denúncia. Tente de novo.';
}

/** Files a report about an account, a group or a message. The confirmation is
 * deliberately neutral: it says nothing about what happens next or who else
 * was told — the reported account never learns who reported. */
export function ReportDialog({ target, open, onOpenChange }: {
  target: ReportTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
    setCategory(null);
    setDetails('');
    setStatus('idle');
    setError(null);
  }

  async function submit() {
    if (!target || !category || status === 'sending') return;
    setStatus('sending');
    setError(null);
    try {
      await submitReport({ targetType: target.type, targetId: target.id, category, details: details.trim() });
      setStatus('sent');
    } catch (err) {
      setError(describeError(err));
      setStatus('idle');
    }
  }

  const noun = target?.type === 'user' ? 'conta' : target?.type === 'group' ? 'grupo' : 'mensagem';

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-w-md border-white/10 bg-[rgb(18_18_20)] p-0 text-text-primary">
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-title">
            <Flag size={17} />
            Denunciar {noun}
          </DialogTitle>
        </DialogHeader>
        {status === 'sent' ? (
          <div className="px-5 py-6 text-body text-text-secondary">
            <p className="font-medium text-text-primary">Denúncia enviada.</p>
            <p className="mt-1 text-label text-text-muted">Obrigado por avisar. A administração vai analisar.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="text-label text-text-muted">
              {target ? <>Sobre <span className="font-medium text-text-secondary">{target.label}</span>. </> : null}
              Sua denúncia é sigilosa: a pessoa denunciada não vê quem enviou.
            </p>
            <div role="radiogroup" aria-label="Motivo" className="flex flex-col gap-1">
              {REPORT_CATEGORIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={category === option.value}
                  onClick={() => setCategory(option.value)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-label transition-colors',
                    category === option.value ? 'bg-primary/12 text-text-primary' : 'text-text-secondary hover:bg-white/[0.05]',
                  )}
                >
                  <span className={cn('grid size-4 place-items-center rounded-full border', category === option.value ? 'border-primary' : 'border-white/20')}>
                    {category === option.value && <span className="size-2 rounded-full bg-primary" />}
                  </span>
                  {option.label}
                </button>
              ))}
            </div>
            <Textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              maxLength={MAX_REPORT_DETAILS}
              rows={3}
              placeholder="Detalhes (opcional)"
              aria-label="Detalhes"
              className="resize-none border-white/10 bg-white/[0.04]"
            />
            {error && <p role="alert" className="text-label text-red-text">{error}</p>}
          </div>
        )}
        <DialogFooter className="border-t border-white/10 px-5 py-4">
          {status === 'sent' ? (
            <Button type="button" onClick={close}>Fechar</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={close}>Cancelar</Button>
              <Button type="button" onClick={() => void submit()} disabled={!category || status === 'sending'}>
                {status === 'sending' ? 'Enviando…' : 'Enviar denúncia'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
