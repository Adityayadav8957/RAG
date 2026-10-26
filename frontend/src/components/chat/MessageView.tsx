"use client";

import dynamic from "next/dynamic";
import { memo, useState } from "react";
import { Activity, BookOpen, Check, ChevronDown, ChevronUp, Copy, FileText } from "../icons";
import { DobbyBurst } from "../DobbyBurst";
import { Skel } from "../skeletons";
import type { Step, UiMessage } from "./types";

// react-markdown is heavy and only needed once there is an answer to render, so it loads as a separate chunk.
const Markdown = dynamic(() => import("../Markdown").then((m) => m.Markdown), {
  ssr: false,
  loading: () => (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <Skel className="h-[14px] w-full" />
      <Skel className="h-[14px] w-2/3" />
    </div>
  ),
});

function StepIcon({ state }: { state: Step["state"] }) {
  const mood = state === "run" ? "thinking" : state === "done" ? "success" : "error";
  return <DobbyBurst size={18} mood={mood} />;
}

function Steps({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <ul role="status" aria-live="polite" className="m-0 flex list-none flex-col gap-1.5 p-0">
      {steps.map((s, i) => (
        <li key={`${i}-${s.label}`} className="flex items-center gap-2 text-[13px] text-muted">
          <StepIcon state={s.state} />
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Sources({ message, onOpen }: { message: UiMessage; onOpen: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const count = message.citations.length;
  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-[38px] w-full items-center justify-between border-none bg-surface px-3 text-[13px] font-medium text-muted hover:bg-subtle"
      >
        <span className="flex items-center gap-2">
          <FileText size={16} />
          {count} {count === 1 ? "source" : "sources"}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <ol className="m-0 list-none border-t border-border p-0">
          {message.citations.map((c) => (
            <li key={c.n} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(c.n)}
                className="grid w-full grid-cols-[22px_minmax(0,1fr)] gap-2.5 border-none bg-surface px-3 py-2.5 text-left hover:bg-subtle"
              >
                <span className="mt-0.5 grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-accent-soft text-[11px] font-semibold text-accent-text">
                  {c.n}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-semibold">{c.title}</span>
                  <span className="line-clamp-2 text-xs text-faint">{c.excerpt}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CopyButton({ text, onCopied }: { text: string; onCopied: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied();
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context or denied) */
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label="Copy response"
      title="Copy"
      className="-ml-1.5 flex h-[30px] items-center gap-1.5 rounded-md border-none bg-transparent px-2 text-xs text-faint transition-colors hover:bg-hover hover:text-ink"
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export const MessageView = memo(function MessageView({
  message, onOpenCitation, onOpenActivity, onAnnounce,
}: {
  message: UiMessage;
  onOpenCitation: (messageKey: string, n: number) => void;
  onOpenActivity: (messageKey: string) => void;
  onAnnounce: (text: string) => void;
}) {
  if (message.role === "user") {
    return (
      <article aria-label="You said" className="flex flex-col gap-2.5">
        <div className="max-w-[82%] self-end whitespace-pre-wrap rounded-[14px] border border-border bg-subtle px-3.5 py-2.5 text-[15px] leading-[1.55] [overflow-wrap:anywhere] [text-wrap:pretty]">
          {message.text}
        </div>
      </article>
    );
  }
  const count = message.citations.length;
  const open = (n: number) => onOpenCitation(message.key, n);
  return (
    <article aria-label="Assistant response" className="flex flex-col gap-3">
      {!message.text && <Steps steps={message.steps} />}
      {count > 0 && (
        <span className="inline-flex max-w-full items-center gap-1.5 self-start whitespace-nowrap rounded-md bg-accent-soft px-2 py-[3px] text-xs font-medium text-accent-text">
          <BookOpen size={14} />
          <span>
            From company knowledge · {count} {count === 1 ? "source" : "sources"}
          </span>
        </span>
      )}
      {message.text && <Markdown text={message.text} citations={message.citations} onOpenCitation={open} streaming={message.streaming} />}
      {count > 0 && !message.streaming && <Sources message={message} onOpen={open} />}
      {!message.streaming && (message.text || message.trace.length > 0) && (
        <div className="-mb-1 flex items-center gap-0.5 text-faint">
          {message.text && <CopyButton text={message.text} onCopied={() => onAnnounce("Response copied")} />}
          {message.trace.length > 0 && (
            <button
              type="button"
              onClick={() => onOpenActivity(message.key)}
              className="flex h-[30px] items-center gap-1.5 rounded-md border-none bg-transparent px-2 text-xs text-faint transition-colors hover:bg-hover hover:text-ink"
            >
              <Activity size={16} />
              Activity
            </button>
          )}
          {message.stopped && <span className="ml-1.5 text-xs">Stopped</span>}
        </div>
      )}
    </article>
  );
});
