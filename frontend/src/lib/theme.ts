export type Theme = "light" | "dark" | "system";
export const THEME_KEY = "theme";

export function parseTheme(v: string | null | undefined): Theme {
  return v === "light" || v === "dark" ? v : "system";
}

export function readStoredTheme(): Theme {
  try {
    return parseTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function storeTheme(theme: Theme): void {
  try {
    if (theme === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable (private mode, blocked): the choice just won't persist */
  }
}

export function resolveTheme(theme: Theme, prefersDark: boolean): "light" | "dark" {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** Runs before first paint so a stored choice never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
