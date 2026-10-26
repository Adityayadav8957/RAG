import { ChartColumn } from "../icons";

const METRICS = ["Requests", "Cache hit rate", "Latency", "Estimated cost", "Model routing", "Token usage"];

/** The backend has no telemetry endpoint, so this section is an honest empty state rather than sample data. */
export function UsageUnavailable() {
  return (
    <section aria-labelledby="usage-h" className="flex flex-col gap-3">
      <h2 id="usage-h" className="m-0 text-base font-semibold">Model routing &amp; usage</h2>
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface px-5 py-8 text-center">
        <ChartColumn size={22} className="text-faint" />
        <span className="text-sm font-semibold">Not available yet</span>
        <p className="m-0 max-w-[520px] text-[13px] leading-normal text-muted">
          The backend does not expose usage, latency, token, cost or model-routing metrics yet, so none are shown here. Nothing on this
          page is estimated or sample data.
        </p>
        <ul className="m-0 mt-1 flex list-none flex-wrap justify-center gap-1.5 p-0" aria-label="Metrics that are not available">
          {METRICS.map((m) => (
            <li key={m} className="rounded-[5px] border border-border px-[7px] py-0.5 text-xs italic text-faint">
              {m}: Unavailable
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
