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

export type ThemeMode = "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const STORAGE_KEY = "ag_theme_mode:v2";
const ThemeCtx = createContext<ThemeState | undefined>(undefined);

function loadMode(): ThemeMode {
  return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.density = "comfortable";
  root.dataset.font = "dm-sans";
  root.classList.toggle("dark", mode === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(loadMode);

  useLayoutEffect(() => {
    applyMode(mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((current) => current === "dark" ? "light" : "dark");
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!((event.metaKey || event.ctrlKey) && event.shiftKey)) return;
      if (event.key.toLowerCase() !== "d" && event.code !== "KeyD") return;
      event.preventDefault();
      toggleMode();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleMode]);

  const value = useMemo(() => ({ mode, setMode, toggleMode }), [mode, setMode, toggleMode]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeCtx);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
