"use client";

import { useRef } from "react";
import type { Theme } from "@/lib/theme";
import { Monitor, Moon, Sun, type IconProps } from "../icons";
import { useTheme } from "../ThemeProvider";

const OPTIONS: { id: Theme; label: string; Icon: (p: IconProps) => React.ReactElement }[] = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "System", Icon: Monitor },
];

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + OPTIONS.length) % OPTIONS.length;
    const target = OPTIONS[next];
    if (target) setTheme(target.id);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="flex gap-1 rounded-lg bg-subtle p-[3px]">
      {OPTIONS.map(({ id, label, Icon }, i) => {
        const active = theme === id;
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => setTheme(id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`flex h-[30px] items-center gap-1.5 rounded-md border-none px-3 text-[13px] font-medium ${
              active ? "bg-surface text-ink" : "bg-transparent text-muted"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
