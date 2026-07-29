import { useEffect, useState } from "react";
import { api } from "../api/client";
import { LoginForm, type AuthConfig } from "../components/login-form";

export default function LoginPage() {
  // The production build is static, so DEV-flag detection won't work — ask the
  // backend at runtime which sign-in options to show.
  const [config, setConfig] = useState<AuthConfig>({
    azure: true,
    password: true,
  });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<AuthConfig>("/api/auth/config", { auth: false })
      .then(setConfig)
      .catch(() => {
        /* keep defaults (show both sign-in options) */
      });
    const err = new URLSearchParams(window.location.search).get("error");
    if (err === "pending_approval") {
      setNotice(
        "Your account was created and is awaiting administrator approval. You'll get access once an admin activates it.",
      );
    } else if (err === "domain_not_allowed") {
      setNotice(
        "That email domain isn't allowed to sign in. Please use your company Microsoft account.",
      );
    }
  }, []);

  return (
    <div className="relative flex min-h-svh w-full items-center justify-center overflow-hidden bg-background p-6 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-primary md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_38%)]" />
      <div className="w-full max-w-sm">
        <LoginForm config={config} notice={notice} />
      </div>
    </div>
  );
}
