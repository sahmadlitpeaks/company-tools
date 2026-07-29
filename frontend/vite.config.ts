import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

/** Backend origin for Vite's dev proxy (HMR lives on :5173; API is proxied). */
function apiProxyTarget(mode: string): string {
  const env = loadEnv(mode, process.cwd(), "");
  return env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";
}

export default defineConfig(({ mode }) => {
  const proxyTarget = apiProxyTarget(mode);
  const proxy = {
    target: proxyTarget,
    changeOrigin: true,
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "react-vendor",
                test: /node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/,
                priority: 30,
              },
              {
                name: "base-ui-vendor",
                test: /node_modules[\\/]@base-ui[\\/]react[\\/]/,
                priority: 25,
              },
              {
                name: "pdf-vendor",
                test: /node_modules[\\/](pdfjs-dist|react-pageflip)[\\/]/,
                maxSize: 450_000,
                priority: 20,
              },
              {
                name: "vendor",
                test: /node_modules[\\/]/,
                maxSize: 450_000,
                minSize: 25_000,
                priority: 10,
              },
              {
                name: "app",
                test: /src[\\/]/,
                maxSize: 450_000,
                minSize: 25_000,
              },
            ],
          },
        },
      },
    },
    server: {
      port: 5173,
      host: true,
      // Keep cookies / relative /api URLs working during local HMR.
      // IMPORTANT: use "/s/" and "/q/" with a trailing slash — a bare "/s"
      // prefix also matches "/src/*" and breaks the entire SPA (white page).
      proxy: {
        "/api": proxy,
        "/media": proxy,
        "/s/": proxy,
        "/q/": proxy,
        "/docs": proxy,
        "/openapi.json": proxy,
        "/health": proxy,
      },
    },
  };
});
