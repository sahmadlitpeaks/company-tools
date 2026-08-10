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
