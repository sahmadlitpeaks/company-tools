import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { api } from "../api/client";
import { PageHead, useToast } from "../components/ui";

export default function SecurityPage() {
  const { notify } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setEnabled((await api<{ enabled: boolean }>("/api/auth/mfa/status")).enabled);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => { void load(); }, []);

  async function startSetup() {
    setBusy(true);
    try {
      setSetup(await api<{ secret: string; otpauth_uri: string }>("/api/auth/mfa/setup", { method: "POST" }));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
    setBusy(false);
  }
  async function enable() {
    setBusy(true);
    try {
      await api("/api/auth/mfa/enable", { method: "POST", body: { code } });
      notify("Two-factor authentication enabled.");
      setSetup(null); setCode(""); void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Invalid code", "error");
    }
    setBusy(false);
  }
  async function disable() {
    setBusy(true);
    try {
      await api("/api/auth/mfa/disable", { method: "POST", body: { code } });
      notify("Two-factor authentication disabled.");
      setCode(""); void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Invalid code", "error");
    }
    setBusy(false);
  }

  return (
    <div>
      <PageHead title="Security" subtitle="Manage two-factor authentication for your account." />
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="spread mb-3">
          <h3 className="m-0 inline-flex items-center gap-2">
            {enabled ? <ShieldCheck size={18} className="text-emerald-600" /> : <ShieldOff size={18} className="text-ink-muted" />}
            Two-factor authentication
          </h3>
          <span className={`badge ${enabled ? "green" : ""}`}>{enabled ? "Enabled" : "Disabled"}</span>
        </div>

        {enabled ? (
          <>
            <p className="muted text-sm">Enter a current code from your authenticator app to turn 2FA off.</p>
            <div className="field"><label>Authenticator code</label><input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" /></div>
            <button className="btn-danger" style={{ flex: "0 0 auto" }} disabled={busy || !code} onClick={disable}>Disable 2FA</button>
          </>
        ) : setup ? (
          <>
            <p className="text-sm">
              Add this account to your authenticator app (Google Authenticator, Microsoft Authenticator,
              1Password…). Scan the URI as a QR code, or enter the secret manually, then confirm with a code.
            </p>
            <div className="field">
              <label>Secret (manual entry)</label>
              <code className="block rounded-lg p-2 text-sm" style={{ background: "var(--surface-2)", wordBreak: "break-all" }}>{setup.secret}</code>
            </div>
            <div className="field">
              <label>otpauth URI</label>
              <code className="block rounded-lg p-2 text-xs" style={{ background: "var(--surface-2)", wordBreak: "break-all" }}>{setup.otpauth_uri}</code>
            </div>
            <div className="field"><label>Enter the 6-digit code</label><input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" /></div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" style={{ flex: "0 0 auto" }} onClick={() => { setSetup(null); setCode(""); }}>Cancel</button>
              <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy || !code} onClick={enable}>Confirm & enable</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted text-sm">Add a second layer of security — you'll enter a one-time code from your phone when signing in.</p>
            <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={startSetup}>Set up 2FA</button>
          </>
        )}
      </div>
    </div>
  );
}
