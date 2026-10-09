import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./theme-script";

export type ThemeChoice = "system" | "light" | "dark";

const listeners = new Set<() => void>();
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function read(): ThemeChoice {
  try {
    const t = window.localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* private mode: applies for this visit only */
  }
  applyTheme(choice);
  for (const l of listeners) l();
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      // "System" follows the phone or computer switching between light and dark.
      const onSystem = () => applyTheme(read());
      const m = media();
      m.addEventListener("change", onSystem);
      return () => {
        listeners.delete(l);
        m.removeEventListener("change", onSystem);
      };
    },
    read,
    () => "system",
  );
}
