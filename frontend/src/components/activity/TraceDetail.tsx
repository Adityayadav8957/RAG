import { getBool, getHits, getNum, getStr, getStrArr } from "@/lib/trace";
import type { TraceEvent } from "@/lib/types";
import { Check, TriangleAlert } from "../icons";

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "ok" | "warn" | "err" | "accent" }) {
  const cls = { neutral: "bg-subtle text-muted", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", err: "bg-err-soft text-err", accent: "bg-accent-soft text-accent-text" }[tone];
  return <span className={`badge ${cls}`}>{children}</span>;
}

function Row({ tone, children }: { tone: "ok" | "warn" | "err"; children: React.ReactNode }) {
  const Icon = tone === "ok" ? Check : TriangleAlert;
  const cls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-err";
  return (
    <li className="flex items-start gap-1.5 text-xs">
      <Icon size={13} className={`mt-px flex-none ${cls}`} />
      <span className={tone === "ok" ? "text-muted" : "font-medium"}>{children}</span>
    </li>
  );
}

function Guardrail({ e, kind }: { e: TraceEvent; kind: "input" | "output" }) {
  const d = e.detail;
  const checks = getStrArr(d, "checks");
  const flags = getStrArr(d, kind === "input" ? "flags" : "reasons");
  const masked = getBool(d, "masked");
  const reason = getStr(d, "reason");
  const blocked = e.status === "blocked";
  if (!checks.length && !flags.length && !masked && !reason) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {reason && <Row tone="err">{blocked ? "Refused: " : ""}{reason}</Row>}
      {flags.map((f) => <Row key={f} tone={blocked ? "err" : "warn"}>{f}</Row>)}
      {masked && <Row tone="warn">Sensitive data was masked</Row>}
      {checks.map((c) => <Row key={c} tone="ok">{c}</Row>)}
    </ul>
  );
}

function Generic({ d }: { d: Record<string, unknown> }) {
  const rows = Object.entries(d).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v));
  if (!rows.length) return null;
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Human-readable rendering of a stage's `detail`; every field is optional. */
export function TraceDetail({ e }: { e: TraceEvent }) {
  const d = e.detail;
  switch (e.stage) {
    case "input":
    case "output":
      return <Guardrail e={e} kind={e.stage} />;
    case "intent": {
      const intent = getStr(d, "intent");
      const complexity = getStr(d, "complexity");
      const needs = getBool(d, "needs_knowledge");
      const summary = getStr(d, "summary");
      const provider = getStr(d, "provider");
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            {intent && <Chip tone={intent === "unsafe" ? "err" : "accent"}>{intent}</Chip>}
            {complexity && <Chip>{complexity} complexity</Chip>}
            {needs !== null && <Chip>{needs ? "needs company knowledge" : "no knowledge needed"}</Chip>}
          </div>
          {summary && <p className="m-0 text-xs leading-normal text-muted">{summary}</p>}
          {provider && <span className="text-[11px] text-faint">Classified by {provider}</span>}
        </div>
      );
    }
    case "cache": {
      const result = getStr(d, "result") ?? (e.status === "skipped" ? "skipped" : null);
      const note = getStr(d, "note");
      return (
        <div className="flex flex-wrap items-center gap-2">
          {result && <Chip tone={result === "hit" ? "ok" : "neutral"}>{result.toUpperCase()}</Chip>}
          {note && <span className="text-xs text-muted">{note}</span>}
        </div>
      );
    }
    case "router": {
      const model = getStr(d, "model");
      const tier = getStr(d, "tier");
      const why = getStr(d, "why");
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {model && <code className="font-mono text-xs">{model}</code>}
            {tier && <Chip tone={tier === "frontier" ? "accent" : "neutral"}>{tier}</Chip>}
          </div>
          {why && <p className="m-0 text-xs leading-normal text-muted">{why}</p>}
        </div>
      );
    }
    case "retrieval": {
      const hits = getHits(d);
      const method = getStr(d, "method");
      const dropped = getNum(d, "dropped_for_injection");
      return (
        <div className="flex flex-col gap-1.5">
          {method && <span className="text-xs text-muted">Method: {method}</span>}
          {hits.length > 0 && (
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {hits.map((h, i) => (
                <li key={`${h.n ?? i}-${h.title}`} className="flex items-start gap-2 text-xs">
                  {h.n !== null && (
                    <span className="grid h-[18px] min-w-[18px] flex-none place-items-center rounded-[5px] bg-accent-soft px-1 text-[11px] font-semibold text-accent-text">{h.n}</span>
                  )}
                  <span className="[overflow-wrap:anywhere]">{h.title}</span>
                </li>
              ))}
            </ol>
          )}
          {hits.length === 0 && e.status !== "running" && <span className="text-xs text-muted">No documents matched.</span>}
          {dropped !== null && dropped > 0 && (
            <p role="note" className="m-0 flex items-start gap-1.5 rounded-md bg-err-soft px-2 py-1.5 text-xs font-medium text-err">
              <TriangleAlert size={13} className="mt-px flex-none" />
              {dropped} {dropped === 1 ? "document was" : "documents were"} dropped as unsafe (possible prompt injection).
            </p>
          )}
        </div>
      );
    }
    case "llm": {
      const model = getStr(d, "model");
      const provider = getStr(d, "provider");
      const decided = getStr(d, "decided");
      const fallback = (provider ?? "").startsWith("fallback");
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {model && <code className="font-mono text-xs">{model}</code>}
            {provider && <span className="text-xs text-muted">via {provider}</span>}
            {fallback && <Chip tone="warn">Fallback model used</Chip>}
          </div>
          {e.status === "error" && <p className="m-0 text-xs font-medium text-err">Model call failed</p>}
          {decided && <p className="m-0 text-xs leading-normal text-muted">Decided: {decided}</p>}
        </div>
      );
    }
    case "tool": {
      const access = getStr(d, "access");
      const outcome = getStr(d, "outcome");
      const checked = getStr(d, "result_checked");
      const reason = getStr(d, "reason");
      const as = getStr(d, "on_behalf_of");
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {access && <Chip tone={access === "write" ? "warn" : "neutral"}>{access}</Chip>}
            {outcome && <Chip tone={outcome === "ok" ? "ok" : "err"}>{outcome === "ok" ? "succeeded" : "failed"}</Chip>}
            <span className="text-xs text-muted">Acting as you{as ? ` (${as})` : ""}, with your permissions</span>
          </div>
          {e.status === "blocked" && <p className="m-0 text-xs font-medium text-err">Denied by policy{reason ? `: ${reason}` : ""}</p>}
          {e.status !== "blocked" && reason && <p className="m-0 text-xs text-muted">{reason}</p>}
          {checked && <p className="m-0 flex items-start gap-1.5 text-xs text-muted"><Check size={13} className="mt-px flex-none text-ok" />Result checked: {checked}</p>}
        </div>
      );
    }
    case "approval": {
      const decision = getStr(d, "decision");
      const summary = getStr(d, "summary");
      const tool = getStr(d, "tool");
      const mins = getNum(d, "expires_in_minutes");
      return (
        <div className="flex flex-col gap-1.5">
          {summary && <p className="m-0 text-xs leading-normal">{summary}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {tool && <code className="font-mono text-xs text-muted">{tool}</code>}
            {decision && <Chip tone={decision === "approved" ? "ok" : "err"}>{decision}</Chip>}
            {e.status === "waiting" && <span className="text-xs text-warn">Nothing runs until you decide{mins !== null ? ` · expires in ${mins} min` : ""}</span>}
          </div>
        </div>
      );
    }
    case "validation": {
      const grounded = getBool(d, "grounded");
      const cites = getNum(d, "citations");
      const sources = getNum(d, "sources_retrieved");
      return (
        <div className="flex flex-wrap gap-1.5">
          {grounded !== null && <Chip tone={grounded ? "ok" : "warn"}>{grounded ? "Grounded in sources" : "Not grounded"}</Chip>}
          {cites !== null && <Chip>{cites} {cites === 1 ? "citation" : "citations"}</Chip>}
          {sources !== null && <Chip>{sources} sources retrieved</Chip>}
        </div>
      );
    }
    case "done": {
      const cached = getBool(d, "cached");
      return cached ? <Chip tone="ok">Served from cache</Chip> : null;
    }
    default:
      return <Generic d={d} />;
  }
}
