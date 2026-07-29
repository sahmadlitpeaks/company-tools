import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { AlarmClock, BellRing, Mail, Play, Zap } from "lucide-react";
import { api } from "../api/client";
import { ErrorState, Loading, PageHead, useToast } from "../components/ui";
import { cn } from "../lib/utils";
import { numericInput } from "../utils/numbers";

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
  const [status, setRecordStatus] = useState<AutomationsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, ReminderRule>>({});
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setError(null);
    try {
      const s = await api<AutomationsStatus>("/api/hr/automations");
      setRecordStatus(s);
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
            <Button type="button" variant="outline"
              disabled={running}
              onClick={runNow}
            >
              <Play data-icon="inline-start" /> {running ? "Running…" : "Run now"}
            </Button>
            <Button aria-label="Save" type="button"
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
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
        <Alert className="mb-4">
          <Mail />
          <AlertDescription>
            Reminders are currently delivered <strong>in-app only</strong>. To also send
            them by email, Slack or Teams, set <code>NOTIFY_OUTBOUND=true</code> (and the
            matching SMTP / webhook variables) on the backend.
          </AlertDescription>
        </Alert>
      )}

      {/* Reminder rules */}
      <Card>
        <CardContent className="p-0">
        {status.catalogue.map((item, i) => {
          const rule = config[item.key] ?? { enabled: false, lead_days: 0 };
          const lastCount = status.last_result?.by_type?.[item.key] ?? 0;
          return (
            <div
              key={item.key}
              className={`flex flex-wrap items-center gap-4 p-4 ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              {/* Toggle */}
              <Switch
                checked={rule.enabled}
                aria-label={`Toggle ${item.label}`}
                onCheckedChange={(enabled) => update(item.key, { enabled })}
              />

              {/* Label */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  {item.label}
                  {lastCount > 0 && (
                    <Badge variant="success">{lastCount} last run</Badge>
                  )}
                </div>
                <div className="text-[13px] text-muted-foreground">{item.description}</div>
              </div>

              {/* Lead time */}
              {NO_LEAD.has(item.key) ? (
                <span className="flex-none text-xs text-muted-foreground">
                  {item.key === "timesheet" ? "weekly" : "on the day"}
                </span>
              ) : (
                <Label className="flex flex-none items-center gap-2 text-sm">
                  <span className="text-muted-foreground">notify</span>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={rule.lead_days}
                    disabled={!rule.enabled}
                    onChange={(e) =>
                      update(item.key, { lead_days: numericInput(e.target.value, rule.lead_days) })
                    }
                    className="w-16 text-center"
                  />
                  <span className="text-muted-foreground">days before</span>
                </Label>
              )}
            </div>
          );
        })}
        </CardContent>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
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
  const colorClass =
    tone === "ok"
      ? "text-success"
      : tone === "warn"
        ? "text-warning-foreground"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-primary";
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
      <span
        className="grid size-10 flex-none place-items-center bg-primary/10 text-foreground"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block truncate text-[15px] font-bold leading-tight", colorClass)}>
          {value}
        </span>
        <span className="block truncate text-xs font-medium text-muted-foreground">{label}</span>
        {sub && <span className="block truncate text-[11px] text-muted-foreground/80">{sub}</span>}
      </span>
      </CardContent>
    </Card>
  );
}
