import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatMessageText } from './ChatMessageText';
import { buildMentionLookup } from '../../shared/lib/mentions';
import type { PublicUser } from '../../types/protocol';

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

  it('renderiza um emoji único em tamanho ampliado', () => {
    render(<ChatMessageText text={'  😀\n'} />);
    expect(screen.getByRole('paragraph')).toHaveClass('text-[48px]', 'leading-none');
  });

  it('mantém mensagens com mais de um emoji no tamanho normal', () => {
    render(<ChatMessageText text="😀😀" />);
    expect(screen.getByRole('paragraph')).not.toHaveClass('text-[48px]');
  });
});

describe('ChatMessageText — @mencoes', () => {
  const allUsers = new Map<string, PublicUser>([
    ['u1', { id: 'u1', username: 'Lune', displayName: 'Lune', avatar: '', avatarColor: 'fuchsia', banner: '', bio: '', profileLinks: [], role: 'admin' }],
  ]);
  const mentionLookup = buildMentionLookup(allUsers);

  it('sem mentionLookup, "@word" fica como texto puro (compat com quem nao passa a prop)', () => {
    const { container } = render(<ChatMessageText text="oi @Lune" />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('oi @Lune');
  });

  it('"@Lune" (conta real) vira um botão destacado com avatar; "@ninguem" (nao cadastrado) fica texto puro', () => {
    render(<ChatMessageText text="oi @Lune e @ninguem" mentionLookup={mentionLookup} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('@Lune');
    // avatar thumbnail rendered inside the chip — same Avatar component used everywhere else.
    expect(buttons[0]?.querySelector('[data-slot="avatar"]')).not.toBeNull();
    // "L" here is the avatar's fallback-initial text node, not part of the mention text itself.
    expect(screen.getByRole('paragraph').textContent).toBe('oi @LuneL e @ninguem');
  });

  it('menção case-insensitive: "@lune" (minusculo) ainda resolve pra "Lune"', () => {
    render(<ChatMessageText text="oi @lune" mentionLookup={mentionLookup} />);
    expect(screen.getByRole('button')).toHaveTextContent('@Lune');
  });

  it('menção a mim mesmo (myUserId) ganha um estilo diferente da menção a outra pessoa', () => {
    const { unmount } = render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} myUserId="someone-else" />);
    const otherClassName = screen.getByRole('button').className;
    unmount();
    render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} myUserId="u1" />);
    expect(screen.getByRole('button').className).not.toBe(otherClassName);
  });

  it('clicar na menção chama onOpenProfile com o id do usuário mencionado', async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} onOpenProfile={onOpenProfile} />);

    await user.click(screen.getByRole('button'));

    expect(onOpenProfile).toHaveBeenCalledWith('u1');
  });

  it('sem onOpenProfile, a menção fica desabilitada (não quebra, só não é clicável)', () => {
    render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
