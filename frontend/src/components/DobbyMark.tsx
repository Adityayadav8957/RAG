export type DobbyMood = "idle" | "sleep" | "thinking" | "success" | "error" | "waiting";

const PETALS = Array.from({ length: 8 }, (_, i) => i * 45);

function Face({ mood }: { mood: DobbyMood }) {
  const stroke = { stroke: "#1D1C1A", strokeWidth: 2.4, strokeLinecap: "round" as const, fill: "none" };
  switch (mood) {
    case "sleep":
      return (
        <>
          <path d="M23 31q3 3 6 0M35 31q3 3 6 0" {...stroke} />
          <path d="M28 40q4 2 8 0" {...stroke} />
        </>
      );
    case "success":
      return (
        <>
          <path d="M23 32q3-4 6 0M35 32q3-4 6 0" {...stroke} />
          <path d="M26 38q6 7 12 0" {...stroke} />
        </>
      );
    case "error":
      return (
        <>
          <path d="M24 28l4 4m0-4l-4 4M36 28l4 4m0-4l-4 4" {...stroke} />
          <path d="M27 42q5-4 10 0" {...stroke} />
        </>
      );
    case "waiting":
      return (
        <>
          <circle cx="26" cy="31" r="2.2" fill="#1D1C1A" />
          <circle cx="38" cy="31" r="2.2" fill="#1D1C1A" />
          <path d="M28 40h8" {...stroke} />
        </>
      );
    case "thinking":
      return (
        <>
          <circle cx="27" cy="29" r="2.2" fill="#1D1C1A" />
          <circle cx="39" cy="29" r="2.2" fill="#1D1C1A" />
          <circle cx="34" cy="40" r="2" {...stroke} />
        </>
      );
    default:
      return (
        <>
          <circle cx="26" cy="31" r="2.2" fill="#1D1C1A" />
          <circle cx="38" cy="31" r="2.2" fill="#1D1C1A" />
          <path d="M27 38q5 4 10 0" {...stroke} />
        </>
      );
  }
}

/** Dobby's "bloom" mark: a ring of petals around a friendly face. Decorative, so hidden from assistive tech. */
export function DobbyMark({ size = 28, mood = "idle", className = "" }: { size?: number; mood?: DobbyMood; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`flex-none ${className}`}
    >
      <g className={mood === "thinking" ? "dobby-think" : undefined} style={{ transformOrigin: "32px 32px" }}>
        {PETALS.map((deg, i) => (
          <ellipse
            key={deg}
            cx="32"
            cy="11"
            rx="6.5"
            ry="9"
            transform={`rotate(${deg} 32 32)`}
            fill={i % 2 === 0 ? "var(--accent)" : "var(--accent-hi)"}
          />
        ))}
      </g>
      <circle cx="32" cy="34" r="17" fill="var(--accent-hi)" />
      <circle cx="32" cy="34" r="17" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <g transform="translate(0 2)">
        <Face mood={mood} />
      </g>
    </svg>
  );
}
