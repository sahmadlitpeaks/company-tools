import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell configuration.
 *
 * The web assets are **bundled into the binary** (`webDir: "dist"`) rather than
 * loaded from a remote `server.url`. That matters here: this platform is
 * host-agnostic by design — it derives its public URLs from whatever host it is
 * reached on — but a store binary cannot be rebuilt per deployment. So the app
 * ships its UI inside the app and asks for the server address on first run
 * (see `src/api/client.ts` → `serverStore`, and `ServerSetup.tsx`).
 *
 * It also keeps Apple happy: an app whose entire content is a remote URL reads
 * as a thin web wrapper and invites rejection.
 */
const config: CapacitorConfig = {
  appId: "net.agholding.platform",
  appName: "AG Holding",
  webDir: "dist",
  // The bundled assets are served from a local origin, so calls to the
  // configured server are cross-origin: the backend must list that origin in
  // BACKEND_CORS_ORIGINS.
  server: {
    androidScheme: "https",
    iosScheme: "https",
  },
  ios: {
    contentInset: "always",
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
