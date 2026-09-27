import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { MediaCollectionViewer, type ViewerItem } from '@/features/media/MediaCollectionViewer';
import { MediaViewerContext } from './useMediaViewer';

/** One viewer per chat surface, above the rows: a row scrolled away (or,
 * later, unmounted by virtualization) must not close what it opened. */
export function MediaViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const open = useCallback((items: ViewerItem[], index: number) => setState({ items, index }), []);
  const api = useMemo(() => ({ open }), [open]);
  return (
    <MediaViewerContext.Provider value={api}>
      {children}
      <MediaCollectionViewer
        items={state?.items ?? []}
        index={state?.index ?? 0}
        open={state !== null}
        onIndexChange={(index) => setState((prev) => (prev ? { ...prev, index } : prev))}
        onOpenChange={(next) => { if (!next) setState(null); }}
      />
    </MediaViewerContext.Provider>
  );
}
