import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '../../state/roomReducer';
import { renderWithRoom } from '../../test/roomContextFixture';
import { MessageComposer } from './MessageComposer';
import { compressImageFile } from '@/shared/lib/compressImageFile';
import type { Conversation, PublicUser } from '@/types/protocol';

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

describe('MessageComposer — typing indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('emite typing:true na primeira tecla, e nao de novo dentro da janela de throttle (3s)', () => {
    const sendTyping = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping });

    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'a' } });
    expect(sendTyping).toHaveBeenCalledWith('conv-1', true);
    expect(sendTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    fireEvent.change(textarea, { target: { value: 'ab' } });
    expect(sendTyping).toHaveBeenCalledTimes(1); // ainda dentro dos 3s, nao reemite
  });

  it('emite typing:false sozinho depois de 5s sem digitar', () => {
    const sendTyping = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping });

    fireEvent.change(screen.getByPlaceholderText('Mensagem'), { target: { value: 'oi' } });
    expect(sendTyping).toHaveBeenCalledWith('conv-1', true);

    vi.advanceTimersByTime(5000);
    expect(sendTyping).toHaveBeenLastCalledWith('conv-1', false);
  });

  it('limpar o campo (apagar tudo) emite typing:false na hora, sem esperar o idle', () => {
    const sendTyping = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping });

    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'oi' } });
    fireEvent.change(textarea, { target: { value: '' } });

    expect(sendTyping).toHaveBeenLastCalledWith('conv-1', false);
  });

  it('enviar a mensagem emite typing:false na hora, antes do idle de 5s', async () => {
    const sendTyping = vi.fn();
    const sendChatMessage = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'ola' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'ola', undefined);
    expect(sendTyping).toHaveBeenLastCalledWith('conv-1', false);
  });
});

function fakeUser(id: string, username: string, displayName: string): PublicUser {
  return { id, username, displayName, avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };
}

describe('MessageComposer — menções (@)', () => {
  const ana = fakeUser('u-ana', 'ana', 'Ana Silva');
  const andre = fakeUser('u-andre', 'andre', 'André Costa');
  const outsider = fakeUser('u-fora', 'foradaconversa', 'Fora Da Conversa');

  const conversation: Conversation = {
    id: 'conv-1', type: 'group', title: 'Squad', avatar: '', createdBy: null,
    memberIds: ['u-ana', 'u-andre'], lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null,
  };

  function renderComposer(overrides: Partial<Parameters<typeof renderWithRoom>[1]> = {}) {
    const allUsers = new Map([[ana.id, ana], [andre.id, andre], [outsider.id, outsider]]);
    return renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, conversations: [conversation], allUsers, ...overrides,
    });
  }

  it('digitar "@" mostra só candidatos que são membros desta conversa', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.type(screen.getByPlaceholderText('Mensagem'), 'oi @an');

    expect(await screen.findByText('Ana Silva')).toBeInTheDocument();
    expect(screen.getByText('André Costa')).toBeInTheDocument();
    expect(screen.queryByText('Fora Da Conversa')).not.toBeInTheDocument();
  });

  it('Enter com o dropdown aberto insere a menção em vez de enviar a mensagem', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn();
    renderComposer({ sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, 'oi @an');
    await screen.findByText('Ana Silva');
    await user.keyboard('{Enter}');

    expect(textarea).toHaveValue('oi @ana ');
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
  });

  it('clicar num candidato insere a menção', async () => {
    const user = userEvent.setup();
    renderComposer();

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, '@an');
    await user.click(await screen.findByText('André Costa'));

    expect(textarea).toHaveValue('@andre ');
  });

  it('Escape fecha o dropdown sem alterar o texto nem enviar', async () => {
    const user = userEvent.setup();
    renderComposer();

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, '@an');
    await screen.findByText('Ana Silva');
    await user.keyboard('{Escape}');

    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
    expect(textarea).toHaveValue('@an');
  });

  it('um "@" no meio de uma palavra (ex.: e-mail) não abre o dropdown', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.type(screen.getByPlaceholderText('Mensagem'), 'fulano@an');

    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
  });
});
