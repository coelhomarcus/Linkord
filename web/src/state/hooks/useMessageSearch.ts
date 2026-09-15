import { useCallback, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage, SearchResult } from '../../types/protocol';

/** Full-text message search — entirely self-contained (its own request/
 * response round-trip, no shared state with any other domain). */
export function useMessageSearch(sendWs: (msg: ClientMessage) => void) {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const pendingSearchRef = useRef<{ query: string; conversationId?: string } | null>(null);
  const clearSearchError = useCallback(() => setSearchError(null), []);

  const searchMessages = useCallback((query: string, conversationId?: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      pendingSearchRef.current = null;
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    pendingSearchRef.current = { query: trimmed, conversationId };
    setSearchLoading(true);
    sendWs({ t: 'message-search', query: trimmed, ...(conversationId ? { conversationId } : {}) });
  }, [sendWs]);

  const onMessageSearchResults = useCallback((m: Extract<ServerMessage, { t: 'message-search-results' }>) => {
    const pending = pendingSearchRef.current;
    if (!pending || pending.query !== m.query || pending.conversationId !== m.conversationId) return;
    setSearchResults(m.results);
    setSearchLoading(false);
  }, []);

  /** For 'message-not-found' (a search result pointing at a since-deleted
   * message) — surfaced as a search error since that's where the click
   * originated. */
  const setSearchErrorMessage = useCallback((message: string) => setSearchError(message), []);

  return {
    searchResults, searchLoading, searchError, clearSearchError, searchMessages,
    onMessageSearchResults, setSearchErrorMessage,
  };
}
