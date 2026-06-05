import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { API_BASE_URL, api, tokenStore } from "../api/client";
import type { User } from "../api/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: () => void;
  devLogin: (email: string) => Promise<void>;
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
    try {
      const me = await api<User>("/api/auth/me");
      setUser(me);
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(() => {
    // Backend-driven Azure OIDC flow.
    window.location.href = `${API_BASE_URL}/api/auth/login`;
  }, []);

  const devLogin = useCallback(
    async (email: string) => {
      const res = await api<{ access_token: string }>(
        `/api/auth/dev-login?email=${encodeURIComponent(email)}`,
        { method: "POST", auth: false },
      );
      tokenStore.set(res.access_token);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const can = useCallback(
    (module: string) =>
      !!user && (user.is_admin || user.effective_permissions.includes(module)),
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, devLogin, logout, refresh, can }),
    [user, loading, login, devLogin, logout, refresh, can],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
