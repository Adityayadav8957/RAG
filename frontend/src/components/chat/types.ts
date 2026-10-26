import type { Citation, TraceEvent } from "@/lib/types";

export type StepState = "run" | "done" | "fail";
export interface Step {
  label: string;
  state: StepState;
}

export interface UiMessage {
  key: string;
  role: "user" | "assistant";
  text: string;
  citations: Citation[];
  steps: Step[];
  trace: TraceEvent[];
  streaming: boolean;
  stopped: boolean;
}
