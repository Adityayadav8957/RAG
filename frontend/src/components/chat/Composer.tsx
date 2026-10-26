"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Square } from "../icons";

export const MAX_LEN = 20000;

export function Composer({
  value, onChange, onSend, onStop, streaming,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(200, t.scrollHeight)}px`;
    t.style.overflowY = t.scrollHeight > 200 ? "auto" : "hidden";
  }, [value]);

  const tooLong = value.length > MAX_LEN;
  const canSend = value.trim().length > 0 && !tooLong;
  return (
    <div className="flex-none px-5 pb-4 max-sm:px-3">
      <form
        className="mx-auto flex max-w-[740px] flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!streaming) onSend();
        }}
      >
        <div className="flex items-end gap-2 rounded-[14px] border border-border-strong bg-surface p-2 shadow-pop">
          <label htmlFor="composer" className="sr-only">
            Message
          </label>
          <textarea
            id="composer"
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!streaming && canSend) onSend();
              }
            }}
            placeholder="Ask anything about your work…"
            aria-invalid={tooLong}
            className="max-h-[200px] min-w-0 flex-1 resize-none self-center border-none bg-transparent px-1 py-[7px] text-[15px] leading-normal outline-none focus-visible:outline-none"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop generating"
              className="grid h-9 w-9 flex-none place-items-center rounded-lg border-none bg-ink text-bg"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              title="Send (Enter)"
              className="grid h-9 w-9 flex-none place-items-center rounded-lg border-none bg-accent text-accent-ink transition-opacity disabled:opacity-40"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        {tooLong && (
          <p role="alert" className="m-0 text-center text-xs text-err">
            Message is too long ({value.length}/{MAX_LEN}).
          </p>
        )}
        <p className="m-0 text-center text-xs text-faint">
          Enter to send · Shift+Enter for a new line · Actions that change data always ask first
        </p>
      </form>
    </div>
  );
}
