import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ListSkeleton, PageHead, useToast } from "../components/ui";
import AppearanceControls from "../theme/AppearanceControls";
import IntegrationsSettings from "../components/IntegrationsSettings";
import DemoDataCard from "../components/DemoDataCard";
import { DEFAULT_APPEARANCE, type Appearance } from "../theme/ThemeContext";

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
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [bamboo, setBamboo] = useState({ subdomain: "", api_key: "", key_set: false });
  const [savingBamboo, setSavingBamboo] = useState(false);
  const [sla, setSla] = useState({
    work_start: 9,
    work_end: 18,
    tz_offset: 4,
    workdays: "sun,mon,tue,wed,thu",
    holidays: "",
  });
  const [savingSla, setSavingSla] = useState(false);

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
    api<Appearance>("/api/settings/appearance")
      .then((a) => setAppearance({ ...DEFAULT_APPEARANCE, ...a }))
      .catch(() => {});
    api<{ subdomain: string | null; key_set: boolean }>("/api/settings/bamboo")
      .then((b) => setBamboo({ subdomain: b.subdomain ?? "", api_key: "", key_set: b.key_set }))
      .catch(() => {});
    api<typeof sla>("/api/settings/sla")
      .then(setSla)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSla() {
    setSavingSla(true);
    try {
      const r = await api<typeof sla>("/api/settings/sla", { method: "PUT", body: sla });
      setSla(r);
      notify("SLA working hours saved. New tickets use these targets.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSavingSla(false);
    }
  }

  async function saveBamboo() {
    setSavingBamboo(true);
    try {
      await api("/api/settings/bamboo", {
        method: "PUT",
        body: { subdomain: bamboo.subdomain, api_key: bamboo.api_key || undefined },
      });
      notify("BambooHR settings saved.");
      setBamboo((b) => ({ ...b, api_key: "", key_set: b.key_set || !!b.api_key }));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSavingBamboo(false);
    }
  }

  async function saveAppearance() {
    setSavingAppearance(true);
    try {
      await api("/api/settings/appearance", { method: "PUT", body: appearance });
      notify("Default appearance saved. Users see it unless they personalize.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSavingAppearance(false);
    }
  }

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
        <div className="gap-5 lg:columns-2 [&>*]:mb-5 [&>*]:break-inside-avoid">
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

          <div className="card">
            <div className="spread mb-3">
              <h3 className="m-0 flex items-center gap-2">
                <span className="text-xl">⏱️</span> Service-desk SLA hours
              </h3>
            </div>
            <p className="muted mt-0 text-sm">
              SLA targets are measured in <strong>working hours</strong>: urgent 4h, high 24h,
              normal 72h, low 120h. Define the work week below so deadlines skip evenings,
              weekends and holidays.
            </p>
            <div className="row">
              <div className="field">
                <label>Work start (hour)</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={sla.work_start}
                  onChange={(e) => setSla((s) => ({ ...s, work_start: Number(e.target.value) }))}
                />
              </div>
              <div className="field">
                <label>Work end (hour)</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={sla.work_end}
                  onChange={(e) => setSla((s) => ({ ...s, work_end: Number(e.target.value) }))}
                />
              </div>
              <div className="field">
                <label>UTC offset (hours)</label>
                <input
                  type="number"
                  min={-12}
                  max={14}
                  value={sla.tz_offset}
                  onChange={(e) => setSla((s) => ({ ...s, tz_offset: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="field">
              <label>Working days</label>
              <input
                value={sla.workdays}
                onChange={(e) => setSla((s) => ({ ...s, workdays: e.target.value }))}
                placeholder="sun,mon,tue,wed,thu"
              />
              <p className="muted mt-1 text-xs">Comma-separated day names (mon…sun).</p>
            </div>
            <div className="field">
              <label>Public holidays</label>
              <input
                value={sla.holidays}
                onChange={(e) => setSla((s) => ({ ...s, holidays: e.target.value }))}
                placeholder="2026-12-02, 2026-12-03"
              />
              <p className="muted mt-1 text-xs">Comma-separated ISO dates; these are skipped too.</p>
            </div>
            <button className="btn-primary flex-none" disabled={savingSla} onClick={saveSla}>
              {savingSla ? "Saving…" : "Save SLA hours"}
            </button>
          </div>

          <div className="card">
            <div className="spread mb-3">
              <h3 className="m-0 flex items-center gap-2">
                <span className="text-xl">🎨</span> Default appearance
              </h3>
            </div>
            <p className="muted mt-0 text-sm">
              The company-wide look new users get. Anyone can still personalize
              their own from the profile menu.
            </p>
            <div className="mt-2">
              <AppearanceControls value={appearance} onChange={(k, v) => setAppearance((a) => ({ ...a, [k]: v }))} />
            </div>
            <button
              className="btn-primary mt-4 flex-none"
              disabled={savingAppearance}
              onClick={saveAppearance}
            >
              {savingAppearance ? "Saving…" : "Save default appearance"}
            </button>
          </div>

          <div className="card">
            <div className="spread mb-3">
              <h3 className="m-0 flex items-center gap-2">
                <span className="text-xl">🌿</span> BambooHR
              </h3>
              <span className={`badge ${bamboo.subdomain && (bamboo.key_set || bamboo.api_key) ? "green" : "amber"}`}>
                {bamboo.subdomain && (bamboo.key_set || bamboo.api_key) ? "Configured" : "Not configured"}
              </span>
            </div>
            <p className="muted mt-0 text-sm">
              Connect BambooHR so new joiners can be pushed from the Onboarding screen.
            </p>
            <div className="field">
              <label>Subdomain</label>
              <input
                value={bamboo.subdomain}
                onChange={(e) => setBamboo((b) => ({ ...b, subdomain: e.target.value }))}
                placeholder="yourcompany (from yourcompany.bamboohr.com)"
              />
            </div>
            <div className="field">
              <label>
                API key{" "}
                {bamboo.key_set && <span className="text-xs font-normal text-emerald-600">• set</span>}
              </label>
              <input
                type="password"
                value={bamboo.api_key}
                placeholder={bamboo.key_set ? "•••••• (leave blank to keep)" : ""}
                onChange={(e) => setBamboo((b) => ({ ...b, api_key: e.target.value }))}
              />
            </div>
            <button className="btn-primary flex-none" disabled={savingBamboo} onClick={saveBamboo}>
              {savingBamboo ? "Saving…" : "Save BambooHR"}
            </button>
          </div>

          <NotificationsCard />

          <IntegrationsSettings />

          <DemoDataCard variant="card" />

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

function NotificationsCard() {
  const { notify } = useToast();
  const [status, setStatus] = useState<{ outbound_enabled: boolean; email_configured: boolean; slack_configured: boolean; teams_configured: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ outbound_enabled: boolean; email_configured: boolean; slack_configured: boolean; teams_configured: boolean }>("/api/notifications/channels")
      .then(setStatus)
      .catch(() => {});
  }, []);

  async function sendTest() {
    setBusy(true);
    try {
      const res = await api<{ external_channels: string[] }>("/api/notifications/test", { method: "POST" });
      notify(res.external_channels.length ? `Sent via: ${res.external_channels.join(", ")}` : "In-app notification sent (no external channels configured).");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <div className="spread mb-3">
        <h3 className="m-0 flex items-center gap-2"><span className="text-xl">🔔</span> Notifications</h3>
        <span className={`badge ${status?.outbound_enabled ? "green" : "amber"}`}>{status?.outbound_enabled ? "Outbound on" : "In-app only"}</span>
      </div>
      <p className="muted mt-0 text-sm">
        In-app notifications always work. Configure SMTP, a Slack webhook and/or a Microsoft
        Teams webhook (env vars <code>SMTP_HOST</code>, <code>SLACK_WEBHOOK_URL</code>,
        <code> TEAMS_WEBHOOK_URL</code>) and set <code>NOTIFY_OUTBOUND=true</code> to mirror
        notifications to those channels. Employees can mute categories from the bell menu.
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className={`badge ${status?.email_configured ? "green" : ""}`}>Email {status?.email_configured ? "configured" : "off"}</span>
        <span className={`badge ${status?.slack_configured ? "green" : ""}`}>Slack {status?.slack_configured ? "configured" : "off"}</span>
        <span className={`badge ${status?.teams_configured ? "green" : ""}`}>Teams {status?.teams_configured ? "configured" : "off"}</span>
      </div>
      <button className="btn mt-3 flex-none" disabled={busy} onClick={sendTest}>{busy ? "Sending…" : "Send test notification"}</button>
    </div>
  );
}
