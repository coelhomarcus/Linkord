import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/shared/ui/primitives/button';

/** Copies an entity id. Its own button (never inside a link): the row link opens
 * the detail, this only touches the clipboard. */
export function CopyIdButton({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={copied ? 'ID copiado' : label} title={copied ? 'ID copiado' : label} onClick={() => void copy()}>
      {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
    </Button>
  );
}
