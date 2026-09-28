import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { AnimatedSidebarProvider } from '@/shared/ui/motion/animated-sidebar';
import { Stage } from '@/features/calls/Stage';

vi.mock('@/features/calls/CallControlBar', () => ({
  CallControlBar: ({ hudVisible }: { hudVisible?: boolean }) => <div data-testid="control-bar" data-hud-visible={hudVisible ? '1' : '0'} />,
}));
vi.mock('@/features/calls/CallChatToggleButton', () => ({
  CallChatToggleButton: ({ chatOpen, hudVisible }: { chatOpen: boolean; hudVisible?: boolean }) => (
    <div data-testid="chat-toggle" data-chat-open={chatOpen ? '1' : '0'} data-hud-visible={hudVisible ? '1' : '0'} />
  ),
}));

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
