type Listener = () => void;
const accessLost = new Set<Listener>();
const sessionEnded = new Set<Listener>();

const notify = (listeners: Set<Listener>) => { for (const listener of [...listeners]) listener(); };
const subscribe = (listeners: Set<Listener>, listener: Listener) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

// Two different losses, raised from any request of any page or dialog without
// the pages knowing about each other (the area reacts as a whole):
//  - access lost: the server answered 403 "not an administrator" — the session
//    is fine, the account is not an admin (anymore);
//  - session ended: the server answered 401 — there is no session at all.

/** A 403 `forbidden` on an admin request. */
export function reportAdminAccessLost(): void { notify(accessLost); }
export function subscribeAdminAccessLost(listener: Listener): () => void { return subscribe(accessLost, listener); }

/** A 401 on an admin request. */
export function reportAdminSessionEnded(): void { notify(sessionEnded); }
export function subscribeAdminSessionEnded(listener: Listener): () => void { return subscribe(sessionEnded, listener); }
