import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Building2,
  Clock3,
  DatabaseBackup,
  Download,
  ShieldCheck,
  Sprout,
  Upload,
} from "lucide-react";
import { api, downloadFile } from "../api/client";
import { ListSkeleton, PageHead, useToast } from "../components/ui";
import IntegrationsSettings from "../components/IntegrationsSettings";
import FxRatesSettings from "../components/FxRatesSettings";
import DemoDataCard from "../components/DemoDataCard";
import { Button } from "../components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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
  const [status, setRecordStatus] = useState<AzureStatus | null>(null);
  const [form, setForm] = useState({
    tenant_id: "",
    client_id: "",
    client_secret: "",
    redirect_uri: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [domains, setDomains] = useState("");
  const [savingSec, setSavingSec] = useState(false);
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
    setRecordStatus(s);
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
    setIsSubmitting(true);
    try {
      await api("/api/settings/azure", { method: "PUT", body: form });
      notify("Azure settings saved.");
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setIsSubmitting(false);
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                 <Building2 aria-hidden="true" /> Azure Entra ID (SSO)
              </CardTitle>
              <CardAction><Badge variant={status.configured ? "success" : "warning"}>
                {status.configured ? "Configured" : "Not configured"}
              </Badge></CardAction>
              <CardDescription>
              Connect your Azure Entra ID app registration so staff can sign in with
              Microsoft. Values are stored securely (the secret is encrypted at rest).
              </CardDescription>
            </CardHeader>
            <CardContent>
            <FieldGroup>

            <Field>
              <FieldLabel htmlFor="settings-tenant-id">Directory (tenant) ID</FieldLabel>
              <Input id="settings-tenant-id" value={form.tenant_id} onChange={(e) => set("tenant_id", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="settings-client-id">Application (client) ID</FieldLabel>
              <Input id="settings-client-id" value={form.client_id} onChange={(e) => set("client_id", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="settings-client-secret">
                Client secret{" "}
                {status.secret_set && (
                  <span className="text-xs font-normal text-success">• already set</span>
                )}
              </FieldLabel>
              <Input id="settings-client-secret"
                type="password"
                placeholder={status.secret_set ? "•••••••• (leave blank to keep)" : ""}
                value={form.client_secret}
                onChange={(e) => set("client_secret", e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="settings-redirect-uri">Redirect URI</FieldLabel>
              <Input id="settings-redirect-uri"
                value={form.redirect_uri}
                onChange={(e) => set("redirect_uri", e.target.value)}
                placeholder={callbackHint}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={isSubmitting} onClick={save}>
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline"
                disabled={testing || !status.configured}
                onClick={test}
              >
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Currently using:{" "}
                <strong>{status.source === "database" ? "saved settings" : "environment"}</strong>
              </span>
            </div>
            </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                 <ShieldCheck aria-hidden="true" /> Access control
              </CardTitle>
              <CardDescription>
              Restrict who can sign in. New accounts always start as{" "}
              <strong>pending</strong> and need an admin to approve them in the
              Employee Directory.
              </CardDescription>
            </CardHeader>
            <CardContent><FieldGroup>
            <Field>
              <FieldLabel htmlFor="settings-domains">Allowed email domains</FieldLabel>
              <Input id="settings-domains"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="agholding.net, agiomix.com"
              />
              <FieldDescription>
                Comma-separated. Leave blank to allow any domain (still subject to
                approval).
              </FieldDescription>
            </Field>
            <Button type="button"
              disabled={savingSec}
              onClick={saveSecurity}
            >
              {savingSec ? "Saving…" : "Save access control"}
            </Button>
            </FieldGroup></CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                 <Clock3 aria-hidden="true" /> Service-desk SLA hours
              </CardTitle>
              <CardDescription>
              SLA targets are measured in <strong>working hours</strong>: urgent 4h, high 24h,
              normal 72h, low 120h. Define the work week below so deadlines skip evenings,
              weekends and holidays.
              </CardDescription>
            </CardHeader>
            <CardContent><FieldGroup>
            <FieldGroup className="grid gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="settings-work-start">Work start (hour)</FieldLabel>
                <Input id="settings-work-start"
                  type="number"
                  min={0}
                  max={23}
                  value={sla.work_start}
                  onChange={(e) => setSla((s) => ({ ...s, work_start: Number(e.target.value) }))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-work-end">Work end (hour)</FieldLabel>
                <Input id="settings-work-end"
                  type="number"
                  min={1}
                  max={24}
                  value={sla.work_end}
                  onChange={(e) => setSla((s) => ({ ...s, work_end: Number(e.target.value) }))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-tz-offset">UTC offset (hours)</FieldLabel>
                <Input id="settings-tz-offset"
                  type="number"
                  min={-12}
                  max={14}
                  value={sla.tz_offset}
                  onChange={(e) => setSla((s) => ({ ...s, tz_offset: Number(e.target.value) }))}
                />
              </Field>
            </FieldGroup>
            <Field>
              <FieldLabel htmlFor="settings-working-days">Working days</FieldLabel>
              <Input id="settings-working-days"
                value={sla.workdays}
                onChange={(e) => setSla((s) => ({ ...s, workdays: e.target.value }))}
                placeholder="sun,mon,tue,wed,thu"
              />
              <FieldDescription>Comma-separated day names (mon…sun).</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="settings-holidays">Public holidays</FieldLabel>
              <Input id="settings-holidays"
                value={sla.holidays}
                onChange={(e) => setSla((s) => ({ ...s, holidays: e.target.value }))}
                placeholder="2026-12-02, 2026-12-03"
              />
              <FieldDescription>Comma-separated ISO dates; these are skipped too.</FieldDescription>
            </Field>
            <Button type="button" disabled={savingSla} onClick={saveSla}>
              {savingSla ? "Saving…" : "Save SLA hours"}
            </Button>
            </FieldGroup></CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                 <Sprout aria-hidden="true" /> BambooHR
              </CardTitle>
              <CardAction><Badge variant={bamboo.subdomain && (bamboo.key_set || bamboo.api_key) ? "success" : "warning"}>
                {bamboo.subdomain && (bamboo.key_set || bamboo.api_key) ? "Configured" : "Not configured"}
              </Badge></CardAction>
              <CardDescription>
              Connect BambooHR so new joiners can be pushed from the Onboarding screen.
              </CardDescription>
            </CardHeader>
            <CardContent><FieldGroup>
            <Field>
              <FieldLabel htmlFor="settings-bamboo-subdomain">Subdomain</FieldLabel>
              <Input id="settings-bamboo-subdomain"
                value={bamboo.subdomain}
                onChange={(e) => setBamboo((b) => ({ ...b, subdomain: e.target.value }))}
                placeholder="yourcompany (from yourcompany.bamboohr.com)"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="settings-bamboo-key">
                API key{" "}
                {bamboo.key_set && <span className="text-xs font-normal text-success">• set</span>}
              </FieldLabel>
              <Input id="settings-bamboo-key"
                type="password"
                value={bamboo.api_key}
                placeholder={bamboo.key_set ? "•••••• (leave blank to keep)" : ""}
                onChange={(e) => setBamboo((b) => ({ ...b, api_key: e.target.value }))}
              />
            </Field>
            <Button type="button" disabled={savingBamboo} onClick={saveBamboo}>
              {savingBamboo ? "Saving…" : "Save BambooHR"}
            </Button>
            </FieldGroup></CardContent>
          </Card>

          <NotificationsCard />
          <BackupsCard />

          <IntegrationsSettings />

          <FxRatesSettings />

          <DemoDataCard variant="card" />

          <Card>
            <CardHeader><CardTitle>Setup guide</CardTitle></CardHeader>
            <CardContent><ol className="flex list-decimal flex-col gap-2 pl-4 text-sm text-muted-foreground">
              <li>Azure Portal → <strong>Entra ID → App registrations → New registration</strong>.</li>
              <li>
                Add a <strong>Web</strong> redirect URI:
                <code className="mt-1 block break-all">{callbackHint}</code>
              </li>
              <li>Copy the <strong>Directory (tenant) ID</strong> and <strong>Application (client) ID</strong>.</li>
              <li>Under <strong>Certificates &amp; secrets</strong>, create a client secret and paste its value here.</li>
              <li>For directory sync, grant the Graph application permission <strong>User.Read.All</strong> and admin-consent it.</li>
              <li>Save, then <strong>Test connection</strong>.</li>
            </ol></CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

type BackupRow = {
  id: string;
  status: string;
  source: "created" | "imported";
  filename?: string;
  size_bytes?: number;
  checksum_sha256?: string;
  error?: string;
  created_at: string;
};

function BackupsCard() {
  const { notify } = useToast();
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => api<BackupRow[]>("/api/backups").then(setRows).catch(() => {});
  useEffect(() => { void load(); }, []);
  async function create() {
    setCreating(true);
    try {
      await api("/api/backups", { method: "POST" });
      notify("Backup started. This card will show it when complete.");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Backup could not start.", "error"); } finally {
      setCreating(false);
    }
  }

  async function importArchive(file: File) {
    setImporting(true);
    const form = new FormData();
    form.append("archive", file);
    try {
      await api("/api/backups/import", { method: "POST", form });
      notify("Backup archive imported.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Backup could not be imported.", "error");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
         <CardTitle className="flex items-center gap-2"><DatabaseBackup aria-hidden="true" /> Backups</CardTitle>
        <CardAction>
        <div className="flex flex-wrap gap-2">
          <Input
            ref={fileRef}
            className="hidden"
            type="file"
            accept=".zip,application/zip"
            aria-label="Import backup archive"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importArchive(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            <Upload data-icon="inline-start" /> {importing ? "Importing…" : "Import backup"}
          </Button>
          <Button type="button" disabled={creating} onClick={create}>
            {creating ? "Starting…" : "Create backup"}
          </Button>
        </div>
        </CardAction>
        <CardDescription>
        PostgreSQL and uploaded media are archived daily at 02:00 Asia/Dubai and retained for 30 days.
        Import adds a downloaded platform archive back to this protected list; it does not restore live data.
        </CardDescription>
      </CardHeader>
      <CardContent>
      {rows.length === 0 ? (
        <div className="text-muted-foreground">No backups yet.</div>
      ) : rows.slice(0, 5).map((row) => (
        <div className="flex items-center justify-between gap-2 border-t border-border py-2" key={row.id}>
          <div>
            <strong>{row.filename ?? "Backup"}</strong>
            <div className="text-xs text-muted-foreground">
              {new Date(row.created_at).toLocaleString()} · {row.status}
              {row.source === "imported" ? " · imported" : ""}
            </div>
          </div>
          {row.status === "completed" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void downloadFile(
                `/api/backups/${row.id}/download`,
                row.filename ?? "backup.zip",
              )}
            >
              <Download data-icon="inline-start" /> Download
            </Button>
          )}
        </div>
      ))}
      </CardContent>
    </Card>
  );
}

function NotificationsCard() {
  const { notify } = useToast();
  const [status, setRecordStatus] = useState<{ outbound_enabled: boolean; email_configured: boolean; slack_configured: boolean; teams_configured: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void api<{ outbound_enabled: boolean; email_configured: boolean; slack_configured: boolean; teams_configured: boolean }>("/api/notifications/channels")
      .then(setRecordStatus)
      .catch(() => {});
  }, []);

  async function sendTest() {
    setIsSubmitting(true);
    try {
      const res = await api<{ external_channels: string[] }>("/api/notifications/test", { method: "POST" });
      notify(res.external_channels.length ? `Sent via: ${res.external_channels.join(", ")}` : "In-app notification sent (no external channels configured).");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }

  }

  return (
    <Card>
      <CardHeader>
         <CardTitle className="flex items-center gap-2"><Bell aria-hidden="true" /> Notifications</CardTitle>
        <CardAction><Badge variant={status?.outbound_enabled ? "success" : "warning"}>{status?.outbound_enabled ? "Outbound on" : "In-app only"}</Badge></CardAction>
        <CardDescription>
        In-app notifications always work. Configure SMTP, a Slack webhook and/or a Microsoft
        Teams webhook (env vars <code>SMTP_HOST</code>, <code>SLACK_WEBHOOK_URL</code>,
        <code> TEAMS_WEBHOOK_URL</code>) and set <code>NOTIFY_OUTBOUND=true</code> to mirror
        notifications to those channels. Employees can mute categories from the bell menu.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant={status?.email_configured ? "success" : "secondary"}>Email {status?.email_configured ? "configured" : "off"}</Badge>
        <Badge variant={status?.slack_configured ? "success" : "secondary"}>Slack {status?.slack_configured ? "configured" : "off"}</Badge>
        <Badge variant={status?.teams_configured ? "success" : "secondary"}>Teams {status?.teams_configured ? "configured" : "off"}</Badge>
      </div>
      <Button type="button" variant="outline" disabled={isSubmitting} onClick={sendTest}>{isSubmitting ? "Sending…" : "Send test notification"}</Button>
      </CardContent>
    </Card>
  );
}
