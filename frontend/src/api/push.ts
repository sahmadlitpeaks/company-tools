/**
 * Registering this device for push notifications.
 *
 * Two clients, one backend contract: whatever token the platform's push
 * provider hands us gets POSTed to `/api/devices`, and the backend sends to it.
 *
 * - Native shell: the Capacitor push plugin supplies the token (see
 *   `registerNativePush`, called from the shell bootstrap).
 * - Installed PWA: Firebase Web Push supplies it, and only when the Firebase
 *   web config is present. The SDK is dynamically imported so an unconfigured
 *   deployment pays nothing for it — the app simply doesn't offer web push.
 */
import { api } from "./client";
import { deviceLabel, isInstalled, platform } from "./session";

const REGISTERED_KEY = "ag_platform_push_token";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export function webPushConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && vapidKey);
}

/** Send a provider token to the backend, skipping an unchanged re-register. */
export async function registerPushToken(token: string): Promise<void> {
  if (!token || localStorage.getItem(REGISTERED_KEY) === token) return;
  await api("/api/devices", {
    method: "POST",
    body: { token, platform: platform(), device: deviceLabel() },
  });
  localStorage.setItem(REGISTERED_KEY, token);
}

export function forgetPushToken(): void {
  localStorage.removeItem(REGISTERED_KEY);
}

/**
 * Ask for notification permission and register, if this is an installed app on
 * a deployment that has push configured. Safe to call on every sign-in: it
 * no-ops when unavailable and never throws into the caller.
 */
export async function enableWebPush(): Promise<boolean> {
  try {
    if (!isInstalled() || !webPushConfigured()) return false;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;

    const backend = await api<{ push_enabled: boolean }>("/api/devices/config");
    if (!backend.push_enabled) return false;

    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (permission !== "granted") return false;

    const [{ initializeApp }, { getMessaging, getToken }] = await Promise.all([
      import("firebase/app"),
      import("firebase/messaging"),
    ]);
    const messaging = getMessaging(initializeApp(firebaseConfig));
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return false;
    await registerPushToken(token);
    return true;
  } catch {
    // Push is a bonus, never a blocker for using the app.
    return false;
  }
}
