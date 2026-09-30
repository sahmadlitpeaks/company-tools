import { useEffect } from "react";

const REFRESH_INTERVAL = 15_000;
// Full responses recheck live file authorization; previews remain available on failure.
export function useTaskRefresh(refresh: () => void, paused: boolean) {
  useEffect(() => {
    let lastRefresh = Date.now();
    function check() {
      if (paused || document.visibilityState !== "visible" || Date.now() - lastRefresh < 2_000) return;
      lastRefresh = Date.now();
      refresh();
    }
    const timer = window.setInterval(check, REFRESH_INTERVAL);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [refresh, paused]);
}
