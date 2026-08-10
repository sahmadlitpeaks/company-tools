import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Loading } from "../components/ui";

/**
 * Lands here after the backend completes the Azure OIDC flow and redirects to
 * `/auth/callback`. The backend has already set an HttpOnly session cookie.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    void refresh().then(() => navigate("/", { replace: true }));
  }, [navigate, refresh]);

  return <Loading />;
}
