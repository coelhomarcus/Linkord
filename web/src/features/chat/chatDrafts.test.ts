import { beforeEach, describe, expect, it } from 'vitest';
import { clearChatDraft, loadChatDraft, saveChatDraft } from './chatDrafts';

describe('chatDrafts', () => {
  beforeEach(() => localStorage.clear());

  it('persiste rascunhos separadamente por canal', () => {
    saveChatDraft('canal-1', 'mensagem um');
    saveChatDraft('canal-2', 'mensagem dois');
    expect(loadChatDraft('canal-1')).toBe('mensagem um');
    expect(loadChatDraft('canal-2')).toBe('mensagem dois');
  });

  it('remove o item ao limpar ou salvar texto vazio', () => {
    saveChatDraft('canal-1', 'texto');
    clearChatDraft('canal-1');
    expect(loadChatDraft('canal-1')).toBe('');
    saveChatDraft('canal-1', 'outro');
    saveChatDraft('canal-1', '');
    expect(loadChatDraft('canal-1')).toBe('');
  });

  it('limita o tamanho recuperado ao teto do composer', () => {
    saveChatDraft('canal-1', 'x'.repeat(2500));
    expect(loadChatDraft('canal-1')).toHaveLength(2000);
  });
});
