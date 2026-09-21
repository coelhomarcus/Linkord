import { describe, expect, it } from 'vitest';
import { messagePreviewText } from '@/features/chat/messagePreview';

describe('messagePreviewText', () => {
  it('usa o texto quando existe', () => expect(messagePreviewText({ text: 'oi' })).toBe('oi'));
  it('cai em "Anexo" para texto vazio', () => expect(messagePreviewText({ text: '' })).toBe('Anexo'));
  it('nomeia o grupo num convite', () => {
    expect(messagePreviewText({ text: '', kind: 'group_invite', invitation: { groupTitle: 'Squad' } as never })).toBe('Convite para o grupo Squad');
  });
  it('convite sem grupo é "indisponível", nunca "Anexo"', () => {
    expect(messagePreviewText({ text: '', kind: 'group_invite', invitation: null })).toBe('Convite indisponível');
  });
});
