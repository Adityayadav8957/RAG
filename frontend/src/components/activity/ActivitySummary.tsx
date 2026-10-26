import { formatMs, type Segment, type Summary } from "@/lib/trace";

const COLORS: Record<string, string> = {
  input: "bg-ok", intent: "bg-accent", cache: "bg-warn", router: "bg-accent-text", work: "bg-ok", validation: "bg-warn", output: "bg-faint", other: "bg-border-strong",
};

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-2.5 py-2">
      <span className="text-[11px] text-muted">{k}</span>
      <span className="text-[13px] font-semibold tabular-nums">{v}</span>
    </div>
  );
}

export function ActivitySummary({ summary, segments, totalMs }: { summary: Summary; segments: Segment[]; totalMs: number }) {
  const cache = summary.cache === "hit" ? "Hit" : summary.cache === "miss" ? "Miss" : summary.cache === "skipped" ? "Skipped" : "—";
  return (
    <section aria-label="Summary" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat k={summary.finished ? "Total time" : "Elapsed so far"} v={summary.totalMs !== null ? formatMs(summary.totalMs) : "—"} />
        <Stat k="Model calls" v={String(summary.modelCalls)} />
        <Stat k="Cache" v={cache} />
        <Stat k="Sources" v={summary.sources !== null ? String(summary.sources) : "—"} />
      </div>
      {(summary.blocked > 0 || summary.fallbackUsed) && (
        <p className="m-0 text-xs text-muted">
          {summary.blocked > 0 && <span className="font-medium text-err">{summary.blocked} {summary.blocked === 1 ? "step" : "steps"} blocked. </span>}
          {summary.fallbackUsed && <span className="font-medium text-warn">A fallback model was used.</span>}
        </p>
      )}
      {segments.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 text-xs font-semibold text-faint">Time by stage</h3>
          <div role="img" aria-label={`Time by stage out of ${formatMs(totalMs)}: ${segments.map((s) => `${s.label} ${formatMs(s.ms)}`).join(", ")}`} className="flex h-2 overflow-hidden rounded-full bg-subtle">
            {segments.map((s) => (
              <span key={s.key} title={`${s.label}: ${formatMs(s.ms)}`} style={{ width: `${s.pct}%` }} className={`h-full ${COLORS[s.key] ?? "bg-faint"} border-r border-surface last:border-r-0`} />
            ))}
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[11px] text-muted">
            {segments.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${COLORS[s.key] ?? "bg-faint"}`} />
                {s.label} <span className="font-mono text-faint">{formatMs(s.ms)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
