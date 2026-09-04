import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { HeadphoneOff, MicOff, ScreenShare, Settings, Video } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { useParticipantMedia, useAttachTrack, useIsSpeaking } from './useLiveKitTrack';
import { tileKey } from './tileTypes';
import type { TileKind } from './tileTypes';
import { Avatar, colorFor } from '../../shared/Avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';

interface TileProps {
  participantId: string;
  kind: TileKind;
  isMine: boolean;
  /** 'cover' (padrao — grade, miniaturas, PiP): a celula tem o tamanho que o
   * layout mandar, e o video a preenche cortando o excesso — certo pra
   * tiles pequenos, onde cortar e melhor que sobrar espaco. 'contain' (tile
   * em foco): a CAIXA (nao so o video) se ajusta pra caber certinho na
   * proporcao real do video dentro do espaco disponivel — como nunca sobra
   * espaco dentro da caixa, os selos (nome/engrenagem) e os cantos
   * arredondados ficam sempre em cima da imagem de verdade. */
  fit?: 'cover' | 'contain';
  /** Avatar GRANDE centralizado (so aparece quando kind==='avatar', camera
   * desligada) — o tile nao sabe seu proprio tamanho renderizado (quem
   * decide e o pai, via width/height inline), entao precisa vir de fora.
   * Default pensado pra grade/foco; a tira de miniaturas do modo foco passa
   * um valor menor (ver TileGrid) — sem isso, 80px fixo dentro de uma
   * miniatura de 90px de altura ficava gigante, quase do tamanho da celula
   * inteira. */
  avatarSize?: number;
  /** Tamanho do nome na pilula inferior — 'body' (padrao, grade/miniaturas)
   * ou 'label' (um degrau menor, usado no tile GRANDE do modo foco: o tile
   * ocupa a tela quase inteira, entao o mesmo texto que e proporcional
   * numa celula pequena da grade fica desproporcional ali). */
  nameSize?: 'body' | 'label';
}

export function Tile({ participantId, kind, isMine, fit = 'cover', avatarSize = 80, nameSize = 'body' }: TileProps) {
  const { state, dispatch, openTileMenu, tileDomRegistry, deafened } = useRoom();
  const key = tileKey(participantId, kind);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [containSize, setContainSize] = useState<{ w: number; h: number } | null>(null);

  const participant = isMine ? null : state.participants.get(participantId);
  const name = isMine ? state.me.name : (participant?.name ?? '');
  const avatar = isMine ? state.me.avatar : (participant?.avatar ?? '');
  // ensurdecido nao tem track no LiveKit — pra mim mesma e o estado local
  // (instantaneo), pros outros vem do Participant que o servidor repassa.
  const isDeafened = isMine ? deafened : (participant?.deafened ?? false);

  const media = useParticipantMedia(participantId);
  const isSpeaking = useIsSpeaking(participantId);

  const showsVideo = kind !== 'avatar';
  const videoTrack = kind === 'screen' ? media.screenTrack : kind === 'camera' ? media.cameraTrack : null;
  useAttachTrack(videoTrack, videoRef);

  // borda reativa de fala: so no tile "da pessoa" (camera/avatar) — falar
  // nao deveria destacar a tela compartilhada.
  const showSpeakingBorder = kind !== 'screen' && isSpeaking;
  const tint = colorFor(participantId);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    tileDomRegistry.current.set(key, { root, video: showsVideo ? videoRef.current : null });
    return () => { tileDomRegistry.current.delete(key); };
  }, [key, showsVideo, videoTrack, tileDomRegistry]);

  // fit="contain": calcula o tamanho exato que a CAIXA (nao so o video)
  // precisa ter pra caber sem cortar na proporcao real do video, dentro do
  // espaco que o pai (quem de fato define o espaco disponivel) tem —
  // mesma conta que object-fit:contain faria, aplicada na caixa inteira em
  // vez de so no video. Reage a: pai mudar de tamanho (redimensionar
  // janela, abrir/fechar chat) e o video mudar de proporcao (carrega
  // metadata, ou uma transmissao que muda de resolucao no meio da sessao).
  useEffect(() => {
    if (fit !== 'contain' || !showsVideo) { setContainSize(null); return; }
    const root = rootRef.current;
    const video = videoRef.current;
    const parent = root?.parentElement;
    if (!root || !video || !parent) return;

    function recompute() {
      const ratio = video!.videoWidth && video!.videoHeight ? video!.videoWidth / video!.videoHeight : 16 / 9;
      const { width: pw, height: ph } = parent!.getBoundingClientRect();
      let w = pw;
      let h = w / ratio;
      if (h > ph) { h = ph; w = h * ratio; }
      setContainSize({ w, h });
    }

    recompute();
    video.addEventListener('loadedmetadata', recompute);
    video.addEventListener('resize', recompute);
    const ro = new ResizeObserver(recompute);
    ro.observe(parent);
    return () => {
      video.removeEventListener('loadedmetadata', recompute);
      video.removeEventListener('resize', recompute);
      ro.disconnect();
    };
  }, [fit, showsVideo, videoTrack]);

  const handleClick = useCallback(() => {
    dispatch({ type: 'SET_FOCUSED', id: state.focusedId === key ? null : key });
  }, [dispatch, key, state.focusedId]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    // sem isso o clique borbulharia ate o GlobalContextMenu (App.tsx) e
    // abriria os dois menus juntos.
    e.stopPropagation();
    openTileMenu(key, participantId, kind, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY });
  }, [key, participantId, kind, openTileMenu]);

  const handleGearClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    openTileMenu(key, participantId, kind, e.currentTarget.getBoundingClientRect());
  }, [key, participantId, kind, openTileMenu]);

  const rootStyle = kind === 'screen'
    ? undefined
    : { background: `color-mix(in srgb, ${tint} 22%, var(--color-bg-tertiary))` };

  return (
    <div
      ref={rootRef}
      className={`tile-fullscreen-target relative h-full w-full cursor-pointer overflow-hidden rounded-xl border bg-bg-tertiary transition-colors ${
        showSpeakingBorder ? '' : 'border-transparent'
      }`}
      style={{
        ...rootStyle,
        ...(fit === 'contain' && containSize ? { width: containSize.w, height: containSize.h } : {}),
        ...(showSpeakingBorder ? { borderColor: tint } : {}),
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {showsVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={isMine} className={`h-full w-full object-cover ${kind === 'screen' ? 'bg-black' : ''}`} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5">
          <Avatar id={participantId} name={name} avatar={avatar} size={avatarSize} />
        </div>
      )}

      <div className={cn(
        'absolute bottom-2 left-2 flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full bg-bg-tertiary/85 py-1 pr-2.5',
        // pl-1 so faz sentido pra "abracar" o avatar de 20px que fica logo
        // em seguida — sem ele, o texto merece o mesmo respiro do lado
        // direito (pr-2.5), senao cola na borda esquerda da pilula.
        showsVideo ? 'pl-1' : 'pl-2.5'
      )}>
        {/* so mostra o avatar aqui pros tiles de VIDEO (camera/tela) — e a
            unica referencia visual de quem e nesses casos. No tile
            kind==='avatar' o avatar GRANDE ja preenche o corpo inteiro logo
            acima, repetir de novo aqui (pequeno) era so redundancia. */}
        {showsVideo && <Avatar id={participantId} name={name} avatar={avatar} size={20} />}
        <span className={cn('select-none truncate font-medium text-text-primary', nameSize === 'label' ? 'text-label' : 'text-body')}>{name}</span>
        {/* icones "meta" — so aparecem quando NAO sao redundantes com o que
            esse tile especifico ja mostra (ex.: nao repete camera-ligada no
            proprio tile de camera), sinalizando que a pessoa tem OUTRO
            stream ativo em algum outro tile. */}
        {kind !== 'camera' && !!media.cameraTrack && <Video size={14} className="flex-none text-green" />}
        {kind !== 'screen' && !!media.screenTrack && <ScreenShare size={14} className="flex-none text-blurple" />}
        {isDeafened ? (
          <HeadphoneOff size={14} className="flex-none text-red" />
        ) : (
          kind !== 'screen' && media.micActivated && media.micMuted && (
            <MicOff size={14} className="flex-none text-red" />
          )
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Configuracoes da transmissao"
        onClick={handleGearClick}
        className="absolute right-2 top-2 bg-bg-tertiary/75 text-text-primary hover:bg-blurple"
      >
        <Settings size={14} />
      </Button>
    </div>
  );
}
