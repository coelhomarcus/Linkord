import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ImageUrlDialogProps {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (url: string) => void;
}

function normalizeImageUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

export function ImageUrlDialog({ open, title, onOpenChange, onConfirm }: ImageUrlDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setError(null);
    }
  }, [open]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const url = normalizeImageUrl(value);
    if (!url) {
      setError('Cole uma URL valida (http ou https).');
      return;
    }
    onConfirm(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-100">
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle className="text-title font-bold text-text-primary">{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-6 py-4">
            <Label htmlFor="image-url-input" className="text-label text-text-muted">URL da imagem</Label>
            <Input
              id="image-url-input"
              autoFocus
              placeholder="https://..."
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
            />
            {error && <p className="text-label text-red">{error}</p>}
          </div>
          <DialogFooter className="border-subtle bg-bg-tertiary/60 px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <span>Cancelar</span>
            </Button>
            <Button type="submit">
              <span>Usar imagem</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
