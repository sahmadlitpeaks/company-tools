/**
 * Native-shell wiring, active only when running inside Capacitor.
 *
 * Everything here is dynamically imported so the plain web build never pulls
 * the Capacitor plugins into its bundle — the browser and the app ship from
 * the same `dist/`.
 */
import { registerPushToken } from "../api/push";

export function isNative(): boolean {
  return typeof window !== "undefined" && !!(window as { Capacitor?: unknown }).Capacitor;
}

/**
 * Ask for notification permission and hand the resulting token to the backend.
 * FCM/APNs return exactly what `/api/devices` expects, so the native and web
 * paths share one server-side contract.
 */
async function setUpPush(onOpen: (link: string) => void) {
  const { PushNotifications } = await import("@capacitor/push-notifications");

  const status = await PushNotifications.checkPermissions();
  const granted =
    status.receive === "granted" ||
    (await PushNotifications.requestPermissions()).receive === "granted";
  if (!granted) return;

  await PushNotifications.addListener("registration", (token) => {
    void registerPushToken(token.value);
  });
  await PushNotifications.addListener("registrationError", () => {
    // Nothing to do — push is a bonus, the app works without it.
  });
  // Tapping a notification should land on the thing it is about; the backend
  // sends the in-app route as `data.link`.
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const link = (action.notification.data as { link?: string })?.link;
    if (link) onOpen(link);
  });

  await PushNotifications.register();
}

/**
 * Open Azure SSO in the system browser.
 *
 * The backend owns the OIDC flow and finishes by redirecting to
 * `{frontend}/auth/callback#token=…`. For that token to get back *into* the
 * app the redirect has to reach `appUrlOpen` below, which means the deployment
 * must claim the callback as a universal/app link — or `AZURE_REDIRECT_URI`
 * must point at a custom scheme registered by the shell.
 *
 * Until one of those is set up on a real device, password sign-in is the
 * supported path in the app; this is wired but unverified.
 */
export async function nativeSsoLogin(serverBase: string): Promise<void> {
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: `${serverBase}/api/auth/login` });
}

/**
 * Start the native integrations. Safe to call unconditionally: it returns
 * immediately in a browser.
 */
export async function startNativeShell(onOpen: (link: string) => void): Promise<void> {
  if (!isNative()) return;
  try {
    const { App } = await import("@capacitor/app");
    const { Browser } = await import("@capacitor/browser");

    // Deep links land here — including the SSO callback, when the deployment
    // is set up to route it back to the app.
    await App.addListener("appUrlOpen", ({ url }) => {
      const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
      const token = new URLSearchParams(hash).get("token");
      if (token) {
        void Browser.close().catch(() => undefined);
        onOpen(`/auth/callback#token=${token}`);
        return;
      }
      const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
      if (path) onOpen(path);
    });

    await setUpPush(onOpen);
  } catch {
    // A missing plugin must never stop the app from starting.
  }
}
