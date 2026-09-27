import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { RoomContext } from '@/state/RoomContext';
import { MessageComposer } from '@/features/chat/MessageComposer';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import { compressImageFile } from '@/shared/lib/compressImageFile';
import type { Conversation, PublicUser } from '@/shared/types/protocol';
import { ApiError } from '@/shared/api/api';
import { PartialAttachmentError, type SendAttachmentsRequest } from '@/features/chat/useAttachmentsUpload';

vi.mock('@/shared/lib/compressImageFile', () => ({
  compressImageFile: vi.fn(async (file: File) => file),
}));

const joinedState = { ...initialRoomState, joined: true };

// drafts live in a module-level store keyed by conversation, so every test
// here would otherwise inherit the previous one's text and files
afterEach(() => clearAllDrafts());

function fakeFile(name: string, type: string): File {
  return new File(['conteudo'], name, { type });
}

describe('MessageComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('envia a mensagem com Enter e limpa o campo', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, 'ola pessoal{Enter}');

    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'ola pessoal', undefined);
    expect(textarea).toHaveValue('');
  });

  it('sem conexao, a mensagem nao e descartada: o texto fica e um aviso aparece', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => false);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, 'importante{Enter}');

    expect(textarea).toHaveValue('importante');
    expect(screen.getByText(/Sem conexão com o servidor/)).toBeInTheDocument();
  });

  it('shift+enter nao envia, so quebra linha', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, 'linha 1{Shift>}{Enter}{/Shift}linha 2');

    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('linha 1\nlinha 2');
  });

  it('botao de enviar comeca desabilitado e habilita com texto', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const sendButton = screen.getByRole('button', { name: 'Enviar mensagem' });
    expect(sendButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Mensagem'), 'oi');
    expect(sendButton).toBeEnabled();

    await user.click(sendButton);
    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'oi', undefined);
  });

  it('"+" abre o menu Adicionar; "Anexar arquivos" abre o seletor geral', async () => {
    const user = userEvent.setup();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });
    const clicked: HTMLInputElement[] = [];
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { clicked.push(this); });

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Anexar arquivos' }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.accept).toBe('');
    expect(container.contains(clicked[0]!)).toBe(true);
    clickSpy.mockRestore();
  });

  it('o atalho de imagem abre um seletor so de imagens', async () => {
    const user = userEvent.setup();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });
    const clicked: HTMLInputElement[] = [];
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { clicked.push(this); });

    await user.click(screen.getByRole('button', { name: 'Enviar imagens' }));

    expect(clicked.map((el) => el.accept)).toEqual(['image/*']);
    clickSpy.mockRestore();
  });

  it.each([true, false])('a opcao de compactar no menu reflete a preferencia (%s)', async (preference) => {
    const user = userEvent.setup();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, compressImagesDefault: preference });

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByRole('menuitemcheckbox', { name: 'Compactar imagens (WebP)' })).toHaveAttribute('aria-checked', String(preference));
  });

  it('marcar a opcao de compactar atualiza a preferencia persistida', async () => {
    const user = userEvent.setup();
    const setCompressImagesDefault = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, compressImagesDefault: true, setCompressImagesDefault });

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Compactar imagens (WebP)' }));

    expect(setCompressImagesDefault).toHaveBeenCalledWith(false);
  });

  it('perto do limite mostra o contador; acima dele bloqueia o envio sem cortar o texto', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });
    const textarea = screen.getByRole('textbox', { name: 'Mensagem' });

    fireEvent.change(textarea, { target: { value: 'a'.repeat(1500) } });
    expect(screen.queryByText('500')).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'a'.repeat(1900) } });
    expect(screen.getByText('100')).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: 'a'.repeat(2010) } });
    expect(textarea).toHaveValue('a'.repeat(2010));
    expect(screen.getByText('-10')).toBeInTheDocument();
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled();
    await user.type(textarea, '{Enter}');
    expect(sendChatMessage).not.toHaveBeenCalled();
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
    expect(sendAttachments).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1', files: [original], caption: '' }));
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
    expect(sendAttachments).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1', files: [original], caption: '' }));
  });

  it('servidor com lotes preparados: o envio vai para a outbox e o campo fica livre na hora', async () => {
    const user = userEvent.setup();
    const sendAttachments = vi.fn(async () => {});
    const queueMessageWithFiles = vi.fn(() => true);
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: true, sendAttachments, queueMessageWithFiles,
    });
    const doc = fakeFile('doc.pdf', 'application/pdf');
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, doc);
    await user.type(screen.getByRole('textbox'), 'segue');
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', 'segue', undefined, [{ file: doc, compress: true }]);
    expect(sendAttachments).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('respondendo a uma mensagem, o envio de anexos leva a referencia da resposta', async () => {
    const user = userEvent.setup();
    const sendAttachments = vi.fn(async () => {});
    const replyingTo = { msgId: 42, conversationId: 'conv-1', id: 'u2', name: 'Ana', avatar: '', text: 'oi', ts: 0 };
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: false, sendAttachments, replyingTo,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, fakeFile('doc.pdf', 'application/pdf'));

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(sendAttachments).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 42 }));
  });

  it('falha no meio do lote: so os arquivos que faltaram voltam, e o reenvio completa a mesma mensagem', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    const sendAttachments = vi.fn<(req: SendAttachmentsRequest) => Promise<void>>(async ({ onFileSent }) => {
      onFileSent?.(0, 99);
      throw new PartialAttachmentError(99, 1, 2, new Error('rede'));
    });
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: false, sendAttachments, sendChatMessage,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const first = fakeFile('um.pdf', 'application/pdf');
    const second = fakeFile('dois.pdf', 'application/pdf');
    await user.upload(input, [first, second]);
    await user.type(screen.getByRole('textbox'), 'legenda');

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(await screen.findByText('Um anexo não foi enviado. Envie de novo para tentar só ele.')).toBeInTheDocument();
    expect(screen.queryByText('um.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('dois.pdf')).toBeInTheDocument();
    // the caption went out with the first file
    expect(screen.getByRole('textbox')).toHaveValue('');

    sendAttachments.mockImplementationOnce(async () => {});
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(sendAttachments).toHaveBeenLastCalledWith(expect.objectContaining({ files: [second], caption: '', targetMsgId: 99 }));
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('falha no primeiro arquivo: nada foi publicado, texto e arquivos continuam para reenviar do zero', async () => {
    const user = userEvent.setup();
    const sendAttachments = vi.fn(async () => { throw new ApiError(500, 'internal_error', 'Falhou.'); });
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: false, sendAttachments,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, [fakeFile('um.pdf', 'application/pdf'), fakeFile('dois.pdf', 'application/pdf')]);
    await user.type(screen.getByRole('textbox'), 'legenda');

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(await screen.findByText('Falhou.')).toBeInTheDocument();
    expect(screen.getByText('um.pdf')).toBeInTheDocument();
    expect(screen.getByText('dois.pdf')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('legenda');

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    expect(sendAttachments).toHaveBeenLastCalledWith(expect.objectContaining({ caption: 'legenda', targetMsgId: undefined }));
  });

  it('mensagem anterior nao aceita mais anexos: o proximo envio cria uma mensagem nova', async () => {
    const user = userEvent.setup();
    const sendAttachments = vi.fn<(req: SendAttachmentsRequest) => Promise<void>>(async ({ onFileSent }) => {
      onFileSent?.(0, 99);
      throw new PartialAttachmentError(99, 1, 2, new Error('rede'));
    });
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: false, sendAttachments,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, [fakeFile('um.pdf', 'application/pdf'), fakeFile('dois.pdf', 'application/pdf')]);
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    sendAttachments.mockImplementationOnce(async () => { throw new ApiError(400, 'target_message_too_old', 'Antiga.'); });
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    expect(await screen.findByText(/Não deu para completar a mensagem anterior/)).toBeInTheDocument();

    sendAttachments.mockImplementationOnce(async () => {});
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    expect(sendAttachments).toHaveBeenLastCalledWith(expect.objectContaining({ targetMsgId: undefined }));
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
    const sendChatMessage = vi.fn(() => true);
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
    memberIds: ['u-ana', 'u-andre'], lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0,
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
    const sendChatMessage = vi.fn(() => true);
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

describe('MessageComposer — rascunho por conversa', () => {
  function renderComposer(conversationId: string, overrides: Parameters<typeof createFakeRoomContextValue>[0] = {}) {
    const value = createFakeRoomContextValue({ state: joinedState, compressImagesDefault: false, ...overrides });
    const view = render(<RoomContext.Provider value={value}><MessageComposer conversationId={conversationId} /></RoomContext.Provider>);
    return {
      ...view,
      switchTo: (id: string) => view.rerender(<RoomContext.Provider value={value}><MessageComposer conversationId={id} /></RoomContext.Provider>),
    };
  }

  it('cada conversa tem o proprio texto; voltar restaura o que estava escrito', async () => {
    const user = userEvent.setup();
    const { switchTo } = renderComposer('conv-1');
    await user.type(screen.getByRole('textbox'), 'rascunho um');

    switchTo('conv-2');
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.type(screen.getByRole('textbox'), 'outro');

    switchTo('conv-1');
    expect(screen.getByRole('textbox')).toHaveValue('rascunho um');
  });

  it('anexos escolhidos numa conversa nao aparecem na outra', async () => {
    const user = userEvent.setup();
    const { container, switchTo } = renderComposer('conv-1');
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, fakeFile('um.pdf', 'application/pdf'));

    switchTo('conv-2');
    // the tray has an exit animation, so the node leaves a moment later
    await waitFor(() => expect(screen.queryByText('um.pdf')).not.toBeInTheDocument());
    switchTo('conv-1');
    expect(screen.getByText('um.pdf')).toBeInTheDocument();
  });

  it('upload que termina depois da troca de conversa nao apaga o texto da conversa nova', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const setReplyingTo = vi.fn();
    const sendAttachments = vi.fn<(req: SendAttachmentsRequest) => Promise<void>>(({ onFileSent }) => new Promise((resolve) => {
      finish = () => { onFileSent?.(0, 5); resolve(); };
    }));
    const { container, switchTo } = renderComposer('conv-1', { sendAttachments, setReplyingTo });
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, fakeFile('um.pdf', 'application/pdf'));
    await user.type(screen.getByRole('textbox'), 'legenda');
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    switchTo('conv-2');
    await user.type(screen.getByRole('textbox'), 'texto novo');
    await act(async () => finish());

    expect(screen.getByRole('textbox')).toHaveValue('texto novo');
    expect(setReplyingTo).not.toHaveBeenCalled();
    switchTo('conv-1');
    expect(screen.getByRole('textbox')).toHaveValue('');
    await waitFor(() => expect(screen.queryByText('um.pdf')).not.toBeInTheDocument());
  });

  it('upload em andamento numa conversa nao bloqueia o envio em outra', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    const sendAttachments = vi.fn(() => new Promise<void>(() => {}));
    const { container, switchTo } = renderComposer('conv-1', { sendAttachments, sendChatMessage });
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, fakeFile('um.pdf', 'application/pdf'));
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    switchTo('conv-2');
    await user.type(screen.getByRole('textbox'), 'oi{Enter}');

    expect(sendChatMessage).toHaveBeenCalledWith('conv-2', 'oi', undefined);
  });

  it('texto salvo no sessionStorage volta depois de recarregar a pagina', () => {
    sessionStorage.setItem('linkord:draft:v1::conv-9', 'sobreviveu ao reload');
    renderComposer('conv-9');
    expect(screen.getByRole('textbox')).toHaveValue('sobreviveu ao reload');
  });

  it('clearAllDrafts (logout) apaga os rascunhos da memoria e do sessionStorage', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderComposer('conv-1');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'segredo' } });
      act(() => { vi.advanceTimersByTime(1000); });
      expect(sessionStorage.getItem('linkord:draft:v1::conv-1')).toBe('segredo');

      act(() => clearAllDrafts());
      expect(sessionStorage.getItem('linkord:draft:v1::conv-1')).toBeNull();
      expect(screen.getByRole('textbox')).toHaveValue('');
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
