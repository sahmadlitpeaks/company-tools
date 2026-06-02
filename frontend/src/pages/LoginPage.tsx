import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ui";

export default function LoginPage() {
  const { login, devLogin } = useAuth();
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const isDev = import.meta.env.DEV;

  async function handleDev(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    try {
      await devLogin(email);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Login failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="login-card">
        <div className="row" style={{ gap: 12, marginBottom: 18 }}>
          <span
            className="logo"
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--brand)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              flex: "0 0 auto",
            }}
          >
            AG
          </span>
          <div>
            <h2 style={{ margin: 0 }}>AG Holding</h2>
            <div className="muted">Internal Platform</div>
          </div>
        </div>

        <p className="muted" style={{ marginTop: 0 }}>
          Sign in with your company Microsoft account to continue.
        </p>

        <button
          className="btn-primary"
          style={{ width: "100%", padding: "11px" }}
          onClick={login}
        >
          Sign in with Microsoft
        </button>

        {isDev && (
          <form onSubmit={handleDev} style={{ marginTop: 22 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Developer login (local only)
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input
                type="email"
                placeholder="you@agholding.net"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="btn" style={{ flex: "0 0 auto" }} disabled={busy}>
                {busy ? "…" : "Go"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
