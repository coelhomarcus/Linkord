import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatMessageText } from '@/features/chat/ChatMessageText';
import { buildMentionLookup } from '@/shared/lib/mentions';
import type { PublicUser } from '@/shared/types/protocol';

describe('ChatMessageText', () => {
  it('renders plain text (no link) as a paragraph, with no embed', () => {
    render(<ChatMessageText text="oi, tudo bem?" />);
    expect(screen.getByText('oi, tudo bem?')).toBeInTheDocument();
  });

  it('preserves line breaks (whitespace-pre-wrap) — does not collapse into one line', () => {
    const { container } = render(<ChatMessageText text={'linha 1\nlinha 2'} />);
    expect(container.querySelector('p')?.textContent).toBe('linha 1\nlinha 2');
  });

  it('empty message renders no paragraph at all', () => {
    const { container } = render(<ChatMessageText text="" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders a single emoji at an enlarged size', () => {
    render(<ChatMessageText text={'  😀\n'} />);
    expect(screen.getByRole('paragraph')).toHaveClass('text-[48px]', 'leading-none');
  });

  it('keeps messages with more than one emoji at normal size', () => {
    render(<ChatMessageText text="😀😀" />);
    expect(screen.getByRole('paragraph')).not.toHaveClass('text-[48px]');
  });
});

describe('ChatMessageText — mentions', () => {
  const allUsers = new Map<string, PublicUser>([
    ['u1', { id: 'u1', username: 'Lune', displayName: 'Lune', avatar: '', avatarColor: 'fuchsia', banner: '', bio: '', profileLinks: [], role: 'admin' }],
  ]);
  const mentionLookup = buildMentionLookup(allUsers);

  it('without mentionLookup, "@word" stays as plain text (compat with callers that skip the prop)', () => {
    const { container } = render(<ChatMessageText text="oi @Lune" />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('oi @Lune');
  });

  it('"@Lune" (real account) becomes a highlighted button with avatar; "@ninguem" (not registered) stays plain text', () => {
    render(<ChatMessageText text="oi @Lune e @ninguem" mentionLookup={mentionLookup} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('@Lune');
    // avatar thumbnail rendered inside the chip — same Avatar component used everywhere else.
    expect(buttons[0]?.querySelector('[data-slot="avatar"]')).not.toBeNull();
    // "L" here is the avatar's fallback-initial text node, not part of the mention text itself.
    expect(screen.getByRole('paragraph').textContent).toBe('oi @LuneL e @ninguem');
  });

  it('case-insensitive mention: "@lune" (lowercase) still resolves to "Lune"', () => {
    render(<ChatMessageText text="oi @lune" mentionLookup={mentionLookup} />);
    expect(screen.getByRole('button')).toHaveTextContent('@Lune');
  });

  it('mentioning myself (myUserId) gets a different style than mentioning someone else', () => {
    const { unmount } = render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} myUserId="someone-else" />);
    const otherClassName = screen.getByRole('button').className;
    unmount();
    render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} myUserId="u1" />);
    expect(screen.getByRole('button').className).not.toBe(otherClassName);
  });

  it('clicking the mention calls onOpenProfile with the mentioned user id', async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} onOpenProfile={onOpenProfile} />);

    await user.click(screen.getByRole('button'));

    expect(onOpenProfile).toHaveBeenCalledWith('u1');
  });

  it('without onOpenProfile, the mention stays disabled (does not break, just not clickable)', () => {
    render(<ChatMessageText text="oi @Lune" mentionLookup={mentionLookup} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('ChatMessageText — formatting', () => {
  it('bold, italic, strikethrough and code become the right elements', () => {
    const { container } = render(<ChatMessageText text="**a** *b* ~~c~~ `d`" />);
    expect(container.querySelector('strong')).toHaveTextContent('a');
    expect(container.querySelector('em')).toHaveTextContent('b');
    expect(container.querySelector('s')).toHaveTextContent('c');
    expect(container.querySelector('code')).toHaveTextContent('d');
  });

  it('a code block scrolls horizontally inside the message, without widening the page', () => {
    const { container } = render(<ChatMessageText text={'```\nconst muito_longo = 1;\n```'} />);
    const pre = container.querySelector('pre')!;
    expect(pre).toHaveTextContent('const muito_longo = 1;');
    expect(pre).toHaveClass('overflow-x-auto', 'max-w-full');
  });

  it('blockquote and list', () => {
    const { container } = render(<ChatMessageText text={'> citado\n- um\n- dois'} />);
    expect(container.querySelector('blockquote')).toHaveTextContent('citado');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('HTML in the text shows up as text, never as an element', () => {
    const { container } = render(<ChatMessageText text={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('a message with only a link keeps the address visible', () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    render(<ChatMessageText text="https://exemplo.com/pagina" />);
    expect(screen.getByRole('link', { name: 'https://exemplo.com/pagina' })).toHaveAttribute('href', 'https://exemplo.com/pagina');
    vi.unstubAllGlobals();
  });
});
