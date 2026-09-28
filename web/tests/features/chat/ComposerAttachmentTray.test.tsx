import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComposerAttachmentTray } from '@/features/chat/ComposerAttachmentTray';
import type { PendingAttachment } from '@/features/chat/conversationDrafts';

function doc(id: string, name: string): PendingAttachment {
  return { id, file: new File(['x'], name, { type: 'application/pdf' }), previewUrl: null };
}

function image(id: string, name: string): PendingAttachment {
  return { id, file: new File(['x'], name, { type: 'image/png' }), previewUrl: `blob:${id}` };
}

/** Owns real state, like MessageComposer does via conversationDrafts — a
 * static `files` prop plus a no-op `onRemove` can't exercise the focus
 * restoration, which reacts to `files` actually shrinking. */
function TrayHarness({ initial, fallback }: { initial: PendingAttachment[]; fallback: ReturnType<typeof createRef<HTMLTextAreaElement>> }) {
  const [files, setFiles] = useState(initial);
  return (
    <>
      <textarea ref={fallback} aria-label="Mensagem" />
      <ComposerAttachmentTray files={files} onRemove={(id) => setFiles((prev) => prev.filter((f) => f.id !== id))} fallbackFocusRef={fallback} />
    </>
  );
}

describe('ComposerAttachmentTray', () => {
  it('rotulo de remover inclui o nome do arquivo', () => {
    render(<ComposerAttachmentTray files={[doc('a', 'contrato.pdf')]} onRemove={vi.fn()} fallbackFocusRef={createRef()} />);
    expect(screen.getByRole('button', { name: 'Remover contrato.pdf' })).toBeInTheDocument();
  });

  it('tile de documento nao sobrepoe o botao de remover ao nome/tamanho (sem posicionamento absoluto)', () => {
    render(<ComposerAttachmentTray files={[doc('a', 'contrato.pdf')]} onRemove={vi.fn()} fallbackFocusRef={createRef()} />);
    expect(screen.getByRole('button', { name: 'Remover contrato.pdf' }).className).not.toMatch(/absolute/);
  });

  it('tile de imagem mantem o botao sobreposto (overlay), ja que a miniatura preenche o espaco', () => {
    render(<ComposerAttachmentTray files={[image('a', 'foto.png')]} onRemove={vi.fn()} fallbackFocusRef={createRef()} />);
    expect(screen.getByRole('button', { name: 'Remover foto.png' }).className).toMatch(/absolute/);
  });

  it('remover um item do meio move o foco pro proximo', async () => {
    const user = userEvent.setup();
    const fallback = createRef<HTMLTextAreaElement>();
    render(<TrayHarness initial={[doc('a', 'um.pdf'), doc('b', 'dois.pdf'), doc('c', 'tres.pdf')]} fallback={fallback} />);

    await user.click(screen.getByRole('button', { name: 'Remover dois.pdf' }));

    expect(await screen.findByRole('button', { name: 'Remover tres.pdf' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Remover dois.pdf' })).not.toBeInTheDocument();
  });

  it('remover o ultimo item da lista move o foco pro anterior', async () => {
    const user = userEvent.setup();
    const fallback = createRef<HTMLTextAreaElement>();
    render(<TrayHarness initial={[doc('a', 'um.pdf'), doc('b', 'dois.pdf')]} fallback={fallback} />);

    await user.click(screen.getByRole('button', { name: 'Remover dois.pdf' }));

    expect(await screen.findByRole('button', { name: 'Remover um.pdf' })).toHaveFocus();
  });

  it('remover o unico item devolve o foco ao campo de mensagem', async () => {
    const user = userEvent.setup();
    const fallback = createRef<HTMLTextAreaElement>();
    render(<TrayHarness initial={[doc('a', 'unico.pdf')]} fallback={fallback} />);

    await user.click(screen.getByRole('button', { name: 'Remover unico.pdf' }));

    expect(await screen.findByRole('textbox', { name: 'Mensagem' })).toHaveFocus();
  });
});
