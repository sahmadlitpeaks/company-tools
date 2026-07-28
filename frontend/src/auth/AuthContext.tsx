import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, apiBase, tokenStore } from "../api/client";
import { enableWebPush, forgetPushToken } from "../api/push";
import { loginDeviceFields, refreshStore } from "../api/session";
import type { User } from "../api/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: () => void;
  passwordLogin: (email: string, password: string, code?: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** Whether the current user may access a permission module. */
  can: (module: string) => boolean;
}

const AuthCtx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    // Only an outright rejection from the server ends the session. A network
    // failure — a dropped signal, a request aborted by navigating away — must
    // not sign someone out; on a phone that would happen constantly. So retry
    // a couple of times before giving up, and keep the token either way.
    // (`api()` has already attempted a token refresh before surfacing a 401.)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const me = await api<User>("/api/auth/me");
        setUser(me);
        // Installed apps register for push once signed in. Fire-and-forget:
        // notifications are a bonus, never a gate on using the app.
        void enableWebPush();
        break;
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401 || err.status === 403) {
            tokenStore.clear();
            refreshStore.clear();
            setUser(null);
          }
          break; // a real answer from the server, retrying won't help
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(() => {
    // Backend-driven Azure OIDC flow.
    window.location.href = `${apiBase()}/api/auth/login`;
  }, []);

  const passwordLogin = useCallback(
    async (email: string, password: string, code?: string) => {
      const res = await api<{ access_token: string; refresh_token?: string }>(
        "/api/auth/login",
        {
          method: "POST",
          auth: false,
          // Installed apps identify a device and get a refresh token with it;
          // an ordinary browser tab sends nothing extra and behaves as before.
          body: { email, password, code, ...loginDeviceFields() },
        },
      );
      tokenStore.set(res.access_token);
      if (res.refresh_token) refreshStore.set(res.refresh_token);
      await refresh();
    },
    [refresh],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await api("/api/auth/change-password", {
        method: "POST",
        body: { current_password: currentPassword, new_password: newPassword },
      });
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(() => {
    // Revoke the device server-side too, so an installed app that is signed out
    // can't be resumed from its refresh token. Best-effort: a failed call must
    // still sign this client out locally.
    const rt = refreshStore.get();
    if (rt) {
      void fetch(`${apiBase()}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      }).catch(() => undefined);
    }
    tokenStore.clear();
    refreshStore.clear();
    forgetPushToken();
    setUser(null);
  }, []);

  const can = useCallback(
    (module: string) =>
      !!user && (user.is_admin || user.effective_permissions.includes(module)),
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, passwordLogin, changePassword, logout, refresh, can }),
    [user, loading, login, passwordLogin, changePassword, logout, refresh, can],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
