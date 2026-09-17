import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download } from 'lucide-react';
import type { ChatAttachment as ChatAttachmentData } from '@/shared/types/protocol';
import { DocumentAttachmentCard } from './DocumentAttachmentCard';
import { downloadFile } from './lib/download';
import { highlightCode } from './lib/highlightCode';

// react-markdown + remark-gfm + rehype-sanitize only load when a markdown
// file is actually previewed, not as part of the main bundle.
const MarkdownPreview = lazy(() => import('./MarkdownPreview'));

interface PreviewResponse {
  previewable: boolean;
  content?: string;
  truncated?: boolean;
  totalSize?: number;
  language?: string | null;
}

const COLLAPSED_MAX_HEIGHT = 220; // roughly 8-10 lines of monospace text
const MARKDOWN_STYLES = [
  'text-caption text-text-secondary',
  '[&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-body [&_h1]:font-semibold [&_h1]:text-text-primary [&_h1]:first:mt-0',
  '[&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-body [&_h2]:font-semibold [&_h2]:text-text-primary [&_h2]:first:mt-0',
  '[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-medium [&_h3]:text-text-primary [&_h3]:first:mt-0',
  '[&_p]:my-1',
  '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4',
  '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]',
  '[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/30 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-2 [&_blockquote]:text-text-muted',
  '[&_table]:my-1 [&_table]:w-full [&_th]:text-left [&_td]:border-t [&_td]:border-white/10 [&_td]:py-1 [&_th]:py-1',
  '[&_hr]:my-2 [&_hr]:border-white/10',
].join(' ');

function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

export function TextPreviewCard({ attachment, maxWidth }: { attachment: ChatAttachmentData; maxWidth?: number }) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fetchedRef = useRef(false);
  const markdown = isMarkdownFile(attachment.name);
  const url = `/uploads/${attachment.id}`;

  // Lazy fetch — only once the card actually scrolls into view, same spirit
  // as the `loading="lazy"` already used for image thumbnails.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || fetchedRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || fetchedRef.current) return;
      fetchedRef.current = true;
      observer.disconnect();
      fetch(`/api/attachments/${attachment.id}/preview`, { credentials: 'same-origin' })
        .then((res) => (res.ok ? res.json() as Promise<PreviewResponse> : { previewable: false }))
        .then(setPreview)
        .catch(() => setPreview({ previewable: false }));
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [attachment.id]);

  useEffect(() => {
    if (!preview?.previewable || !preview.content || markdown) return;
    let cancelled = false;
    highlightCode(preview.content, preview.language ?? null).then((html) => { if (!cancelled) setHighlightedHtml(html); });
    return () => { cancelled = true; };
  }, [preview, markdown]);

  return (
    <div ref={rootRef} style={{ maxWidth }} className="mt-1.5 w-full max-w-sm overflow-hidden rounded-xl border border-white/10 bg-bg-tertiary">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        download={attachment.name}
        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-bg-hover"
      >
        <DocumentAttachmentCard name={attachment.name} size={attachment.size} mime={attachment.mime} className="flex-1" />
        <Download size={16} className="flex-none text-text-muted" />
      </a>

      {preview?.previewable && preview.content && (
        <div className="border-t border-white/10">
          <div className="relative overflow-hidden px-3 py-2" style={{ maxHeight: expanded ? undefined : COLLAPSED_MAX_HEIGHT }}>
            {markdown ? (
              <Suspense fallback={<pre className="whitespace-pre-wrap wrap-break-word font-mono text-caption text-text-secondary">{preview.content}</pre>}>
                <MarkdownPreview content={preview.content} className={MARKDOWN_STYLES} />
              </Suspense>
            ) : highlightedHtml ? (
              <div
                className="text-caption [&_pre]:bg-transparent! [&_pre]:whitespace-pre-wrap [&_pre]:wrap-break-word [&_pre]:font-mono"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            ) : (
              <pre className="whitespace-pre-wrap wrap-break-word font-mono text-caption text-text-secondary">{preview.content}</pre>
            )}
            {!expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-bg-tertiary to-transparent" />
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-3 py-1.5 text-caption text-text-muted">
            <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 hover:text-text-primary">
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? 'Mostrar menos' : 'Mostrar mais'}
            </button>
            {preview.truncated && (
              <button type="button" onClick={() => downloadFile(url, attachment.name)} className="hover:text-text-primary">
                Baixar pra ver tudo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
