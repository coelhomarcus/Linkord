import { useEffect } from 'react';

export type Feedback = { tone: 'success' | 'error'; text: string } | null;

/** Result of the last action on a list. Lives OUTSIDE the loading/empty/error
 * branches of the list, so a refresh (or the list becoming empty) can't make it
 * vanish. A success clears itself; an error stays until the next action. */
export function ActionFeedback({ feedback, onClear }: { feedback: Feedback; onClear: () => void }) {
  useEffect(() => {
    if (feedback?.tone !== 'success') return;
    const timer = setTimeout(onClear, 4000);
    return () => clearTimeout(timer);
  }, [feedback, onClear]);

  if (!feedback) return null;
  return feedback.tone === 'error'
    ? <p role="alert" className="rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">{feedback.text}</p>
    : <p role="status" className="rounded-md bg-green/12 px-2.5 py-1.5 text-label text-green">{feedback.text}</p>;
}
