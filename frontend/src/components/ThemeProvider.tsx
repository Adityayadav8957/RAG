"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { applyTheme, readStoredTheme, resolveTheme, storeTheme, type Theme } from "@/lib/theme";

interface Ctx {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
}
const ThemeContext = createContext<Ctx>({ theme: "system", resolved: "light", setTheme: () => undefined });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [prefersDark, setPrefersDark] = useState(false);

  useEffect(() => {
    setThemeState(readStoredTheme());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    storeTheme(t);
    applyTheme(t);
  }, []);

  const value = useMemo(
    () => ({ theme, resolved: resolveTheme(theme, prefersDark), setTheme }),
    [theme, prefersDark, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  return useContext(ThemeContext);
}
