// Leaf module (no imports): serializes profile edits per account, so two tabs
// of the same account patching their profile in close succession apply in
// order against a consistent base — the second call only reads `p.*` after
// the first one's persistence (and in-memory update) has actually landed.
// Without this, both read the same stale base and the one that resolves
// second can silently undo a field the other just confirmed.

const queues = new Map<string, Promise<unknown>>();

export function runSerialized<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const next = previous.then(task, task);
  // swallow so a rejection doesn't pin the queue forever or become an
  // unhandled rejection from the map holding a reference to it
  const settled = next.catch(() => {});
  queues.set(userId, settled);
  // drop the entry once idle — nobody queued behind us — instead of keeping
  // one Promise per account that has ever edited a profile for the process' life
  settled.then(() => { if (queues.get(userId) === settled) queues.delete(userId); });
  return next;
}
