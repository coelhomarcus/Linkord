import { useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { ZoomIn } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { getCroppedImageBlob } from '@/shared/lib/cropImage';

interface ImageCropDialogProps {
  open: boolean;
  imageSrc: string | null;
  aspect: number;
  cropShape: 'round' | 'rect';
  title: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

export function ImageCropDialog({ open, imageSrc, aspect, cropShape, title, onCancel, onConfirm }: ImageCropDialogProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setSaving(false);
    }
  }, [open, imageSrc]);

  async function handleSave() {
    if (!imageSrc || !croppedAreaPixels) return;
    setSaving(true);
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels);
      onConfirm(blob);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-125">
        <DialogHeader className="px-6 pt-6 pr-12">
          <DialogTitle className="text-title font-bold text-text-primary">{title}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4">
          {imageSrc && (
            <div className="relative h-80 w-full flex-none overflow-hidden rounded-md bg-black">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                cropShape={cropShape}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <ZoomIn size={16} className="flex-none text-text-muted" />
            <Slider
              value={[zoom]}
              onValueChange={(v) => setZoom(Array.isArray(v) ? (v[0] ?? 1) : (v as number))}
              min={1}
              max={3}
              step={0.01}
            />
          </div>
        </div>

        <DialogFooter className="border-subtle bg-bg-tertiary/60 px-6 py-4">
          <Button type="button" variant="ghost" onClick={onCancel}>
            <span>Cancelar</span>
          </Button>
          <Button type="button" disabled={saving || !croppedAreaPixels} onClick={handleSave}>
            <span>{saving ? 'Salvando…' : 'Salvar'}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
