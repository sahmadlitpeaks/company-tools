import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { tokenStore } from "../api/client";
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
    if (token) {
      tokenStore.set(token);
      void refresh().then(() => navigate("/", { replace: true }));
    } else {
      navigate("/login", { replace: true });
    }
  }, [navigate, refresh]);

  return <Loading />;
}
