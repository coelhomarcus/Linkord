import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { Tile } from '@/features/calls/Tile';
import type { Participant } from '@/shared/types/protocol';

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-2', userId: 'u-2', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'conv-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

describe('Tile — indicador de mutado (para mim)', () => {
  it('mostra botao "Reativar audio" quando o audio do participante esta mutado para mim, e desmuta ao clicar', () => {
    const audio = new Audio();
    audio.volume = 0;
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });

    const button = screen.getByLabelText('Reativar áudio');
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(audio.volume).toBeCloseTo(0.4);
    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });

  it('nao mostra o botao quando o audio nao esta mutado', () => {
    const audio = new Audio();
    audio.volume = 1;
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });

    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });

  it('nao mostra o botao no proprio tile', () => {
    const audio = new Audio();
    audio.volume = 0;
    renderWithRoom(<Tile participantId="p-1" kind="avatar" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      audioRegistry: { current: new Map([['p-1', { element: audio }]]) },
    });

    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });
});

describe('Tile — carregando (publicacao sem track ainda)', () => {
  it('mostra um indicador de carregamento sobre o avatar, nao so um avatar comum', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} loading />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('sem loading, o avatar aparece normal e sem spinner', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });
});

describe('Tile — espelhamento da propria camera', () => {
  it('minha camera com a preferencia ligada aparece espelhada', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: true,
    });
    expect(container.querySelector('video')).toHaveStyle({ transform: 'scaleX(-1)' });
  });

  it('com a preferencia desligada, nao espelha', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: false,
    });
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });

  it('a camera de outro participante nunca espelha, mesmo com a preferencia ligada', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
      mirrorCameraPreview: true,
    });
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });

  it('compartilhamento de tela nunca espelha, mesmo sendo meu', () => {
    const { container } = renderWithRoom(<Tile participantId="p-1" kind="screen" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: true,
    });
    expect(container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });
});

describe('Tile — pilula de acoes agrupada', () => {
  it('so com "Configuracoes da transmissao": nenhum divisor, e o botao de reativar audio nao aparece', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(screen.getByLabelText('Configurações da transmissão')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });

  it('com audio mutado pra mim, os dois botoes ficam na mesma pilula (mesmo pai)', () => {
    const audio = new Audio();
    audio.volume = 0;
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });
    const unmute = screen.getByLabelText('Reativar áudio');
    const gear = screen.getByLabelText('Configurações da transmissão');
    expect(unmute.parentElement).toBe(gear.parentElement);
  });

  it('a pilula de acoes fica no canto superior esquerdo, nao mais a direita', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    const pill = screen.getByLabelText('Configurações da transmissão').parentElement;
    expect(pill).toHaveClass('left-1.5');
    expect(pill?.className).not.toMatch(/\bright-/);
  });
});

describe('Tile — moldura estavel ao falar', () => {
  it('a largura da borda nao muda entre falando e nao falando (sem pulo de layout)', () => {
    const { container: notSpeaking } = renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant({ speaking: false })]]) },
    });
    const root = notSpeaking.querySelector('.tile-fullscreen-target');
    expect(root).toHaveClass('border-[3.5px]');
  });
});

describe('Tile — nome no padrao de grid', () => {
  it('densidade padrao (grid) usa o texto pequeno de 12px', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(screen.getByText('Fulana')).toHaveClass('text-caption');
  });

  it('densidade "label" (tile em foco) usa o texto um pouco maior', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} nameSize="label" />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(screen.getByText('Fulana')).toHaveClass('text-label');
  });
});

describe('Tile — acessibilidade por teclado', () => {
  it('e focavel e tem papel de botao, com aria-pressed refletindo o foco atual', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: null },
    });
    const tile = screen.getByRole('button', { name: /Destacar Fulana/ });
    expect(tile).toHaveAttribute('tabindex', '0');
    expect(tile).toHaveAttribute('aria-pressed', 'false');
  });

  it('quando ja e o tile em foco, o rotulo e a acao oferecem desfazer', () => {
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: 'p-2:participant' },
    });
    const tile = screen.getByRole('button', { name: /Desfazer destaque de Fulana/ });
    expect(tile).toHaveAttribute('aria-pressed', 'true');
  });

  it('Enter no tile alterna o foco, igual um clique — com a origem "manual"', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: null },
      dispatch,
    });
    const tile = screen.getByRole('button', { name: /Destacar Fulana/ });
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-2:participant', origin: 'manual' });
  });

  it('Espaco no tile tambem alterna o foco', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: null },
      dispatch,
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /Destacar Fulana/ }), { key: ' ' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-2:participant', origin: 'manual' });
  });

  it('outras teclas nao acionam nada', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
      dispatch,
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /Destacar Fulana/ }), { key: 'a' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Enter num botao aninhado (engrenagem) nao aciona TAMBEM o foco do tile', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
      dispatch,
      openTileMenu: vi.fn(),
    });
    const gear = screen.getByLabelText('Configurações da transmissão');
    fireEvent.keyDown(gear, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_FOCUSED' }));
  });
});
