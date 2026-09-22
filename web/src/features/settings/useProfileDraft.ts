import { useEffect, useRef, useState } from 'react';
import { describeProfileSaveError } from '@/features/profile/useProfileUpdate';

export interface ProfileDraftFields {
  displayName: string;
  avatarColor: string;
  bio: string;
  profileLinks: string[];
}

/** What actually gets compared and sent — trims and drops the empty
 * trailing link row the editor keeps around for "add another link", so an
 * untouched blank row never counts as an edit. */
export function normalizeProfileDraftFields(fields: ProfileDraftFields): ProfileDraftFields {
  return { ...fields, profileLinks: fields.profileLinks.map((link) => link.trim()).filter(Boolean) };
}

function fieldsEqual(a: ProfileDraftFields, b: ProfileDraftFields): boolean {
  const na = normalizeProfileDraftFields(a);
  const nb = normalizeProfileDraftFields(b);
  return na.displayName === nb.displayName
    && na.avatarColor === nb.avatarColor
    && na.bio === nb.bio
    && na.profileLinks.length === nb.profileLinks.length
    && na.profileLinks.every((link, i) => link === nb.profileLinks[i]);
}

export type ProfileDraftSaveState = 'idle' | 'saving' | 'error';

interface UseProfileDraftOptions {
  /** The last server-confirmed values — recomputed by the caller from `state.me`. */
  baseline: ProfileDraftFields;
  /** Persists the draft (merged with whatever else the caller needs, e.g.
   * the current avatar/banner) — resolves only once the server confirms it. */
  save: (fields: ProfileDraftFields) => Promise<unknown>;
}

/** The draft/baseline/saveState model from docs/plan-codex/settings-redesign
 * §9.2: a confirmed save is the only thing allowed to move `dirty` back to
 * false, and an external update never clobbers an in-progress local edit. */
export function useProfileDraft({ baseline, save: doSave }: UseProfileDraftOptions) {
  const [draft, setDraft] = useState(baseline);
  const [saveState, setSaveState] = useState<ProfileDraftSaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  // Baseline changed to something the current draft didn't itself just
  // produce (another session, or a peer's profile-only push doesn't apply
  // here, but keep the guard cheap and general) while there were unsaved
  // edits — surfaced next to the save bar instead of silently overwritten.
  const [conflict, setConflict] = useState(false);
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const baselineRef = useRef(baseline);

  useEffect(() => {
    const prevBaseline = baselineRef.current;
    baselineRef.current = baseline;
    if (fieldsEqual(prevBaseline, baseline)) return;
    if (fieldsEqual(draftRef.current, prevBaseline)) {
      setDraft(baseline);
    } else {
      setConflict(true);
    }
  }, [baseline]);

  function setField<K extends keyof ProfileDraftFields>(key: K, value: ProfileDraftFields[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const dirty = !fieldsEqual(draft, baseline);

  async function save() {
    setSaveState('saving');
    setError(null);
    try {
      await doSave(draft);
      setSaveState('idle');
      setConflict(false);
    } catch (err) {
      setSaveState('error');
      setError(describeProfileSaveError(err));
      throw err;
    }
  }

  function discard() {
    setDraft(baseline);
    setSaveState('idle');
    setError(null);
    setConflict(false);
  }

  /** Conflict resolution: adopt the newer confirmed values, discarding the
   * local edit instead of saving over it. */
  function applyIncoming() {
    setDraft(baseline);
    setConflict(false);
  }

  // Reload/close tab: only a concern while something is actually unsaved,
  // so the listener is added/removed with `dirty` rather than always-on.
  // Separate from App.tsx's own beforeunload guard for an active call.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return { draft, setField, dirty, saveState, error, conflict, save, discard, applyIncoming };
}
