import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { RoomContext } from '@/state/RoomContext';
import { MessageComposer } from '@/features/chat/MessageComposer';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import type { Conversation, PublicUser } from '@/shared/types/protocol';

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

  it('com o toggle ligado, o lote vai para a outbox marcado para comprimir', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: true, queueMessageWithFiles,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const original = fakeFile('foto.jpg', 'image/jpeg');
    await user.upload(input, original);

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', '', undefined, [{ file: original, compress: true }]);
  });

  it('com o toggle desligado, o lote vai para a outbox sem marcar compressao', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: false, queueMessageWithFiles,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const original = fakeFile('foto.jpg', 'image/jpeg');
    await user.upload(input, original);

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', '', undefined, [{ file: original, compress: false }]);
  });

  it('o envio vai para a outbox e o campo fica livre na hora', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: true, queueMessageWithFiles,
    });
    const doc = fakeFile('doc.pdf', 'application/pdf');
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, doc);
    await user.type(screen.getByRole('textbox'), 'segue');
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', 'segue', undefined, [{ file: doc, compress: true }]);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('textbox')).toBeEnabled();
    // the tray unmounts via a framer-motion exit animation, not synchronously
    await waitFor(() => expect(screen.queryByText('doc.pdf')).not.toBeInTheDocument());
  });

  it('respondendo a uma mensagem, o envio de anexos leva a referencia da resposta', async () => {
    const user = userEvent.setup();
    const queueMessageWithFiles = vi.fn();
    const replyingTo = { msgId: 42, conversationId: 'conv-1', id: 'u2', name: 'Ana', avatar: '', text: 'oi', ts: 0 };
    const { container } = renderWithRoom(<MessageComposer conversationId="conv-1" />, {
      state: joinedState, compressImagesDefault: false, queueMessageWithFiles, replyingTo,
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, fakeFile('doc.pdf', 'application/pdf'));

    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    expect(queueMessageWithFiles).toHaveBeenCalledWith('conv-1', '', 42, expect.anything());
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

  it('enviar um lote libera a conversa na hora: trocar em seguida nao apaga nem reenvia nada', async () => {
    const user = userEvent.setup();
    const setReplyingTo = vi.fn();
    const queueMessageWithFiles = vi.fn();
    const { container, switchTo } = renderComposer('conv-1', { queueMessageWithFiles, setReplyingTo });
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, fakeFile('um.pdf', 'application/pdf'));
    await user.type(screen.getByRole('textbox'), 'legenda');
    await user.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    // ownership already moved to the outbox — the draft is clean before the switch
    expect(queueMessageWithFiles).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue('');
    // the tray unmounts via a framer-motion exit animation, not synchronously
    await waitFor(() => expect(screen.queryByText('um.pdf')).not.toBeInTheDocument());

    switchTo('conv-2');
    await user.type(screen.getByRole('textbox'), 'texto novo');
    switchTo('conv-1');

    expect(screen.getByRole('textbox')).toHaveValue('');
    switchTo('conv-2');
    expect(screen.getByRole('textbox')).toHaveValue('texto novo');
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
