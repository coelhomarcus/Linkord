import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingAttachments } from '@/features/chat/PendingAttachments';
import type { OutboxAttachment } from '@/features/chat/useMessageOutbox';

function attachment(over: Partial<OutboxAttachment> = {}): OutboxAttachment {
  return { localId: 'l1', name: 'contrato.pdf', mime: 'application/pdf', size: 1024, previewUrl: null, progress: 0, failed: false, ...over };
}

describe('PendingAttachments', () => {
  it('documento sem progresso ainda mostra "Preparando envio…", sem inventar uma porcentagem', () => {
    render(<PendingAttachments attachments={[attachment({ progress: 0 })]} />);
    expect(screen.getByTitle('contrato.pdf')).toBeInTheDocument();
    expect(screen.getByText('Preparando envio…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('documento em transferencia mostra a porcentagem e a barra', () => {
    render(<PendingAttachments attachments={[attachment({ progress: 0.62 })]} />);
    expect(screen.getByText('Enviando arquivo… 62%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62');
  });

  it('documento pronto no servidor mostra "Arquivo carregado" e some a barra, sem virar mensagem enviada', () => {
    render(<PendingAttachments attachments={[attachment({ progress: 1 })]} />);
    expect(screen.getByText('Arquivo carregado')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('documento com falha mostra "Falhou" e nao a barra de progresso', () => {
    render(<PendingAttachments attachments={[attachment({ progress: 0.3, failed: true })]} />);
    expect(screen.getByText('Falhou')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('imagem com preview usa miniatura com barra sobreposta, nao o card de documento', () => {
    render(<PendingAttachments attachments={[attachment({ name: 'foto.png', mime: 'image/png', previewUrl: 'blob:x', progress: 0.4 })]} />);
    expect(screen.getByAltText('foto.png')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText(/Enviando arquivo/)).not.toBeInTheDocument();
  });

  it('imagem com falha mostra o indicador de falha, nao a barra', () => {
    render(<PendingAttachments attachments={[attachment({ name: 'foto.png', mime: 'image/png', previewUrl: 'blob:x', failed: true })]} />);
    expect(screen.getByLabelText('Falhou')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
