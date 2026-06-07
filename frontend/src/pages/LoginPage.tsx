import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ui";

interface AuthConfig {
  azure: boolean;
  password: boolean;
}

export default function LoginPage() {
  const { login, passwordLogin } = useAuth();
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // The production build is static, so DEV-flag detection won't work — ask the
  // backend at runtime which sign-in options to show.
  const [config, setConfig] = useState<AuthConfig>({ azure: true, password: true });

  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<AuthConfig>("/api/auth/config", { auth: false })
      .then(setConfig)
      .catch(() => {
        /* keep defaults (show both sign-in options) */
      });
    const err = new URLSearchParams(window.location.search).get("error");
    if (err === "pending_approval")
      setNotice(
        "Your account was created and is awaiting administrator approval. You'll get access once an admin activates it.",
      );
    else if (err === "domain_not_allowed")
      setNotice(
        "That email domain isn't allowed to sign in. Please use your company Microsoft account.",
      );
  }, []);

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    try {
      await passwordLogin(email, password);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Login failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="grid w-full max-w-[920px] overflow-hidden rounded-[20px] bg-white shadow-[0_30px_80px_rgba(0,0,0,0.35)] md:grid-cols-2">
        {/* Brand panel */}
        <div className="relative hidden flex-col justify-between bg-gradient-to-br from-brand-800 to-brand-600 p-9 text-white md:flex">
          <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10" />
          <div className="absolute -bottom-16 -left-10 h-48 w-48 rounded-full bg-white/5" />
          <div className="relative flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 text-lg font-bold">
              AG
            </span>
            <span className="text-lg font-bold">AG Holding</span>
          </div>
          <div className="relative">
            <h2 className="text-white">The internal toolkit for every team.</h2>
            <ul className="mt-4 space-y-2 text-sm text-white/85">
              <li>💳 Digital cards, brand center &amp; marketing assets</li>
              <li>🏷 Asset tracking with QR labels &amp; depreciation</li>
              <li>🔗 QR codes, short links &amp; landing pages</li>
              <li>🔒 Encrypted, single-use secure transfers</li>
            </ul>
          </div>
          <div className="relative text-xs text-white/60">
            Secured by Azure Entra ID single sign-on
          </div>
        </div>

        {/* Sign-in panel */}
        <div className="p-9">
          <div className="mb-1 flex items-center gap-2 md:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 font-bold text-white">
              AG
            </span>
            <span className="font-bold">AG Holding</span>
          </div>
          <h2 className="mt-2">Welcome back</h2>
          <p className="muted mt-1">Sign in to continue.</p>

          {notice && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              {notice}
            </div>
          )}

          {config.password && (
            <form onSubmit={handlePassword} className="mt-5 space-y-3">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Email</label>
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="you@agholding.net"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <button
                className="btn-primary flex w-full items-center justify-center gap-2 py-3"
                disabled={busy}
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}

          {config.azure && (
            <>
              {config.password && (
                <div className="my-4 flex items-center gap-3 text-xs text-ink-muted">
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  or
                  <span className="h-px flex-1 bg-[var(--border)]" />
                </div>
              )}
              <button
                className="btn flex w-full items-center justify-center gap-2 py-3"
                onClick={login}
              >
                <span aria-hidden>⊞</span> Sign in with Microsoft
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
