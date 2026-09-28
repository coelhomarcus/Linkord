import { createContext, useContext } from 'react';
import type { ViewerItem } from '@/features/media/MediaCollectionViewer';

export interface MediaViewerApi {
  open: (items: ViewerItem[], index: number) => void;
}

export const MediaViewerContext = createContext<MediaViewerApi | null>(null);

/** Null outside a chat surface (e.g. a row rendered on its own in a test). */
export function useMediaViewer(): MediaViewerApi | null {
  return useContext(MediaViewerContext);
}
