import { memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type Props = {
  children: string;
};

function MarkdownImpl({ children }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={{
        p: ({ children }) => (
          <p className="leading-relaxed text-[14.5px] text-ink">{children}</p>
        ),
        h1: ({ children }) => (
          <h1 className="mt-6 mb-3 text-xl font-semibold tracking-tight text-ink">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mt-5 mb-2 text-lg font-semibold tracking-tight text-ink">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-4 mb-2 text-base font-semibold tracking-tight text-ink">{children}</h3>
        ),
        ul: ({ children }) => (
          <ul className="my-2 ml-5 list-disc space-y-1 text-[14.5px] text-ink">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2 ml-5 list-decimal space-y-1 text-[14.5px] text-ink">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-3 border-l-2 border-accent/50 pl-3 italic text-ink-2">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-4 border-rule" />,
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-md border border-rule">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-surface/60">{children}</thead>,
        th: ({ children }) => (
          <th className="border-b border-rule px-3 py-2 text-left font-medium text-ink">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-rule/60 px-3 py-2 text-ink">{children}</td>
        ),
        code: ({ className, children }: { className?: string; children?: ReactNode }) => {
          const isBlock = typeof className === "string" && className.includes("language-");
          if (isBlock) {
            return <code className={className}>{children}</code>;
          }
          return (
            <code className="rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[0.85em] text-accent-deep">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-3 overflow-x-auto rounded-md border border-rule bg-surface/60 p-4 font-mono text-[13px] leading-relaxed text-ink">
            {children}
          </pre>
        ),
        strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
        em: ({ children }) => <em className="italic text-ink-2">{children}</em>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export const Markdown = memo(MarkdownImpl);
