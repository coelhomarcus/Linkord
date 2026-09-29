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
  it('remove label includes the file name', () => {
    render(<ComposerAttachmentTray files={[doc('a', 'contrato.pdf')]} onRemove={vi.fn()} fallbackFocusRef={createRef()} />);
    expect(screen.getByRole('button', { name: 'Remover contrato.pdf' })).toBeInTheDocument();
  });

  it('document tile does not overlap the remove button with name/size (no absolute positioning)', () => {
    render(<ComposerAttachmentTray files={[doc('a', 'contrato.pdf')]} onRemove={vi.fn()} fallbackFocusRef={createRef()} />);
    expect(screen.getByRole('button', { name: 'Remover contrato.pdf' }).className).not.toMatch(/absolute/);
  });

  it('image tile keeps the button overlaid, since the thumbnail fills the space', () => {
    render(<ComposerAttachmentTray files={[image('a', 'foto.png')]} onRemove={vi.fn()} fallbackFocusRef={createRef()} />);
    expect(screen.getByRole('button', { name: 'Remover foto.png' }).className).toMatch(/absolute/);
  });

  it('removing a middle item moves focus to the next one', async () => {
    const user = userEvent.setup();
    const fallback = createRef<HTMLTextAreaElement>();
    render(<TrayHarness initial={[doc('a', 'um.pdf'), doc('b', 'dois.pdf'), doc('c', 'tres.pdf')]} fallback={fallback} />);

    await user.click(screen.getByRole('button', { name: 'Remover dois.pdf' }));

    expect(await screen.findByRole('button', { name: 'Remover tres.pdf' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Remover dois.pdf' })).not.toBeInTheDocument();
  });

  it('removing the last item in the list moves focus to the previous one', async () => {
    const user = userEvent.setup();
    const fallback = createRef<HTMLTextAreaElement>();
    render(<TrayHarness initial={[doc('a', 'um.pdf'), doc('b', 'dois.pdf')]} fallback={fallback} />);

    await user.click(screen.getByRole('button', { name: 'Remover dois.pdf' }));

    expect(await screen.findByRole('button', { name: 'Remover um.pdf' })).toHaveFocus();
  });

  it('removing the only item returns focus to the message field', async () => {
    const user = userEvent.setup();
    const fallback = createRef<HTMLTextAreaElement>();
    render(<TrayHarness initial={[doc('a', 'unico.pdf')]} fallback={fallback} />);

    await user.click(screen.getByRole('button', { name: 'Remover unico.pdf' }));

    expect(await screen.findByRole('textbox', { name: 'Mensagem' })).toHaveFocus();
  });
});
