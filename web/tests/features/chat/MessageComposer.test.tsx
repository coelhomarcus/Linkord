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
  return new File(['content'], name, { type });
}

describe('MessageComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the message with Enter and clears the field', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, 'ola pessoal{Enter}');

    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', 'ola pessoal', undefined);
    expect(textarea).toHaveValue('');
  });

  it('shift+enter does not send, only breaks the line', async () => {
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, 'linha 1{Shift>}{Enter}{/Shift}linha 2');

    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('linha 1\nlinha 2');
  });

  it('the send button starts disabled and enables with text', async () => {
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

  it('"+" opens the Adicionar menu; "Anexar arquivos" opens the general file picker', async () => {
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

  it('the image shortcut opens an images-only picker', async () => {
    const user = userEvent.setup();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });
    const clicked: HTMLInputElement[] = [];
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { clicked.push(this); });

    await user.click(screen.getByRole('button', { name: 'Enviar imagens' }));

    expect(clicked.map((el) => el.accept)).toEqual(['image/*']);
    clickSpy.mockRestore();
  });

  it.each([true, false])('the compress option in the menu reflects the preference (%s)', async (preference) => {
    const user = userEvent.setup();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, compressImagesDefault: preference });

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByRole('menuitemcheckbox', { name: 'Compactar imagens (WebP)' })).toHaveAttribute('aria-checked', String(preference));
  });

  it('checking the compress option updates the persisted preference', async () => {
    const user = userEvent.setup();
    const setCompressImagesDefault = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, compressImagesDefault: true, setCompressImagesDefault });

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Compactar imagens (WebP)' }));

    expect(setCompressImagesDefault).toHaveBeenCalledWith(false);
  });

  it('near the limit shows the counter; above it blocks sending without cutting the text', async () => {
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

  it('with the toggle on, the batch goes to the outbox marked to compress', async () => {
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

  it('with the toggle off, the batch goes to the outbox without marking compression', async () => {
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

  it('sending goes to the outbox and the field frees up right away', async () => {
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
    await waitFor(() => expect(screen.queryByTitle('doc.pdf')).not.toBeInTheDocument());
  });

  it('when replying to a message, sending attachments carries the reply reference', async () => {
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

  it('emits typing:true on the first keystroke, and not again inside the throttle window (3s)', () => {
    const sendTyping = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping });

    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'a' } });
    expect(sendTyping).toHaveBeenCalledWith('conv-1', true);
    expect(sendTyping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    fireEvent.change(textarea, { target: { value: 'ab' } });
    expect(sendTyping).toHaveBeenCalledTimes(1); // still within the 3s window, does not re-emit
  });

  it('emits typing:false on its own after 5s of no typing', () => {
    const sendTyping = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping });

    fireEvent.change(screen.getByPlaceholderText('Mensagem'), { target: { value: 'oi' } });
    expect(sendTyping).toHaveBeenCalledWith('conv-1', true);

    vi.advanceTimersByTime(5000);
    expect(sendTyping).toHaveBeenLastCalledWith('conv-1', false);
  });

  it('clearing the field (deleting everything) emits typing:false right away, without waiting for idle', () => {
    const sendTyping = vi.fn();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendTyping });

    const textarea = screen.getByPlaceholderText('Mensagem');
    fireEvent.change(textarea, { target: { value: 'oi' } });
    fireEvent.change(textarea, { target: { value: '' } });

    expect(sendTyping).toHaveBeenLastCalledWith('conv-1', false);
  });

  it('sending the message emits typing:false right away, before the 5s idle', async () => {
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

describe('MessageComposer — mentions (@)', () => {
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

  it('typing "@" shows only candidates who are members of this conversation', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.type(screen.getByPlaceholderText('Mensagem'), 'oi @an');

    expect(await screen.findByText('Ana Silva')).toBeInTheDocument();
    expect(screen.getByText('André Costa')).toBeInTheDocument();
    expect(screen.queryByText('Fora Da Conversa')).not.toBeInTheDocument();
  });

  it('Enter with the dropdown open inserts the mention instead of sending the message', async () => {
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

  it('clicking a candidate inserts the mention', async () => {
    const user = userEvent.setup();
    renderComposer();

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, '@an');
    await user.click(await screen.findByText('André Costa'));

    expect(textarea).toHaveValue('@andre ');
  });

  it('Escape closes the dropdown without changing the text or sending', async () => {
    const user = userEvent.setup();
    renderComposer();

    const textarea = screen.getByPlaceholderText('Mensagem');
    await user.type(textarea, '@an');
    await screen.findByText('Ana Silva');
    await user.keyboard('{Escape}');

    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
    expect(textarea).toHaveValue('@an');
  });

  it('an "@" in the middle of a word (e.g. an email) does not open the dropdown', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.type(screen.getByPlaceholderText('Mensagem'), 'fulano@an');

    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
  });
});

describe('MessageComposer — per-conversation draft', () => {
  function renderComposer(conversationId: string, overrides: Parameters<typeof createFakeRoomContextValue>[0] = {}) {
    const value = createFakeRoomContextValue({ state: joinedState, compressImagesDefault: false, ...overrides });
    const view = render(<RoomContext.Provider value={value}><MessageComposer conversationId={conversationId} /></RoomContext.Provider>);
    return {
      ...view,
      switchTo: (id: string) => view.rerender(<RoomContext.Provider value={value}><MessageComposer conversationId={id} /></RoomContext.Provider>),
    };
  }

  it('each conversation has its own text; going back restores what was written', async () => {
    const user = userEvent.setup();
    const { switchTo } = renderComposer('conv-1');
    await user.type(screen.getByRole('textbox'), 'rascunho um');

    switchTo('conv-2');
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.type(screen.getByRole('textbox'), 'outro');

    switchTo('conv-1');
    expect(screen.getByRole('textbox')).toHaveValue('rascunho um');
  });

  it('attachments picked in one conversation do not show up in another', async () => {
    const user = userEvent.setup();
    const { container, switchTo } = renderComposer('conv-1');
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, fakeFile('um.pdf', 'application/pdf'));

    switchTo('conv-2');
    // the tray has an exit animation, so the node leaves a moment later
    await waitFor(() => expect(screen.queryByTitle('um.pdf')).not.toBeInTheDocument());
    switchTo('conv-1');
    expect(screen.getByTitle('um.pdf')).toBeInTheDocument();
  });

  it('sending a batch frees up the conversation right away: switching afterward neither erases nor resends anything', async () => {
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
    await waitFor(() => expect(screen.queryByTitle('um.pdf')).not.toBeInTheDocument());

    switchTo('conv-2');
    await user.type(screen.getByRole('textbox'), 'texto novo');
    switchTo('conv-1');

    expect(screen.getByRole('textbox')).toHaveValue('');
    switchTo('conv-2');
    expect(screen.getByRole('textbox')).toHaveValue('texto novo');
  });

  it('text saved in sessionStorage comes back after a page reload', () => {
    sessionStorage.setItem('linkord:draft:v1::conv-9', 'sobreviveu ao reload');
    renderComposer('conv-9');
    expect(screen.getByRole('textbox')).toHaveValue('sobreviveu ao reload');
  });

  it('clearAllDrafts (logout) erases drafts from memory and from sessionStorage', async () => {
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
