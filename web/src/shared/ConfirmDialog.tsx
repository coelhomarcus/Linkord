import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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

/** Modal generico de confirmacao — usado no lugar de window.confirm() pra
 * acoes destrutivas, pra ficar consistente com o resto da UI (nunca um
 * dialogo nativo do navegador). */
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
      <DialogContent className="max-w-100 bg-bg-modal p-6">
        <DialogTitle className="text-title font-bold text-text-primary">{title}</DialogTitle>
        <p className="select-none text-body text-text-secondary">{description}</p>
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            <span>{cancelLabel}</span>
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={handleConfirm}>
            <span>{confirmLabel}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
