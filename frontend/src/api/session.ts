/**
 * Device sessions for the installed app.
 *
 * A plain browser tab keeps its original behaviour: one short-lived access
 * token, and signing in again when it expires. An *installed* app (added to the
 * home screen, or running inside the native shell) asks for a refresh token
 * instead, so it can stay signed in the way people expect a phone app to.
 *
 * Kept separate from `client.ts` so the refresh call can use bare `fetch` —
 * routing it back through `api()` would recurse on its own 401 handling.
 */
const REFRESH_KEY = "ag_platform_refresh";
const DEVICE_KEY = "ag_platform_device";

export const refreshStore = {
  get: () => localStorage.getItem(REFRESH_KEY),
  set: (t: string) => localStorage.setItem(REFRESH_KEY, t),
  clear: () => localStorage.removeItem(REFRESH_KEY),
};

/** True when we're a home-screen/native app rather than a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as { Capacitor?: unknown }).Capacitor) return true;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own flag, which predates display-mode.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function platform(): "ios" | "android" | "web" {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "web";
}

/** A stable, human-readable name for this device, shown in "your sessions". */
export function deviceLabel(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const os = platform();
  const name =
    os === "ios" ? "iPhone / iPad" : os === "android" ? "Android device" : "Browser";
  localStorage.setItem(DEVICE_KEY, name);
  return name;
}

/**
 * Extra login fields that opt this client into a refresh token. Empty for an
 * ordinary browser tab, which is what keeps the web flow unchanged.
 */
export function loginDeviceFields(): { device?: string; platform?: string } {
  if (!isInstalled()) return {};
  return { device: deviceLabel(), platform: platform() };
}
