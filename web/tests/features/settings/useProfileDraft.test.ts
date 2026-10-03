import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useProfileDraft } from '@/features/settings/useProfileDraft';
import type { ProfileDraftFields } from '@/features/settings/useProfileDraft';

const baselineA: ProfileDraftFields = { displayName: 'Fulana', avatarColor: 'green', bio: 'original bio', profileLinks: [''] };
const baselineB: ProfileDraftFields = { displayName: 'Other name', avatarColor: 'blue', bio: 'different bio', profileLinks: ['https://x.com/other'] };

function setup(baseline: ProfileDraftFields, save = vi.fn().mockResolvedValue(undefined)) {
  const { result, rerender } = renderHook(({ baseline: b }) => useProfileDraft({ baseline: b, save }), {
    initialProps: { baseline },
  });
  return { result, rerender, save };
}

describe('useProfileDraft', () => {
  it('starts clean, with the draft equal to the baseline', () => {
    const { result } = setup(baselineA);
    expect(result.current.dirty).toBe(false);
    expect(result.current.draft).toEqual(baselineA);
  });

  it('editing a field marks it dirty; an empty, untouched link row does not count', () => {
    const { result } = setup(baselineA);
    act(() => result.current.setField('displayName', 'Fulana'));
    expect(result.current.dirty).toBe(false); // same value, still clean

    act(() => result.current.setField('bio', 'new bio'));
    expect(result.current.dirty).toBe(true);
  });

  it('adding then removing a link (back to the same normalized content) becomes clean again', () => {
    const { result } = setup(baselineA);
    act(() => result.current.setField('profileLinks', ['', 'https://x.com/new']));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setField('profileLinks', ['']));
    expect(result.current.dirty).toBe(false);
  });

  it('an external baseline change while clean simply follows the new baseline', () => {
    const { result, rerender } = setup(baselineA);
    rerender({ baseline: baselineB });
    expect(result.current.draft).toEqual(baselineB);
    expect(result.current.dirty).toBe(false);
    expect(result.current.conflict).toBe(false);
  });

  it('an external baseline change while dirty does not overwrite the draft — it only raises the conflict flag', () => {
    const { result, rerender } = setup(baselineA);
    act(() => result.current.setField('displayName', 'Editing now'));
    rerender({ baseline: baselineB });

    expect(result.current.draft.displayName).toBe('Editing now');
    expect(result.current.conflict).toBe(true);
  });

  it('using the saved values (applyIncoming) adopts the new baseline and clears the conflict', () => {
    const { result, rerender } = setup(baselineA);
    act(() => result.current.setField('displayName', 'Editing now'));
    rerender({ baseline: baselineB });
    expect(result.current.conflict).toBe(true);

    act(() => result.current.applyIncoming());
    expect(result.current.draft).toEqual(baselineB);
    expect(result.current.conflict).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('discarding resets the draft to the current baseline and clears error/conflict', () => {
    const { result } = setup(baselineA);
    act(() => result.current.setField('bio', 'lost draft'));
    act(() => result.current.discard());

    expect(result.current.draft).toEqual(baselineA);
    expect(result.current.dirty).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('a successful save sends the current draft and returns to idle', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = setup(baselineA, save);
    act(() => result.current.setField('bio', 'new bio'));

    await act(async () => { await result.current.save(); });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ bio: 'new bio' }));
    expect(result.current.saveState).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('a failed save keeps the error message and preserves the edited draft', async () => {
    const save = vi.fn().mockRejectedValue(new Error('failed'));
    const { result } = setup(baselineA, save);
    act(() => result.current.setField('bio', 'must not be lost'));

    await act(async () => {
      await expect(result.current.save()).rejects.toThrow('failed');
    });

    expect(result.current.saveState).toBe('error');
    expect(result.current.error).toBeTruthy();
    expect(result.current.draft.bio).toBe('must not be lost');
    expect(result.current.dirty).toBe(true);
  });

  it('only registers the beforeunload listener while something is dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { result } = setup(baselineA);

    expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));

    act(() => result.current.setField('bio', 'something new'));
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    act(() => result.current.discard());
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
