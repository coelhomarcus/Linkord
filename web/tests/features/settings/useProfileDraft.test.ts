import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useProfileDraft } from '@/features/settings/useProfileDraft';
import type { ProfileDraftFields } from '@/features/settings/useProfileDraft';

const baselineA: ProfileDraftFields = { displayName: 'Fulana', avatarColor: 'green', bio: 'bio original', profileLinks: [''] };
const baselineB: ProfileDraftFields = { displayName: 'Outro nome', avatarColor: 'blue', bio: 'bio diferente', profileLinks: ['https://x.com/outra'] };

function setup(baseline: ProfileDraftFields, save = vi.fn().mockResolvedValue(undefined)) {
  const { result, rerender } = renderHook(({ baseline: b }) => useProfileDraft({ baseline: b, save }), {
    initialProps: { baseline },
  });
  return { result, rerender, save };
}

describe('useProfileDraft', () => {
  it('comeca limpo, com o rascunho igual a base', () => {
    const { result } = setup(baselineA);
    expect(result.current.dirty).toBe(false);
    expect(result.current.draft).toEqual(baselineA);
  });

  it('editar um campo marca dirty; uma linha de link vazia e intocada nao conta', () => {
    const { result } = setup(baselineA);
    act(() => result.current.setField('displayName', 'Fulana'));
    expect(result.current.dirty).toBe(false); // same value, still clean

    act(() => result.current.setField('bio', 'bio nova'));
    expect(result.current.dirty).toBe(true);
  });

  it('adicionar e depois remover um link (voltando ao mesmo conteudo normalizado) volta a ficar limpo', () => {
    const { result } = setup(baselineA);
    act(() => result.current.setField('profileLinks', ['', 'https://x.com/nova']));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setField('profileLinks', ['']));
    expect(result.current.dirty).toBe(false);
  });

  it('mudanca externa da base enquanto limpo apenas segue a nova base', () => {
    const { result, rerender } = setup(baselineA);
    rerender({ baseline: baselineB });
    expect(result.current.draft).toEqual(baselineB);
    expect(result.current.dirty).toBe(false);
    expect(result.current.conflict).toBe(false);
  });

  it('mudanca externa da base enquanto sujo nao sobrescreve o rascunho — so acende o conflito', () => {
    const { result, rerender } = setup(baselineA);
    act(() => result.current.setField('displayName', 'Editando agora'));
    rerender({ baseline: baselineB });

    expect(result.current.draft.displayName).toBe('Editando agora');
    expect(result.current.conflict).toBe(true);
  });

  it('usar valores salvos (applyIncoming) adota a base nova e limpa o conflito', () => {
    const { result, rerender } = setup(baselineA);
    act(() => result.current.setField('displayName', 'Editando agora'));
    rerender({ baseline: baselineB });
    expect(result.current.conflict).toBe(true);

    act(() => result.current.applyIncoming());
    expect(result.current.draft).toEqual(baselineB);
    expect(result.current.conflict).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('descartar volta o rascunho a base atual e limpa erro/conflito', () => {
    const { result } = setup(baselineA);
    act(() => result.current.setField('bio', 'rascunho perdido'));
    act(() => result.current.discard());

    expect(result.current.draft).toEqual(baselineA);
    expect(result.current.dirty).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('salvar com sucesso manda o rascunho atual e volta a idle', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = setup(baselineA, save);
    act(() => result.current.setField('bio', 'bio nova'));

    await act(async () => { await result.current.save(); });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ bio: 'bio nova' }));
    expect(result.current.saveState).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('salvar com falha guarda a mensagem de erro e preserva o rascunho editado', async () => {
    const save = vi.fn().mockRejectedValue(new Error('falhou'));
    const { result } = setup(baselineA, save);
    act(() => result.current.setField('bio', 'nao pode se perder'));

    await act(async () => {
      await expect(result.current.save()).rejects.toThrow('falhou');
    });

    expect(result.current.saveState).toBe('error');
    expect(result.current.error).toBeTruthy();
    expect(result.current.draft.bio).toBe('nao pode se perder');
    expect(result.current.dirty).toBe(true);
  });

  it('so registra o listener de beforeunload enquanto ha algo sujo', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { result } = setup(baselineA);

    expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));

    act(() => result.current.setField('bio', 'algo novo'));
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    act(() => result.current.discard());
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
