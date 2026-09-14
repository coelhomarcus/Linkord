import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '../../state/roomReducer';
import { renderWithRoom } from '../../test/roomContextFixture';
import { MessageComposer } from './MessageComposer';
import { compressImageFile } from '@/shared/lib/compressImageFile';

vi.mock('@/shared/lib/compressImageFile', () => ({
  compressImageFile: vi.fn(async (file: File) => file),
}));

const joinedState = { ...initialRoomState, joined: true };

function fakeFile(name: string, type: string): File {
  return new File(['conteudo'], name, { type });
}

describe('MessageComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('envia a mensagem com Enter e limpa o campo', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, 'ola pessoal{Enter}');

    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'ola pessoal', undefined);
    expect(textarea).toHaveValue('');
  });

  it('shift+enter nao envia, so quebra linha', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, 'linha 1{Shift>}{Enter}{/Shift}linha 2');

    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('linha 1\nlinha 2');
  });

  it('botao de enviar comeca desabilitado e habilita com texto', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const sendButton = screen.getByRole('button', { name: 'Enviar mensagem' });
    expect(sendButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Mensagem'), 'oi');
    expect(sendButton).toBeEnabled();

    await user.click(sendButton);
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'oi', undefined);
  });

  it('botao de anexar abre o input de arquivo diretamente, sem menu', async () => {
    const user = userEvent.setup();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'Anexar arquivo' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    clickSpy.mockRestore();
  });

  it('nao mostra o toggle de compactar quando so ha anexo nao-imagem', async () => {
    const user = userEvent.setup();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    await user.upload(input, fakeFile('doc.pdf', 'application/pdf'));

    expect(screen.queryByLabelText('Compactar imagens antes de enviar')).not.toBeInTheDocument();
  });

  it('mostra o toggle ligado por padrao quando compressImagesDefault e true', async () => {
    const user = userEvent.setup();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, compressImagesDefault: true });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    await user.upload(input, fakeFile('foto.jpg', 'image/jpeg'));

    expect(screen.getByLabelText('Compactar imagens antes de enviar')).toBeChecked();
  });

  it('mostra o toggle desligado quando compressImagesDefault e false', async () => {
    const user = userEvent.setup();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, compressImagesDefault: false });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    await user.upload(input, fakeFile('foto.jpg', 'image/jpeg'));

    expect(screen.getByLabelText('Compactar imagens antes de enviar')).not.toBeChecked();
  });

  it('clicar no toggle atualiza a preferencia persistida', async () => {
    const user = userEvent.setup();
    const setCompressImagesDefault = vi.fn();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: true, setCompressImagesDefault,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, fakeFile('foto.jpg', 'image/jpeg'));

    await user.click(screen.getByLabelText('Compactar imagens antes de enviar'));

    expect(setCompressImagesDefault).toHaveBeenCalledWith(false);
  });

  it('com o toggle ligado, comprime cada imagem antes de enviar', async () => {
    const user = userEvent.setup();
    const sendAttachments = vi.fn(async () => {});
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: true, sendAttachments,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const original = fakeFile('foto.jpg', 'image/jpeg');
    await user.upload(input, original);

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(compressImageFile).toHaveBeenCalledTimes(1);
    expect(compressImageFile).toHaveBeenCalledWith(original);
    expect(sendAttachments).toHaveBeenCalledWith('conv-1', [original], '', expect.any(Function));
  });

  it('com o toggle desligado, envia os arquivos originais sem comprimir', async () => {
    const user = userEvent.setup();
    const sendAttachments = vi.fn(async () => {});
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: false, sendAttachments,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const original = fakeFile('foto.jpg', 'image/jpeg');
    await user.upload(input, original);

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(compressImageFile).not.toHaveBeenCalled();
    expect(sendAttachments).toHaveBeenCalledWith('conv-1', [original], '', expect.any(Function));
  });
});
