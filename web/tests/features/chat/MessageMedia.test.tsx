import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MessageMedia } from '@/features/chat/MessageMedia';
import { __resetCachedImageSrcForTests } from '@/shared/hooks/useCachedImageSrc';
import type { ChatAttachment } from '@/shared/types/protocol';

vi.mock('@/shared/lib/highlightCode', () => ({ highlightCode: vi.fn(async () => null) }));

const img = (id: string, width?: number, height?: number): ChatAttachment => ({ id, name: `${id}.png`, mime: 'image/png', size: 10, ...(width ? { width, height } : {}) });

describe('MessageMedia', () => {
  afterEach(() => { vi.unstubAllGlobals(); __resetCachedImageSrcForTests(); });

  it('imagem unica com dimensoes reserva a caixa final antes de carregar', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('a', 1600, 900)]} />);
    const button = screen.getByRole('button', { name: 'Abrir a.png' });
    // jsdom drops CSS min() — the width rule itself is covered in mediaLayout.test.ts
    expect(button.style.aspectRatio).toBe('1600 / 900');
  });

  it('lote misto: imagens juntas no mosaico e o documento depois', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = render(<MessageMedia attachments={[img('a', 10, 10), { id: 'd', name: 'rel.pdf', mime: 'application/pdf', size: 5 }, img('b', 10, 10), img('c', 10, 10)]} />);
    const grid = container.querySelector('.grid')!;
    expect(within(grid as HTMLElement).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Abrir a.png (1 de 3)', 'Abrir b.png (2 de 3)', 'Abrir c.png (3 de 3)',
    ]);
    expect(screen.getByTitle('rel.pdf').compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('abre o visualizador na imagem clicada e navega pela colecao', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<MessageMedia attachments={[img('a', 10, 10), img('b', 10, 10), img('c', 10, 10)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir b.png (2 de 3)' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'b.png' })).toHaveAttribute('src', '/uploads/b');
    expect(within(dialog).getByRole('link', { name: 'Baixar original' })).toHaveAttribute('href', '/uploads/b');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Próxima' }));
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Próxima' })).toBeDisabled();

    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();
  });
});
