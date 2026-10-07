const listeners = new Set<() => void>();

/** Called when the server answers an admin request with "not an administrator".
 * Kept apart from the API module so any request, from any page or dialog, can
 * raise it without the pages knowing about each other. */
export function reportAdminAccessLost(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeAdminAccessLost(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
