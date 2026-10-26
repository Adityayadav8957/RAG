import type { TraceStatus } from "@/lib/types";
import type { NodeState } from "@/lib/trace";
import { Ban, Circle, CircleCheck, CircleX, Clock, LoaderCircle, Minus, TriangleAlert, type IconProps } from "../icons";

export type ViewState = NodeState | TraceStatus;

interface StatusStyle {
  label: string;
  /** chip colours */
  chip: string;
  /** text colour for icons */
  text: string;
  Icon: (p: IconProps) => React.ReactElement;
  spin?: boolean;
}

export const STATUS: Record<ViewState, StatusStyle> = {
  pending: { label: "Pending", chip: "bg-subtle text-faint", text: "text-faint", Icon: Circle },
  running: { label: "Running", chip: "bg-accent-soft text-accent-text", text: "text-accent-text", Icon: LoaderCircle, spin: true },
  done: { label: "Done", chip: "bg-ok-soft text-ok", text: "text-ok", Icon: CircleCheck },
  skipped: { label: "Skipped", chip: "bg-subtle text-muted", text: "text-faint", Icon: Minus },
  blocked: { label: "Blocked", chip: "bg-err-soft text-err", text: "text-err", Icon: Ban },
  waiting: { label: "Waiting for you", chip: "bg-warn-soft text-warn", text: "text-warn", Icon: Clock },
  error: { label: "Error", chip: "bg-err-soft text-err", text: "text-err", Icon: TriangleAlert },
};

export function StatusIcon({ state, size = 14 }: { state: ViewState; size?: number }) {
  const s = STATUS[state];
  return <s.Icon size={size} className={`${s.text} ${s.spin ? "spin" : ""}`} />;
}

export { CircleX };
