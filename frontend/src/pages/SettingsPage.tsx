import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ListSkeleton, PageHead, useToast } from "../components/ui";

interface AzureStatus {
  tenant_id: string | null;
  client_id: string | null;
  redirect_uri: string | null;
  secret_set: boolean;
  configured: boolean;
  source: string;
}

export default function SettingsPage() {
  const { notify } = useToast();
  const [status, setStatus] = useState<AzureStatus | null>(null);
  const [form, setForm] = useState({
    tenant_id: "",
    client_id: "",
    client_secret: "",
    redirect_uri: "",
  });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [domains, setDomains] = useState("");
  const [savingSec, setSavingSec] = useState(false);

  const callbackHint =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/auth/callback`
      : "";

  async function load() {
    const s = await api<AzureStatus>("/api/settings/azure");
    setStatus(s);
    setForm({
      tenant_id: s.tenant_id ?? "",
      client_id: s.client_id ?? "",
      client_secret: "",
      redirect_uri: s.redirect_uri ?? "",
    });
  }

  useEffect(() => {
    void load().catch(() => notify("Failed to load settings", "error"));
    api<{ allowed_email_domains: string[] }>("/api/settings/security")
      .then((s) => setDomains(s.allowed_email_domains.join(", ")))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSecurity() {
    setSavingSec(true);
    try {
      const r = await api<{ allowed_email_domains: string[] }>(
        "/api/settings/security",
        { method: "PUT", body: { allowed_email_domains: domains } },
      );
      setDomains(r.allowed_email_domains.join(", "));
      notify("Security settings saved.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSavingSec(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await api("/api/settings/azure", { method: "PUT", body: form });
      notify("Azure settings saved.");
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const r = await api<{ ok: boolean; message?: string; error?: string }>(
        "/api/settings/azure/test",
        { method: "POST" },
      );
      notify(r.ok ? r.message ?? "Connected." : r.error ?? "Failed", r.ok ? "info" : "error");
    } finally {
      setTesting(false);
    }
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHead
        title="Settings"
        subtitle="Configure platform integrations. No code or environment changes needed."
      />

      {!status ? (
        <ListSkeleton rows={5} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card">
            <div className="spread mb-3">
              <h3 className="m-0 flex items-center gap-2">
                <span className="text-xl">🔐</span> Azure Entra ID (SSO)
              </h3>
              <span className={`badge ${status.configured ? "green" : "amber"}`}>
                {status.configured ? "Configured" : "Not configured"}
              </span>
            </div>
            <p className="muted mt-0 text-sm">
              Connect your Azure Entra ID app registration so staff can sign in with
              Microsoft. Values are stored securely (the secret is encrypted at rest).
            </p>

            <div className="field">
              <label>Directory (tenant) ID</label>
              <input value={form.tenant_id} onChange={(e) => set("tenant_id", e.target.value)} />
            </div>
            <div className="field">
              <label>Application (client) ID</label>
              <input value={form.client_id} onChange={(e) => set("client_id", e.target.value)} />
            </div>
            <div className="field">
              <label>
                Client secret{" "}
                {status.secret_set && (
                  <span className="text-xs font-normal text-emerald-600">• already set</span>
                )}
              </label>
              <input
                type="password"
                placeholder={status.secret_set ? "•••••••• (leave blank to keep)" : ""}
                value={form.client_secret}
                onChange={(e) => set("client_secret", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Redirect URI</label>
              <input
                value={form.redirect_uri}
                onChange={(e) => set("redirect_uri", e.target.value)}
                placeholder={callbackHint}
              />
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn-primary flex-none" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                className="btn flex-none"
                disabled={testing || !status.configured}
                onClick={test}
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
              <span className="muted text-xs">
                Currently using:{" "}
                <strong>{status.source === "database" ? "saved settings" : "environment"}</strong>
              </span>
            </div>
          </div>

          <div className="card">
            <div className="spread mb-3">
              <h3 className="m-0 flex items-center gap-2">
                <span className="text-xl">🛡️</span> Access control
              </h3>
            </div>
            <p className="muted mt-0 text-sm">
              Restrict who can sign in. New accounts always start as{" "}
              <strong>pending</strong> and need an admin to approve them in the
              Employee Directory.
            </p>
            <div className="field">
              <label>Allowed email domains</label>
              <input
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="agholding.net, agiomix.com"
              />
              <p className="muted mt-1 text-xs">
                Comma-separated. Leave blank to allow any domain (still subject to
                approval).
              </p>
            </div>
            <button
              className="btn-primary flex-none"
              disabled={savingSec}
              onClick={saveSecurity}
            >
              {savingSec ? "Saving…" : "Save access control"}
            </button>
          </div>

          <div className="card bg-gradient-to-br from-slate-50 to-white">
            <h3 className="mt-0">Setup guide</h3>
            <ol className="space-y-2 pl-4 text-sm text-ink-muted">
              <li>Azure Portal → <strong>Entra ID → App registrations → New registration</strong>.</li>
              <li>
                Add a <strong>Web</strong> redirect URI:
                <code className="mt-1 block break-all">{callbackHint}</code>
              </li>
              <li>Copy the <strong>Directory (tenant) ID</strong> and <strong>Application (client) ID</strong>.</li>
              <li>Under <strong>Certificates &amp; secrets</strong>, create a client secret and paste its value here.</li>
              <li>For directory sync, grant the Graph application permission <strong>User.Read.All</strong> and admin-consent it.</li>
              <li>Save, then <strong>Test connection</strong>.</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
