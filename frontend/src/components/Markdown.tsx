import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { CopyButton } from './ui';

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) return extractText((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-vantara">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre({ children }) {
            return (
              <div className="group relative">
                <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"><CopyButton text={extractText(children)} label="Copy code" /></div>
                <pre>{children}</pre>
              </div>
            );
          },
          a({ children, href }) {
            return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
