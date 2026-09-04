import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessageText } from './ChatMessageText';

// primeiro teste de COMPONENTE do projeto — de proposito o mais simples
// possivel (ChatMessageText nao chama useRoom(), nao precisa da fixture de
// RoomContext). Mensagem sem link nenhum evita renderizar <ChatEmbed>
// (qualquer URL, mesmo generica, vira um embed — ver web/src/shared/lib/
// chatEmbeds.ts — e ChatEmbed por sua vez busca preview de rede, fora do
// escopo deste teste).
describe('ChatMessageText', () => {
  it('renderiza texto puro (sem link) como paragrafo, sem nenhum embed', () => {
    render(<ChatMessageText text="oi, tudo bem?" />);
    expect(screen.getByText('oi, tudo bem?')).toBeInTheDocument();
  });

  it('preserva quebras de linha (whitespace-pre-wrap) — nao colapsa em uma linha so', () => {
    const { container } = render(<ChatMessageText text={'linha 1\nlinha 2'} />);
    expect(container.querySelector('p')?.textContent).toBe('linha 1\nlinha 2');
  });

  it('mensagem vazia nao renderiza nenhum paragrafo', () => {
    const { container } = render(<ChatMessageText text="" />);
    expect(container.querySelector('p')).toBeNull();
  });
});
