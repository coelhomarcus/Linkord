import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  initialValue?: string;
  onConfirm: (value: string) => void;
}

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
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-90">
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader className="px-6 pt-6 pr-12">
            <DialogTitle className="text-title font-bold text-text-primary">{title}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 py-4">
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
          </div>
          <DialogFooter className="border-subtle bg-bg-tertiary/60 px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <span>Cancelar</span>
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              <span>{confirmLabel}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
