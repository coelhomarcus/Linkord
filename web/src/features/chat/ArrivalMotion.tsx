import { useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { takeArrival } from './arrivals';

/** The entrance of a message that just arrived — on this inner element,
 * never on the row the virtualizer positions and measures (a transform
 * there would fight its own). Decided once, when the row mounts. */
export function ArrivalMotion({ surfaceId, itemKey, children }: { surfaceId: string; itemKey: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [animate] = useState(() => takeArrival(surfaceId, itemKey));
  if (!animate) return <>{children}</>;
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.16, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
