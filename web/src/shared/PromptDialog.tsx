import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { sectionLabelClass } from './SectionLabel';

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Valor inicial do campo ao abrir — usado por "renomear" (pre-preenche
   * com o nome atual); "criar" nao passa isso, entao comeca vazio. */
  initialValue?: string;
  onConfirm: (value: string) => void;
}

/** Modal generico "digite um nome, confirme" — usado no lugar de window.prompt()
 * pras acoes de criar/renomear categoria/canal, pra ficar consistente com o
 * resto da UI (mesmo espirito do ConfirmDialog, so que com um campo de texto). */
export function PromptDialog({ open, onOpenChange, title, label, placeholder, confirmLabel = 'Criar', initialValue = '', onConfirm }: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-90 bg-bg-modal p-6">
        <DialogTitle className="text-title font-bold text-text-primary">{title}</DialogTitle>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promptDialogValue" className={sectionLabelClass}>{label}</Label>
            <Input
              id="promptDialogValue"
              autoFocus
              maxLength={60}
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <span>Cancelar</span>
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              <span>{confirmLabel}</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
