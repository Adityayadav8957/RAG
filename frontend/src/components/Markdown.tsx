"use client";

import { useMemo, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { Citation } from "@/lib/types";

const CITE_PREFIX = "#cite-";

function CitationChip({ n, citation, onOpen }: { n: number; citation?: Citation; onOpen: (n: number) => void }) {
  return (
    <button
      type="button"
      aria-label={citation ? `Source ${n}: ${citation.title}` : `Source ${n}`}
      title={citation?.title}
      onClick={() => onOpen(n)}
      className="ml-[3px] inline-grid h-[18px] min-w-[18px] place-items-center rounded-[5px] border-none bg-accent-soft px-1 align-[2px] text-[11px] font-semibold text-accent-text transition-colors hover:bg-accent hover:text-accent-ink"
    >
      {n}
    </button>
  );
}

export function Markdown({
  text, citations, onOpenCitation, streaming = false,
}: {
  text: string;
  citations: Citation[];
  onOpenCitation: (n: number) => void;
  streaming?: boolean;
}) {
  const source = useMemo(
    () => text.replace(/\[(\d{1,3})\](?!\()/g, (m, n: string) => (citations.some((c) => c.n === Number(n)) ? `[${n}](${CITE_PREFIX}${n})` : m)),
    [text, citations],
  );
  const components = useMemo<Components>(
    () => ({
      a({ href, children }: ComponentProps<"a">) {
        if (href?.startsWith(CITE_PREFIX)) {
          const n = Number(href.slice(CITE_PREFIX.length));
          return <CitationChip n={n} citation={citations.find((c) => c.n === n)} onOpen={onOpenCitation} />;
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
      img: () => null,
    }),
    [citations, onOpenCitation],
  );
  return (
    <div className={`prose-chat${streaming ? " streaming" : ""}`}>
      <ReactMarkdown components={components}>{source}</ReactMarkdown>
    </div>
  );
}
