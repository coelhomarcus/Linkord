import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessageText } from './ChatMessageText';
import { buildMentionLookup } from '../../shared/lib/mentions';
import type { PublicUser } from '../../types/protocol';

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

describe('ChatMessageText — @mencoes', () => {
  const allUsers = new Map<string, PublicUser>([
    ['u1', { id: 'u1', username: 'Lune', avatar: '', role: 'admin' }],
  ]);
  const mentionLookup = buildMentionLookup(allUsers);

  it('sem mentionLookup, "@word" fica como texto puro (compat com quem nao passa a prop)', () => {
    const { container } = render(<ChatMessageText text="oi @Lune" />);
    expect(container.querySelector('span')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('oi @Lune');
  });

  it('"@Lune" (conta real) vira um span destacado; "@ninguem" (nao cadastrado) fica texto puro', () => {
    const { container } = render(<ChatMessageText text="oi @Lune e @ninguem" mentionLookup={mentionLookup} />);
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.textContent).toBe('@Lune');
    expect(container.querySelector('p')?.textContent).toBe('oi @Lune e @ninguem');
  });

  it('menção case-insensitive: "@lune" (minusculo) ainda resolve pra "Lune"', () => {
    const { container } = render(<ChatMessageText text="oi @lune" mentionLookup={mentionLookup} />);
    expect(container.querySelector('span')?.textContent).toBe('@Lune');
  });

  it('menção a mim mesmo (myUserId) ganha um estilo diferente da menção a outra pessoa', () => {
    const { container: toOther } = render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} myUserId="someone-else" />);
    const { container: toMe } = render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} myUserId="u1" />);
    expect(toOther.querySelector('span')?.className).not.toBe(toMe.querySelector('span')?.className);
  });
});
