import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

// Split into its own chunk (see TextPreviewCard's React.lazy import of this
// module) — react-markdown + remark-gfm + rehype-sanitize only cost bytes
// for a viewer who actually opens a markdown preview, not the main bundle.
export default function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
    </div>
  );
}
