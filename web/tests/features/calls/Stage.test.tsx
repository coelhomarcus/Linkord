import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { forwardRef } from 'react';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { AnimatedSidebarProvider } from '@/shared/ui/motion/animated-sidebar';
import { Stage } from '@/features/calls/Stage';

vi.mock('@/features/calls/CallControlBar', () => ({
  // A real forwardRef — Stage measures this element's height, so the mock
  // has to actually accept the ref, not just ignore it like a plain div would.
  CallControlBar: forwardRef<HTMLDivElement, { hudVisible?: boolean }>(function CallControlBar({ hudVisible }, ref) {
    return <div ref={ref} data-testid="control-bar" data-hud-visible={hudVisible ? '1' : '0'} />;
  }),
}));
vi.mock('@/features/calls/CallChatToggleButton', () => ({
  CallChatToggleButton: ({ chatOpen, hudVisible }: { chatOpen: boolean; hudVisible?: boolean }) => (
    <div data-testid="chat-toggle" data-chat-open={chatOpen ? '1' : '0'} data-hud-visible={hudVisible ? '1' : '0'} />
  ),
}));

const tileGridSpy = vi.fn();
vi.mock('@/features/calls/TileGrid', () => ({
  TileGrid: (props: { onCapacityChange?: (meetsMinimum: boolean, key: string | null) => void }) => {
    tileGridSpy(props);
    return <div data-testid="tile-grid" />;
  },
}));

function lastOnCapacityChange(): (meetsMinimum: boolean, key: string | null) => void {
  const call = tileGridSpy.mock.calls.at(-1);
  return call![0].onCapacityChange!;
}

function renderStage(props: { allIds: string[]; chatOpen: boolean; onToggleChat: () => void }, overrides: Partial<RoomContextValue> = {}) {
  return render(
    <RoomContext.Provider value={createFakeRoomContextValue(overrides)}>
      <AnimatedSidebarProvider>
        <Stage {...props} />
      </AnimatedSidebarProvider>
    </RoomContext.Provider>
  );
}

describe('Stage — composicao e integracao com fullscreen/HUD', () => {
  it('anexa callStageRef ao proprio elemento raiz (alvo da tela cheia)', () => {
    const callStageRef = { current: null as HTMLElement | null };
    const { container } = renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() }, { callStageRef });
    expect(callStageRef.current).toBe(container.querySelector('[data-stage]'));
  });

  it('renderiza CallControlBar e CallChatToggleButton dentro de si, repassando chatOpen', () => {
    renderStage({ allIds: [], chatOpen: true, onToggleChat: vi.fn() });
    const chatToggle = document.querySelector('[data-testid="chat-toggle"]');
    expect(document.querySelector('[data-testid="control-bar"]')).toBeInTheDocument();
    expect(chatToggle).toHaveAttribute('data-chat-open', '1');
  });

  it('HUD comeca visivel (repassado pra ambos os filhos)', () => {
    renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() });
    expect(document.querySelector('[data-testid="control-bar"]')).toHaveAttribute('data-hud-visible', '1');
    expect(document.querySelector('[data-testid="chat-toggle"]')).toHaveAttribute('data-hud-visible', '1');
  });

  it('com um menu de tile aberto (menuTarget), o HUD fica sempre visivel independente do tempo ocioso', () => {
    vi.useFakeTimers();
    try {
      renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() }, {
        menuTarget: { key: 'p-2:participant', participantId: 'p-2', kind: 'camera', rect: { left: 0, top: 0, right: 0, bottom: 0 } },
      });
      act(() => { vi.advanceTimersByTime(10000); });
      expect(document.querySelector('[data-testid="control-bar"]')).toHaveAttribute('data-hud-visible', '1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconectando tambem suspende a ocultacao do HUD', () => {
    vi.useFakeTimers();
    try {
      renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() }, { reconnecting: true });
      act(() => { vi.advanceTimersByTime(10000); });
      expect(document.querySelector('[data-testid="control-bar"]')).toHaveAttribute('data-hud-visible', '1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('erro de compartilhamento (shareError) suspende a ocultacao do HUD', () => {
    vi.useFakeTimers();
    try {
      renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() }, {
        state: { ...initialRoomState, shareError: 'falhou' },
      });
      act(() => { vi.advanceTimersByTime(10000); });
      expect(document.querySelector('[data-testid="control-bar"]')).toHaveAttribute('data-hud-visible', '1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sem nada suspendendo, o HUD some sozinho depois do tempo ocioso', () => {
    vi.useFakeTimers();
    try {
      renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() });
      act(() => { vi.advanceTimersByTime(3000); });
      expect(document.querySelector('[data-testid="control-bar"]')).toHaveAttribute('data-hud-visible', '0');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Stage — reserva de espaco dinamica pra barra (nada de pb-32 fixo)', () => {
  it('mede a altura real da barra (+ banners) e reserva exatamente altura + espacamento', () => {
    const getRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 60 } as DOMRect);
    try {
      renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() });
      const stage = document.querySelector('[data-stage]') as HTMLElement;
      expect(stage.style.paddingBottom).toBe('84px');
    } finally {
      getRect.mockRestore();
    }
  });
});

describe('Stage — fallback de capacidade (TileGrid nao cabe todo mundo -> foco automatico)', () => {
  it('sem ninguem em foco, capacidade insuficiente aciona SET_FOCUSED com origin "capacity"', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() }, { dispatch, state: { ...initialRoomState, focusedId: null, focusOrigin: null } });
    lastOnCapacityChange()(false, 'p-2:avatar');
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-2:avatar', origin: 'capacity' });
  });

  it('quando a capacidade volta a caber, desfaz APENAS um foco que ela mesma causou', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() }, {
      dispatch, state: { ...initialRoomState, focusedId: 'p-2:avatar', focusOrigin: 'capacity' },
    });
    lastOnCapacityChange()(true, null);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: null, origin: 'capacity' });
  });

  it('nunca sobrescreve um foco MANUAL, nem pra focar nem pra desfocar', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() }, {
      dispatch, state: { ...initialRoomState, focusedId: 'p-2:avatar', focusOrigin: 'manual' },
    });
    lastOnCapacityChange()(false, 'p-3:avatar');
    lastOnCapacityChange()(true, null);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('nao mexe num foco automatico causado por tela compartilhada (origin "automatic"), so no que ela mesma causou', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() }, {
      dispatch, state: { ...initialRoomState, focusedId: 'p-2:screen', focusOrigin: 'automatic' },
    });
    lastOnCapacityChange()(true, null);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ja com algo em foco (qualquer origem), nao foca de novo so por falta de capacidade', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [], chatOpen: false, onToggleChat: vi.fn() }, {
      dispatch, state: { ...initialRoomState, focusedId: 'p-2:screen', focusOrigin: 'automatic' },
    });
    lastOnCapacityChange()(false, 'p-3:avatar');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
