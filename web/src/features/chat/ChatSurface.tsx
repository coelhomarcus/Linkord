import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { ChatSurfaceWidthProvider, useMeasuredWidth } from '@/shared/lib/chatSurfaceWidth';
import { useRoom } from '@/state/RoomContext';
import { DirectComposerGate } from '@/features/friends/DirectComposerGate';
import { MessageComposer, type MessageComposerHandle } from './MessageComposer';
import { MessageTimeline } from './MessageTimeline';
import { TypingIndicator } from './TypingIndicator';
import { MediaViewerProvider } from './MediaViewerProvider';

// Typing lives in a fixed-height rail above the composer, outside the box
// the ResizeObserver measures: someone starting or stopping typing must not
// change the list's bottom padding, or a list pinned to the bottom jumps.
const STATUS_RAIL_HEIGHT = 24;

function hasFiles(e: DragEvent<HTMLDivElement>): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

export function ChatSurface({ conversationId, onOpenProfile }: { conversationId: string; onOpenProfile: (userId: string) => void }) {
  const { state, setReplyingTo } = useRoom();
  const composerRef = useRef<MessageComposerHandle>(null);
  const composerWrapRef = useRef<HTMLDivElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  // measured rather than assumed: the same surface renders in the main panel
  // and in the call's side panel, whose width isn't a fixed constant either
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceWidth = useMeasuredWidth(rootRef);

  useEffect(() => {
    const el = composerWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.height;
      if (next != null) setComposerHeight(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) composerRef.current?.addFiles(files);
  }

  return (
    <div
      ref={rootRef}
      className="@container/chat relative flex min-h-0 flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ChatSurfaceWidthProvider width={surfaceWidth}>
        <MediaViewerProvider>
          <MessageTimeline key={conversationId} conversationId={conversationId} onReply={setReplyingTo} onOpenProfile={onOpenProfile} bottomPadding={composerHeight + STATUS_RAIL_HEIGHT + 8} />
        </MediaViewerProvider>
      </ChatSurfaceWidthProvider>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-bg-primary to-transparent"
        style={{ height: composerHeight + STATUS_RAIL_HEIGHT + 24 }}
      />
      <div className="pointer-events-none absolute inset-x-0" style={{ bottom: composerHeight, height: STATUS_RAIL_HEIGHT }}>
        <TypingIndicator conversationId={conversationId} />
      </div>
      <div ref={composerWrapRef} className="absolute inset-x-0 bottom-0">
        <DirectComposerGate conversationId={conversationId}>
          <MessageComposer ref={composerRef} conversationId={conversationId} />
        </DirectComposerGate>
      </div>
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 m-2 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-bg-primary/90 text-text-primary">
          <Upload size={28} className="text-primary" />
          <p className="text-body font-medium">Solte para anexar</p>
        </div>
      )}
    </div>
  );
}
