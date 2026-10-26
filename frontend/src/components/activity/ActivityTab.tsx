"use client";

import { useMemo } from "react";
import { latencySegments, pipelineNodes, summarize, visibleEvents } from "@/lib/trace";
import type { TraceEvent } from "@/lib/types";
import { Activity } from "../icons";
import { ActivitySummary } from "./ActivitySummary";
import { StageList } from "./StageList";

export function ActivityTab({ trace, live }: { trace: TraceEvent[]; live: boolean }) {
  const view = useMemo(() => {
    const seg = latencySegments(trace);
    return { nodes: pipelineNodes(trace), events: visibleEvents(trace), summary: summarize(trace), segments: seg.segments, totalMs: seg.totalMs };
  }, [trace]);

  if (trace.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-2 py-10 text-center">
        <Activity size={22} className="text-faint" />
        <span className="text-sm font-semibold">{live ? "Waiting for the first step…" : "No activity recorded"}</span>
        <p className="m-0 max-w-[260px] text-xs leading-normal text-muted">
          {live ? "Steps appear here as the agent works." : "This message has no stored agent activity."}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <StageList nodes={view.nodes} events={view.events} live={live} />
      <ActivitySummary summary={view.summary} segments={view.segments} totalMs={view.totalMs} />
    </div>
  );
}
