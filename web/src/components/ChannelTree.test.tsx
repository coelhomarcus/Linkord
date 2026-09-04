import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '../test/roomContextFixture';
import { initialRoomState } from '../state/roomReducer';
import { ChannelTree, NewChannelDialog } from './ChannelTree';
import type { Participant } from '../types/protocol';

// segundo teste de componente — este JA usa a fixture de RoomContext
// (NewChannelDialog chama useRoom() pra ler `categories` e chamar
// `createChannel`), provando que o padrao renderWithRoom funciona pra
// qualquer componente futuro que dependa do contexto.
describe('NewChannelDialog', () => {
  const category = { id: 'cat1', name: 'Geral', channels: [] };

  it('"Criar" comeca desabilitado sem nome digitado', () => {
    renderWithRoom(<NewChannelDialog open onOpenChange={vi.fn()} />, { categories: [category] });
    expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
  });

  it('digitar um nome habilita "Criar"; enviar chama createChannel com categoria/tipo certos', async () => {
    const createChannel = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithRoom(<NewChannelDialog open onOpenChange={onOpenChange} />, { categories: [category], createChannel });

    await user.type(screen.getByLabelText('Nome do canal'), 'anuncios');
    expect(screen.getByRole('button', { name: 'Criar' })).toBeEnabled();

    // sem clicar em "Voz", o tipo padrao e 'text'.
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(createChannel).toHaveBeenCalledWith('cat1', 'anuncios', 'text');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('clicar em "Voz" muda o tipo enviado pra createChannel', async () => {
    const createChannel = vi.fn();
    const user = userEvent.setup();
    renderWithRoom(<NewChannelDialog open onOpenChange={vi.fn()} />, { categories: [category], createChannel });

    await user.click(screen.getByRole('button', { name: 'Voz' }));
    await user.type(screen.getByLabelText('Nome do canal'), 'sala-de-voz');
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(createChannel).toHaveBeenCalledWith('cat1', 'sala-de-voz', 'voice');
  });

  it('nome so com espacos continua desabilitando "Criar" (trim)', async () => {
    const user = userEvent.setup();
    renderWithRoom(<NewChannelDialog open onOpenChange={vi.fn()} />, { categories: [category] });
    await user.type(screen.getByLabelText('Nome do canal'), '   ');
    expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
  });
});

// regressao: uma pessoa em outro canal de voz (voiceChannelId setado via
// socket) tem que aparecer na lista, com icones de midia certos, mesmo sem
// o usuario local estar conectado ao LiveKit desse canal — a fixture ja usa
// um Room() real e DESCONECTADO (ver roomContextFixture.tsx), reproduzindo
// exatamente esse cenario sem precisar mockar o LiveKit. Os icones vem do
// auto-relato de cada participante via Socket.IO (ver protocol.ts) quando o
// LiveKit local nao tem esse dado.
describe('CallParticipantRow (via ChannelTree)', () => {
  const voiceChannel = { id: 'voice1', name: 'Sala de voz', type: 'voice' as const };
  const category = { id: 'cat1', name: 'Geral', channels: [voiceChannel] };

  function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
    return {
      id: 'user-2', userId: 'user-2', name: 'Fulano', avatar: '', role: 'user',
      deafened: false, voiceChannelId: 'voice1',
      micActivated: false, micMuted: true, cameraOn: false, sharing: false, speaking: false,
      ...overrides,
    };
  }

  // lucide-react marca cada icone com uma classe `lucide-<nome>` — sem
  // aria-label proprio pra buscar por texto acessivel (icone decorativo).
  function renderTreeWith(participant: Participant) {
    const state = { ...initialRoomState, participants: new Map([[participant.id, participant]]) };
    return renderWithRoom(
      <ChannelTree activeChannelId={null} onSelectChannel={vi.fn()} />,
      { categories: [category], state }
    );
  }

  it('mostra quem esta no canal de voz mesmo sem o LiveKit local conectado la', () => {
    renderTreeWith(fakeParticipant());
    expect(screen.getByText('Fulano')).toBeInTheDocument();
  });

  it('nao mostra o icone de mudo quando o mic ainda nao foi ativado (ninguem relatou nada ainda)', () => {
    const { container } = renderTreeWith(fakeParticipant({ micActivated: false }));
    expect(container.querySelector('.lucide-mic-off')).not.toBeInTheDocument();
  });

  it('mostra o icone de mudo quando o participante se auto-reportou mudo via socket', () => {
    const { container } = renderTreeWith(fakeParticipant({ micActivated: true, micMuted: true }));
    expect(container.querySelector('.lucide-mic-off')).toBeInTheDocument();
  });

  it('nao mostra o icone de mudo quando o participante se auto-reportou desmutado', () => {
    const { container } = renderTreeWith(fakeParticipant({ micActivated: true, micMuted: false }));
    expect(container.querySelector('.lucide-mic-off')).not.toBeInTheDocument();
  });

  it('mostra o icone de camera quando o participante se auto-reportou com a camera ligada', () => {
    const { container } = renderTreeWith(fakeParticipant({ cameraOn: true }));
    expect(container.querySelector('.lucide-video')).toBeInTheDocument();
  });

  it('mostra o icone de compartilhamento quando o participante se auto-reportou compartilhando tela', () => {
    const { container } = renderTreeWith(fakeParticipant({ sharing: true }));
    expect(container.querySelector('.lucide-screen-share')).toBeInTheDocument();
  });
});
