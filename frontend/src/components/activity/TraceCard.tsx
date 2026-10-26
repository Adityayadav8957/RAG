import { formatMs } from "@/lib/trace";
import type { TraceEvent } from "@/lib/types";
import { Activity, Compass, Cpu, Database, Flag, Route, ShieldAlert, ShieldCheck, UserCheck, Wrench, Zap, CircleCheck, type IconProps } from "../icons";
import { STATUS } from "./status";
import { TraceDetail } from "./TraceDetail";

const ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  input: ShieldCheck, output: ShieldCheck, intent: Compass, cache: Zap, router: Route,
  retrieval: Database, llm: Cpu, tool: Wrench, approval: UserCheck, validation: CircleCheck, done: Flag,
};

const FRAME: Record<string, string> = {
  blocked: "border-err bg-err-soft",
  error: "border-err bg-err-soft",
  waiting: "border-warn bg-warn-soft",
  running: "border-accent",
};

/** `compact` is for cards already nested under a stage row: it drops what the row says (title, "Done", stage and step number). */
export function TraceCard({ event, animate, compact = false, showTitle = true }: { event: TraceEvent; animate: boolean; compact?: boolean; showTitle?: boolean }) {
  const s = STATUS[event.status];
  const danger = event.status === "blocked" || event.status === "error";
  const Icon = danger ? ShieldAlert : (ICONS[event.stage] ?? Activity);
  return (
    <li className={`${animate ? "trace-enter " : ""}relative flex flex-col gap-2 rounded-[10px] border bg-surface px-3 py-2.5 ${FRAME[event.status] ?? "border-border"}`}>
      {(!compact || showTitle || !["done", "skipped"].includes(event.status)) && (
        <div className="flex items-center gap-2">
          {(!compact || showTitle) && <Icon size={15} className={`flex-none ${danger ? "text-err" : "text-muted"}`} />}
          {(!compact || showTitle) && <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={event.title}>{event.title}</span>}
          {(!compact || !["done", "skipped"].includes(event.status)) && (
            <span className={`badge flex-none ${compact && !showTitle ? "ml-auto " : ""}${s.chip}`}>
              <s.Icon size={12} className={s.spin ? "spin" : ""} />
              {s.label}
            </span>
          )}
        </div>
      )}
      <TraceDetail e={event} />
      <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
        {!compact && <span className="font-mono">{event.stage} · #{event.seq}</span>}
        <span className="ml-auto font-mono">{event.ms !== null ? `${formatMs(event.ms)} · ` : ""}t+{formatMs(event.at_ms) || "0 ms"}</span>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted hover:text-ink">Show raw</summary>
        <pre className="mt-1.5 max-h-56 overflow-auto rounded-md bg-subtle p-2 font-mono text-[11px] leading-normal">{JSON.stringify(event, null, 2)}</pre>
      </details>
    </li>
  );
}
