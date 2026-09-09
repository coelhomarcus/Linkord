import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/** Generic confirmation modal — used instead of window.confirm() for
 * destructive actions, to stay consistent with the rest of the UI (never a
 * native browser dialog). */
export function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', destructive = false, onConfirm,
}: ConfirmDialogProps) {
  function handleConfirm() {
    onConfirm();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-100">
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle className="text-title font-bold text-text-primary">{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 py-4">
          <DialogDescription className="select-none text-body text-text-secondary">{description}</DialogDescription>
        </div>
        <DialogFooter className="border-subtle bg-bg-tertiary/60 px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            <span>{cancelLabel}</span>
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={handleConfirm}>
            <span>{confirmLabel}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
