import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" rather than auto-update: a round of routine checks or a
      // half-filled expense claim must not be reloaded out from under someone.
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "AG Holding — Internal Platform",
        short_name: "AG Holding",
        description:
          "Routine checks, tickets, approvals, leave, expenses and the company directory.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0c1a2b",
        theme_color: "#0c1a2b",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Backend-owned paths and public share links must never be answered
        // from the SPA shell.
        navigateFallbackDenylist: [
          /^\/api/,
          /^\/media/,
          /^\/s\//,
          /^\/q\//,
          /^\/docs/,
          /^\/openapi\.json/,
        ],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            // Read-only API traffic: try the network, fall back to the last
            // response so a backgrounded app opens with data instead of a
            // spinner. Mutations are deliberately never cached or replayed —
            // submissions are validated server-side across many fields, so a
            // blind replay would surface confusing late failures.
            // Anchored at the origin so it also matches the native shell,
            // which talks to the API on a configured host.
            urlPattern: /^https?:\/\/[^/]+\/api\//,
            method: "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "api-get",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
});
