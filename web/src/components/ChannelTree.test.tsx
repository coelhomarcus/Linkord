import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '../test/roomContextFixture';
import { NewChannelDialog } from './ChannelTree';

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
