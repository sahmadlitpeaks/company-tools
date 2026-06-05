import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";

export type ThemeMode = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type FontChoice = "system" | "inter" | "serif";

export interface Appearance {
  mode: ThemeMode;
  accent: string;
  density: Density;
  font: FontChoice;
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "light",
  accent: "#0b5cab",
  density: "comfortable",
  font: "system",
};

export const ACCENT_PRESETS = [
  "#0b5cab", // AG blue
  "#2563eb", // royal
  "#7c3aed", // violet
  "#0d9488", // teal
  "#059669", // emerald
  "#dc2626", // red
  "#ea580c", // orange
  "#db2777", // pink
  "#475569", // slate
];

const STORAGE_KEY = "ag_appearance_override";

interface ThemeState extends Appearance {
  /** Update one field (persists as a per-user override). */
  setField: <K extends keyof Appearance>(key: K, value: Appearance[K]) => void;
  /** Clear the personal override and follow the organization default. */
  resetToOrgDefault: () => void;
  /** True if the user has any personal override. */
  hasOverride: boolean;
}

const ThemeCtx = createContext<ThemeState | undefined>(undefined);

function loadOverride(): Partial<Appearance> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

function apply(a: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = resolveMode(a.mode);
  root.dataset.density = a.density;
  root.dataset.font = a.font;
  root.style.setProperty("--accent", a.accent);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [orgDefault, setOrgDefault] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [override, setOverride] = useState<Partial<Appearance>>(loadOverride);

  const effective = useMemo<Appearance>(
    () => ({ ...DEFAULT_APPEARANCE, ...orgDefault, ...override }),
    [orgDefault, override],
  );

  // Apply synchronously to avoid a flash of the wrong theme.
  useLayoutEffect(() => {
    apply(effective);
  }, [effective]);

  // Pull the organization default (ignored if not signed in yet).
  useEffect(() => {
    api<Appearance>("/api/settings/appearance")
      .then((d) => setOrgDefault({ ...DEFAULT_APPEARANCE, ...d }))
      .catch(() => {});
  }, []);

  // React to OS theme changes while in "system" mode.
  useEffect(() => {
    if (effective.mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(effective);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [effective]);

  const setField = useCallback(
    <K extends keyof Appearance>(key: K, value: Appearance[K]) => {
      setOverride((o) => {
        const next = { ...o, [key]: value };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const resetToOrgDefault = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setOverride({});
  }, []);

  const value = useMemo<ThemeState>(
    () => ({
      ...effective,
      setField,
      resetToOrgDefault,
      hasOverride: Object.keys(override).length > 0,
    }),
    [effective, setField, resetToOrgDefault, override],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
