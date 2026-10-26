"use client";

import { DobbyMark } from "../DobbyMark";
import { useUser } from "../UserProvider";
import { BookOpen, KeyRound, ListChecks, Newspaper, type IconProps } from "../icons";

const PROMPTS: { text: string; Icon: (p: IconProps) => React.ReactElement }[] = [
  { text: "Summarize our leave policy", Icon: BookOpen },
  { text: "Find my open Jira tickets", Icon: ListChecks },
  { text: "How do I request access to a repository?", Icon: KeyRound },
  { text: "Summarize the latest project updates", Icon: Newspaper },
];

export function Welcome({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  const { user } = useUser();
  const first = (user?.name || "").trim().split(/\s+/)[0];
  return (
    <div className="flex flex-col gap-3 pt-[8vh]">
      <div className="mb-1.5 flex items-center gap-3">
        <DobbyMark size={64} />
        <span className="text-[15px] font-medium text-muted">{first ? `Hi ${first}, I'm Dobby.` : "Hi, I'm Dobby."}</span>
      </div>
      <h2 className="m-0 text-[32px] font-semibold leading-[1.15] tracking-[-0.025em]">Your work, connected.</h2>
      <p className="m-0 max-w-[520px] text-[15px] leading-[1.6] text-muted [text-wrap:pretty]">
        Ask questions about company knowledge, find information across connected tools, or get help completing everyday tasks.
      </p>
      <div className="mt-[22px] grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-2">
        {PROMPTS.map(({ text, Icon }) => (
          <button
            key={text}
            type="button"
            disabled={disabled}
            onClick={() => onPick(text)}
            className="flex items-center gap-3 rounded-[10px] border border-border bg-surface px-3.5 py-[13px] text-left text-sm transition-colors hover:border-border-strong hover:bg-subtle disabled:opacity-50"
          >
            <Icon size={16} className="flex-none text-faint" />
            <span className="flex-1">{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
