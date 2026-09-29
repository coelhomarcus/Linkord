import { describe, expect, it } from 'vitest';
import { messagePreviewText } from '@/features/chat/messagePreview';

describe('messagePreviewText', () => {
  it('uses the text when it exists', () => expect(messagePreviewText({ text: 'oi' })).toBe('oi'));
  it('falls back to "Anexo" for empty text', () => expect(messagePreviewText({ text: '' })).toBe('Anexo'));
  it('names the group in an invitation', () => {
    expect(messagePreviewText({ text: '', kind: 'group_invite', invitation: { groupTitle: 'Squad' } as never })).toBe('Convite para o grupo Squad');
  });
  it('an invitation with no group is "indisponível", never "Anexo"', () => {
    expect(messagePreviewText({ text: '', kind: 'group_invite', invitation: null })).toBe('Convite indisponível');
  });
});
