import { refreshStore } from "./session";

/**
 * Base URL for the API.
 *
 * The web build bakes this in (empty => relative URLs, which nginx proxies).
 * The native shell can't do that — one binary has to reach whichever host the
 * platform is deployed on — so a runtime override wins when present.
 */
const RUNTIME_BASE_KEY = "ag_platform_api_base";
const BUILT_IN_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

let runtimeBase: string | null =
  typeof localStorage !== "undefined" ? localStorage.getItem(RUNTIME_BASE_KEY) : null;

/**
 * Where API calls currently point. A function rather than a constant so a
 * runtime change (the native shell's server-address screen) takes effect
 * without a reload.
 */
export const apiBase = (): string => runtimeBase ?? BUILT_IN_BASE;

export const serverStore = {
  get: () => runtimeBase,
  set: (base: string) => {
    runtimeBase = base.replace(/\/+$/, "");
    localStorage.setItem(RUNTIME_BASE_KEY, runtimeBase);
  },
  clear: () => {
    runtimeBase = null;
    localStorage.removeItem(RUNTIME_BASE_KEY);
  },
};

const TOKEN_KEY = "ag_platform_token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  /** Send a FormData body (file uploads) instead of JSON. */
  form?: FormData;
  auth?: boolean;
};

/**
 * Swap an expired access token for a fresh one using the device's refresh
 * token. Only installed apps hold one, so a browser tab simply signs out as it
 * always did. Concurrent 401s share a single in-flight attempt.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshSession(): Promise<boolean> {
  const refreshToken = refreshStore.get();
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        tokenStore.set(data.access_token);
        if (data.refresh_token) refreshStore.set(data.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        // Cleared on the next tick so callers awaiting this attempt all see it.
        setTimeout(() => (refreshInFlight = null), 0);
      }
    })();
  }
  return refreshInFlight;
}

function endSession() {
  tokenStore.clear();
  refreshStore.clear();
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, form, auth = true } = opts;

  const send = () => {
    const headers: Record<string, string> = {};
    if (auth) {
      const token = tokenStore.get();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    let payload: BodyInit | undefined;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    return fetch(`${apiBase()}${path}`, { method, headers, body: payload });
  };

  let res = await send();

  if (res.status === 401 && auth) {
    // An installed app renews silently; anything else signs out as before.
    if (await tryRefreshSession()) {
      res = await send();
    }
    if (res.status === 401) endSession();
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, String(detail));
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/** Build an absolute URL to a backend resource (e.g. a QR image). */
export const apiUrl = (path: string) => `${apiBase()}${path}`;

/**
 * Fetch a binary resource with the auth header attached. Needed for images and
 * downloads behind auth, since `<img src>` / `<a download>` can't send the
 * Bearer token and would 401.
 */
export async function apiBlob(path: string, auth = true): Promise<Blob> {
  const send = () => {
    const headers: Record<string, string> = {};
    if (auth) {
      const token = tokenStore.get();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    return fetch(`${apiBase()}${path}`, { headers });
  };
  let res = await send();
  if (res.status === 401 && auth) {
    if (await tryRefreshSession()) res = await send();
    if (res.status === 401) endSession();
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, String(detail));
  }
  return res.blob();
}

/** Download an auth-protected resource to the user's machine. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
