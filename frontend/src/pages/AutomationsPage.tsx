import { useEffect, useState } from "react";
import { AlarmClock, BellRing, Mail, Play, Zap } from "lucide-react";
import { api } from "../api/client";
import { ErrorState, Loading, PageHead, useToast } from "../components/ui";

interface ReminderRule {
  enabled: boolean;
  lead_days: number;
}
interface CatalogueItem {
  key: string;
  label: string;
  description: string;
}
interface LastResult {
  created: number;
  by_type: Record<string, number>;
  at: string;
}
interface AutomationsStatus {
  config: Record<string, ReminderRule>;
  catalogue: CatalogueItem[];
  last_run: string | null;
  last_result: LastResult | null;
  outbound_enabled: boolean;
  scheduler_enabled: boolean;
}

// Reminder types where "lead days" doesn't apply (they fire on the day / weekly).
const NO_LEAD = new Set(["birthday", "work_anniversary", "timesheet"]);

export default function AutomationsPage() {
  const { notify } = useToast();
  const [status, setStatus] = useState<AutomationsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, ReminderRule>>({});
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setError(null);
    try {
      const s = await api<AutomationsStatus>("/api/hr/automations");
      setStatus(s);
      setConfig(s.config);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
  }, []);

  function update(key: string, patch: Partial<ReminderRule>) {
    setConfig((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await api("/api/hr/automations", { method: "PUT", body: { config } });
      notify("Automation settings saved.");
      setDirty(false);
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await api<LastResult>("/api/hr/automations/run", { method: "POST" });
      notify(
        res.created > 0
          ? `Sent ${res.created} reminder${res.created > 1 ? "s" : ""}.`
          : "Ran — nothing due right now.",
      );
      load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    } finally {
      setRunning(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!status) return <Loading />;

  const enabledCount = Object.values(config).filter((r) => r.enabled).length;

  return (
    <div>
      <PageHead
        title="HR Automations"
        subtitle="Scheduled reminders that run on their own — expiries, deadlines, birthdays and more."
        action={
          <div className="flex flex-none gap-2">
            <button
              className="btn inline-flex items-center gap-1.5"
              style={{ flex: "0 0 auto" }}
              disabled={running}
              onClick={runNow}
            >
              <Play size={15} /> {running ? "Running…" : "Run now"}
            </button>
            <button
              className="btn-primary inline-flex items-center gap-1.5"
              style={{ flex: "0 0 auto" }}
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        }
      />

      {/* Status strip */}
      <div
        className="grid mb-4"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}
      >
        <StatusTile
          icon={<Zap size={18} />}
          label="Active reminders"
          value={`${enabledCount} of ${status.catalogue.length}`}
        />
        <StatusTile
          icon={<AlarmClock size={18} />}
          label="Scheduler"
          value={status.scheduler_enabled ? "Running (every 12h)" : "Disabled"}
          tone={status.scheduler_enabled ? "ok" : "warn"}
        />
        <StatusTile
          icon={<Mail size={18} />}
          label="External delivery"
          value={status.outbound_enabled ? "Email / Slack / Teams" : "In-app only"}
          tone={status.outbound_enabled ? "ok" : "muted"}
        />
        <StatusTile
          icon={<BellRing size={18} />}
          label="Last run"
          value={status.last_run ? new Date(status.last_run).toLocaleString() : "Never"}
          sub={
            status.last_result
              ? `${status.last_result.created} reminder(s) sent`
              : undefined
          }
        />
      </div>

      {!status.outbound_enabled && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Mail size={16} className="mt-0.5 flex-none" />
          <div>
            Reminders are currently delivered <strong>in-app only</strong>. To also send
            them by email, Slack or Teams, set <code>NOTIFY_OUTBOUND=true</code> (and the
            matching SMTP / webhook variables) on the backend.
          </div>
        </div>
      )}

      {/* Reminder rules */}
      <div className="card !p-0">
        {status.catalogue.map((item, i) => {
          const rule = config[item.key] ?? { enabled: false, lead_days: 0 };
          const lastCount = status.last_result?.by_type?.[item.key] ?? 0;
          return (
            <div
              key={item.key}
              className={`flex flex-wrap items-center gap-4 p-4 ${
                i > 0 ? "border-t border-[var(--border)]" : ""
              }`}
            >
              {/* Toggle */}
              <button
                role="switch"
                aria-checked={rule.enabled}
                aria-label={`Toggle ${item.label}`}
                onClick={() => update(item.key, { enabled: !rule.enabled })}
                className="relative h-6 w-11 flex-none rounded-full border-0 !p-0 transition-colors"
                style={{
                  background: rule.enabled ? "var(--brand-600)" : "var(--surface-3)",
                }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                  style={{ left: rule.enabled ? "22px" : "2px" }}
                />
              </button>

              {/* Label */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold text-ink">
                  {item.label}
                  {lastCount > 0 && (
                    <span className="badge green">{lastCount} last run</span>
                  )}
                </div>
                <div className="muted text-[13px]">{item.description}</div>
              </div>

              {/* Lead time */}
              {NO_LEAD.has(item.key) ? (
                <span className="muted flex-none text-xs">
                  {item.key === "timesheet" ? "weekly" : "on the day"}
                </span>
              ) : (
                <label className="flex flex-none items-center gap-2 text-sm">
                  <span className="muted">notify</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={rule.lead_days}
                    disabled={!rule.enabled}
                    onChange={(e) =>
                      update(item.key, { lead_days: Number(e.target.value) })
                    }
                    className="!w-16 text-center"
                  />
                  <span className="muted">days before</span>
                </label>
              )}
            </div>
          );
        })}
      </div>

      <p className="muted mt-3 text-xs">
        Reminders run automatically twice a day and are de-duplicated, so the same alert
        is never sent twice. Use <strong>Run now</strong> to trigger them immediately.
      </p>
    </div>
  );
}

function StatusTile({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "ok" | "warn" | "muted";
}) {
  const color =
    tone === "ok"
      ? "var(--ok)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "muted"
          ? "var(--muted)"
          : "var(--brand-600)";
  return (
    <div className="card flex items-center gap-3 !py-3.5">
      <span
        className="grid h-10 w-10 flex-none place-items-center rounded-xl"
        style={{ background: "var(--brand-50)", color }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold leading-tight" style={{ color }}>
          {value}
        </span>
        <span className="block truncate text-xs font-medium text-ink-muted">{label}</span>
        {sub && <span className="block truncate text-[11px] text-ink-muted/80">{sub}</span>}
      </span>
    </div>
  );
}
