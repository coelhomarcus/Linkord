import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingAttachments } from '@/features/chat/PendingAttachments';
import type { OutboxAttachment } from '@/features/chat/useMessageOutbox';

function attachment(over: Partial<OutboxAttachment> = {}): OutboxAttachment {
  return { localId: 'l1', name: 'contrato.pdf', mime: 'application/pdf', size: 1024, previewUrl: null, progress: 0, failed: false, ...over };
}

describe('PendingAttachments', () => {
  it('document with no progress yet shows "Preparando envio…", without making up a percentage', () => {
    render(<PendingAttachments attachments={[attachment({ progress: 0 })]} />);
    expect(screen.getByTitle('contrato.pdf')).toBeInTheDocument();
    expect(screen.getByText('Preparando envio…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('document being transferred shows the percentage and the bar', () => {
    render(<PendingAttachments attachments={[attachment({ progress: 0.62 })]} />);
    expect(screen.getByText('Enviando arquivo… 62%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62');
  });

  it('document ready on the server shows "Arquivo carregado" and hides the bar, without turning into a sent message', () => {
    render(<PendingAttachments attachments={[attachment({ progress: 1 })]} />);
    expect(screen.getByText('Arquivo carregado')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('document with a failure shows "Falhou" and not the progress bar', () => {
    render(<PendingAttachments attachments={[attachment({ progress: 0.3, failed: true })]} />);
    expect(screen.getByText('Falhou')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('image with a preview uses a thumbnail with an overlaid bar, not the document card', () => {
    render(<PendingAttachments attachments={[attachment({ name: 'foto.png', mime: 'image/png', previewUrl: 'blob:x', progress: 0.4 })]} />);
    expect(screen.getByAltText('foto.png')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText(/Enviando arquivo/)).not.toBeInTheDocument();
  });

  it('image with a failure shows the failure indicator, not the bar', () => {
    render(<PendingAttachments attachments={[attachment({ name: 'foto.png', mime: 'image/png', previewUrl: 'blob:x', failed: true })]} />);
    expect(screen.getByLabelText('Falhou')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
