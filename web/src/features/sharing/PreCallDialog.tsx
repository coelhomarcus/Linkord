import { useState } from 'react';
import { Headphones, Mic, MicOff } from 'lucide-react';
import type { VoiceJoinOptions } from '../../state/RoomContext';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';

interface PreCallDialogProps {
  open: boolean;
  channelName: string;
  microphoneLabel?: string;
  permissionNeeded: boolean;
  onOpenChange: (open: boolean) => void;
  onJoin: (options: VoiceJoinOptions) => void;
}

/** A deliberately small pre-call step: it makes microphone intent explicit
 * without capturing media just because the dialog opened. The actual browser
 * permission prompt only appears after confirmation. */
export function PreCallDialog({
  open,
  channelName,
  microphoneLabel,
  permissionNeeded,
  onOpenChange,
  onJoin,
}: PreCallDialogProps) {
  const [joinMuted, setJoinMuted] = useState(true);
  const [listenOnly, setListenOnly] = useState(false);

  function resetChoices() {
    setJoinMuted(true);
    setListenOnly(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetChoices();
    onOpenChange(nextOpen);
  }

  function handleJoin() {
    onJoin({ muted: joinMuted, listenOnly });
    resetChoices();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Entrar em {channelName}</DialogTitle>
          <DialogDescription>
            Escolha como voce quer entrar. Nenhum dispositivo e ativado antes da confirmacao.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="precall-muted" className="font-medium text-foreground">Entrar com microfone mutado</label>
              <p id="precall-muted-description" className="text-label text-muted-foreground">
                O microfone e publicado ja mutado, sem transmitir um trecho inicial.
              </p>
            </div>
            <Switch
              id="precall-muted"
              checked={joinMuted}
              onCheckedChange={setJoinMuted}
              disabled={listenOnly}
              aria-describedby="precall-muted-description"
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="precall-listen-only" className="font-medium text-foreground">Somente ouvir</label>
              <p id="precall-listen-only-description" className="text-label text-muted-foreground">
                Entra sem solicitar acesso ao microfone. Voce pode ativa-lo depois.
              </p>
            </div>
            <Switch
              id="precall-listen-only"
              checked={listenOnly}
              onCheckedChange={setListenOnly}
              aria-describedby="precall-listen-only-description"
            />
          </div>

          <p className="text-label text-muted-foreground" role="status">
            {listenOnly
              ? 'O navegador nao solicitara permissao de microfone.'
              : permissionNeeded
                ? 'O navegador pode solicitar permissao para usar o microfone.'
                : `Microfone: ${microphoneLabel || 'padrao do sistema'}.`}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={handleJoin}>
            {listenOnly
              ? <Headphones data-icon="inline-start" />
              : joinMuted
                ? <MicOff data-icon="inline-start" />
                : <Mic data-icon="inline-start" />}
            Entrar na chamada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
