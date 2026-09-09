import { useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import { ZoomIn } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { getCroppedImageBlob } from '@/shared/lib/cropImage';

interface ImageCropDialogProps {
  open: boolean;
  imageSrc: string | null;
  /** 1 for a square (avatar) crop, 3 for a wide (banner) crop — 1500x500 is
   * the convention X itself uses for banners. */
  aspect: number;
  cropShape: 'round' | 'rect';
  title: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

/** Drag-to-pan, scroll/slider-to-zoom crop step shown after picking a file
 * for the avatar or banner (see SettingsModal's Perfil tab) — mirrors X's
 * own "choose photo -> crop -> save" flow. Shared between both fields via
 * `aspect`/`cropShape`; the actual pixel crop only happens on confirm
 * (getCroppedImageBlob), so canceling never touches anything. */
export function ImageCropDialog({ open, imageSrc, aspect, cropShape, title, onCancel, onConfirm }: ImageCropDialogProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  // fresh framing for every new file, not whatever was left over from a
  // previous crop session.
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
      {/* outer stays a fixed-size, non-scrolling box (so the close button
          this renders stays pinned top-right) — everything else lives in
          the inner overflow-y-auto div, same split SettingsModal uses, so a
          short viewport (phone landscape, a squat window) scrolls the
          cropper/slider/buttons instead of cutting Cancelar/Salvar off with
          no way to reach them. */}
      <DialogContent className="flex max-h-[90vh] max-w-[calc(100%-2rem)] flex-col overflow-hidden bg-bg-modal p-0 sm:max-w-125">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          <DialogTitle className="text-title font-bold text-text-primary">{title}</DialogTitle>

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

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              <span>Cancelar</span>
            </Button>
            <Button type="button" disabled={saving || !croppedAreaPixels} onClick={handleSave}>
              <span>{saving ? 'Salvando…' : 'Salvar'}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
