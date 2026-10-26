"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

export type DobbyMood = "idle" | "thinking" | "waiting" | "success" | "error" | "sleep";
export type DobbyBurst = "bloom" | "rays" | "orbit";

/**
 * The Dobby mark, ported from the design's DobbyBurst component. Three marks (bloom is the
 * default), six moods, and an `onAccent` variant for use on the accent colour. It animates on a
 * 50 ms tick and stays still when the user prefers reduced motion.
 */
export function DobbyBurst({
  size = 96,
  mood = "idle",
  mark = "bloom",
  variant = "default",
}: {
  size?: number;
  mood?: DobbyMood;
  mark?: DobbyBurst;
  variant?: "default" | "onAccent";
}) {
  const t = useTick();
  const onAccent = variant === "onAccent";
  const c = {
    base: onAccent ? "#FFFFFF" : "var(--accent, #4B4FD8)",
    ok: onAccent ? "#FFFFFF" : "#2FA36B",
    err: onAccent ? "#FFD1D1" : "#E5484D",
    amber: "#F2B441",
  };
  const art = mark === "rays" ? rays(size, mood, t, c) : mark === "orbit" ? orbit(size, mood, t, c) : bloom(size, mood, t, c);
  return (
    <div role="img" aria-label={LABEL[mood]} style={{ display: "inline-block", lineHeight: 0 }}>
      {art}
    </div>
  );
}

type Colors = { base: string; ok: string; err: string; amber: string };

const LABEL: Record<DobbyMood, string> = {
  idle: "Dobby",
  thinking: "Dobby is working",
  waiting: "Dobby is waiting for approval",
  success: "Dobby: done",
  error: "Dobby: something went wrong",
  sleep: "Dobby is asleep",
};

function useTick(): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const iv = setInterval(() => {
      if (!document.hidden) setT((n) => n + 1);
    }, 50);
    return () => clearInterval(iv);
  }, []);
  return t;
}

const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

function box(size: number, kids: ReactNode, extra?: CSSProperties) {
  return <div style={{ position: "relative", width: size, height: size, ...extra }}>{kids}</div>;
}

function bloom(size: number, mood: DobbyMood, t: number, c: Colors) {
  const n = 5;
  const rotSpeed = { idle: 0.25, thinking: 2.2, waiting: 0, success: 0.6, error: 0, sleep: 0.08 }[mood];
  const rot = t * rotSpeed + (mood === "error" ? Math.sin(t * 1.3) * 6 : 0);
  const done = mood === "success" ? (t % 60) / 60 : 0;
  const petals: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    let sc = 1;
    let op = 1;
    let col = c.base;
    if (mood === "idle") sc = 0.94 + 0.06 * Math.sin(t / 18);
    if (mood === "thinking") sc = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t / 4 - i * 1.25));
    if (mood === "waiting") {
      op = 0.55 + 0.45 * Math.abs(Math.sin(t / 14));
      if (i === 0) {
        col = c.amber;
        op = 1;
      }
    }
    if (mood === "success") {
      sc = done < 0.3 ? 1 - done * 1.6 : Math.min(1.08, 0.52 + (done - 0.3) * 2.2);
      col = done > 0.3 ? c.ok : c.base;
    }
    if (mood === "error" && i === Math.floor(t / 14) % n) col = c.err;
    if (mood === "sleep") {
      op = 0.22;
      sc = 0.85 + 0.05 * Math.sin(t / 30);
    }
    petals.push(
      <div
        key={i}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "27%",
          height: "44%",
          marginLeft: "-13.5%",
          marginTop: "-44%",
          borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
          background: col,
          opacity: op * 0.82,
          transformOrigin: "50% 100%",
          transform: `rotate(${rot + (i * 360) / n}deg) scale(${sc})`,
        }}
      />,
    );
  }
  return box(size, petals);
}

const DIRS = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
] as const;

function rays(size: number, mood: DobbyMood, t: number, c: Colors) {
  const N = 9;
  const c0 = 4;
  const grid = Array.from({ length: N * N }, () => ({ op: 0, col: c.base }));
  const set = (x: number, y: number, op: number, col?: string) => {
    if (x >= 0 && y >= 0 && x < N && y < N) grid[y * N + x] = { op, col: col ?? c.base };
  };
  const lenFor = (i: number): number => {
    if (mood === "idle") return 4;
    if (mood === "thinking") return 1 + Math.floor((t / 3 + i) % 4);
    if (mood === "waiting") return 2 + Math.round(2 * Math.abs(Math.sin(t / 16)));
    if (mood === "success") return Math.min(4, Math.floor((t % 50) / 6));
    if (mood === "error") return rnd(i * 13 + Math.floor(t / 6)) < 0.3 ? 1 : 3 + (i % 2);
    return 1;
  };
  DIRS.forEach(([dx, dy], i) => {
    const diag = dx && dy;
    const L = Math.min(lenFor(i), diag ? 3 : 4);
    for (let k = 1; k <= L; k++) {
      let op = 1;
      let col = c.base;
      if (mood === "idle" && i === Math.floor(t / 6) % 8) op = 0.45;
      if (mood === "success") col = c.ok;
      if (mood === "error" && L === 1) col = c.err;
      if (mood === "sleep") op = 0.18;
      set(c0 + dx * k, c0 + dy * k, op, col);
    }
  });
  set(
    c0,
    c0,
    mood === "sleep" ? 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t / 20)) : 1,
    mood === "waiting" ? c.amber : mood === "success" ? c.ok : c.base,
  );
  const gap = size < 28 ? 0 : Math.max(1, Math.round(size * 0.018));
  return (
    <div
      style={{
        width: size,
        height: size,
        padding: size * 0.04,
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: "repeat(9,1fr)",
        gridTemplateRows: "repeat(9,1fr)",
        gap,
      }}
    >
      {grid.map((g, i) => (
        <div
          key={i}
          style={{ background: g.op ? g.col : "transparent", opacity: g.op, borderRadius: size >= 40 ? "18%" : 0 }}
        />
      ))}
    </div>
  );
}

function orbit(size: number, mood: DobbyMood, t: number, c: Colors) {
  const speed = { idle: 0.6, thinking: 4.2, waiting: 0, success: 1.2, error: 0, sleep: 0.15 }[mood];
  const a0 = t * speed;
  const kids: ReactNode[] = [];
  const R = mood === "success" ? 30 * Math.abs(Math.cos(((t % 40) / 40) * Math.PI)) : 30;
  const core = mood === "success" ? c.ok : mood === "waiting" ? c.amber : c.base;
  const coreSc = mood === "idle" ? 1 + 0.05 * Math.sin(t / 15) : mood === "success" ? 1 + 0.25 * (1 - R / 30) : 1;
  kids.push(
    <div
      key="c"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: "34%",
        height: "34%",
        marginLeft: "-17%",
        marginTop: "-17%",
        borderRadius: "50%",
        background: core,
        opacity: mood === "sleep" ? 0.3 : 1,
        transform: `scale(${coreSc})`,
      }}
    />,
  );
  for (let i = 0; i < 3; i++) {
    const ang =
      ((a0 + i * 120 + (mood === "waiting" ? -90 - i * 120 + (i - 1) * 28 : 0) + (mood === "error" ? Math.sin(t * 1.7 + i) * 12 : 0)) *
        Math.PI) /
      180;
    const r = mood === "waiting" ? 32 : R;
    const x = 50 + Math.cos(ang) * r;
    const y = 50 + Math.sin(ang) * r;
    const col = mood === "error" && i === 0 ? c.err : mood === "success" ? c.ok : c.base;
    kids.push(
      <div
        key={`s${i}`}
        style={{
          position: "absolute",
          left: `${x}%`,
          top: `${y}%`,
          width: "15%",
          height: "15%",
          marginLeft: "-7.5%",
          marginTop: "-7.5%",
          borderRadius: "50%",
          background: col,
          opacity: mood === "sleep" ? 0.2 : 1,
        }}
      />,
    );
    if (mood === "thinking") {
      [1, 2].forEach((k) => {
        const a2 = ang - k * 0.32;
        const w = 15 - k * 4;
        kids.push(
          <div
            key={`t${i}${k}`}
            style={{
              position: "absolute",
              left: `${50 + Math.cos(a2) * r}%`,
              top: `${50 + Math.sin(a2) * r}%`,
              width: `${w}%`,
              height: `${w}%`,
              marginLeft: `${-w / 2}%`,
              marginTop: `${-w / 2}%`,
              borderRadius: "50%",
              background: c.base,
              opacity: 0.45 / k,
            }}
          />,
        );
      });
    }
  }
  return box(size, kids);
}
