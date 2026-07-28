import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api, tokenStore } from "../api/client";
import { loginDeviceFields, refreshStore } from "../api/session";
import { useAuth } from "../auth/AuthContext";
import { Loading } from "../components/ui";

/**
 * Lands here after the backend completes the Azure OIDC flow and redirects to
 * `/auth/callback#token=<jwt>`. We persist the token and bounce to the app.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }
    tokenStore.set(token);

    void (async () => {
      // SSO only hands back an access token. An installed app trades it for a
      // device session so it stays signed in like the password flow does.
      const device = loginDeviceFields();
      if (device.device) {
        try {
          const res = await api<{ refresh_token: string }>("/api/auth/device-session", {
            method: "POST",
            body: device,
          });
          refreshStore.set(res.refresh_token);
        } catch {
          /* non-fatal: the session just won't outlive the access token */
        }
      }
      await refresh();
      navigate("/", { replace: true });
    })();
  }, [navigate, refresh]);

  return <Loading />;
}
