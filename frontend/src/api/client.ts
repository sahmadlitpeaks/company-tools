// Empty = same-origin relative URLs. In Vite dev, the proxy forwards /api etc.
// to the backend. Do not default to http://localhost:8000 — that breaks cookies
// across ports and bypasses the dev proxy.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function errorDetail(value: unknown, fallback: string): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (Array.isArray(value)) {
    const messages = value.map((item) => {
      if (!item || typeof item !== "object") return "";
      const { loc, msg } = item as { loc?: unknown; msg?: unknown };
      if (typeof msg !== "string") return "";
      const fields = Array.isArray(loc) ? loc.filter((part): part is string => typeof part === "string" && part !== "body") : [];
      const field = fields[fields.length - 1];
      const label = field?.replace(/_/g, " ");
      return label ? `${label}: ${msg}` : msg;
    }).filter(Boolean);
    return messages.length ? messages.join("; ") : fallback;
  }
  if (value && typeof value === "object") {
    const item = value as { message?: unknown; error?: unknown; errors?: unknown };
    if (typeof item.message === "string") return item.message;
    if (typeof item.error === "string") return item.error;
    if (item.errors) return errorDetail(item.errors, fallback);
  }
  return fallback;
}

type Options = {
  method?: string;
  body?: unknown;
  /** Send a FormData body (file uploads) instead of JSON. */
  form?: FormData;
  auth?: boolean;
  signal?: AbortSignal;
};

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, form, auth = true, signal } = opts;
  void auth;
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: payload,
    credentials: "include",
    signal,
  });

  if (!res.ok) {
    let detail = res.statusText || `Request failed (${res.status})`;
    try {
      const data = await res.json();
      detail = errorDetail(data.detail, detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/** Build an absolute URL to a backend resource (e.g. a QR image). */
export const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

/**
 * Fetch a binary resource with the auth header attached. Needed for images and
 * downloads behind auth, since `<img src>` / `<a download>` can't send the
 * Bearer token and would 401.
 */
export async function apiBlob(path: string, auth = true): Promise<Blob> {
  void auth;
  const headers: Record<string, string> = {};
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    credentials: "include",
  });
  if (!res.ok) {
    let detail = res.statusText || `Request failed (${res.status})`;
    try {
      detail = errorDetail((await res.json()).detail, detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
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
