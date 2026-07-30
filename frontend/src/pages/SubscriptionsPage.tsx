import { useMemo, useRef, useState } from "react";
import {
  BellRing,
  CalendarClock,
  Download,
  FileText,
  Plus,
  Trash2,
  Upload,
  UserMinus,
  Wallet,
} from "lucide-react";
import { api, downloadFile } from "../api/client";
import type {
  Department,
  SpendBucket,
  Subscription,
  SubscriptionReport,
  SubscriptionSummary,
  User,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const STATUSES = ["active", "trial", "paused", "cancelled", "expired"];
const CYCLES = ["monthly", "quarterly", "annual", "weekly", "one_time"];
const STATUS_BADGE: Record<string, "success" | "info" | "warning" | "destructive"> = {
  active: "success", trial: "info", paused: "warning", cancelled: "destructive", expired: "destructive",
};

function money(v?: string | null, ccy = "USD") {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return `${ccy} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CYCLE_LABEL: Record<string, string> = {
  monthly: "/mo",
  quarterly: "/qtr",
  annual: "/yr",
  weekly: "/wk",
  one_time: " once",
};

export default function SubscriptionsPage() {
  const { notify } = useToast();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [tab, setTab] = useState<"list" | "report">("list");
  const [status, setRecordStatus] = useState("");
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const importRef = useRef<HTMLInputElement>(null);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (debouncedQ) p.set("q", debouncedQ);
    return p.toString();
  }, [status, debouncedQ]);
  const subs = useFetch<Subscription[]>(`/api/subscriptions${qs ? `?${qs}` : ""}`);
  const summary = useFetch<SubscriptionSummary>("/api/subscriptions/summary");
  const renewals = useFetch<Subscription[]>("/api/subscriptions/renewals?days=30");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function reloadAll() {
    subs.reload();
    summary.reload();
    renewals.reload();
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await api<{ created: number; updated: number; errors: string[] }>(
        "/api/subscriptions/import",
        { method: "POST", form: fd },
      );
      const errs = res.errors.length ? ` (${res.errors.length} skipped)` : "";
      notify(`Imported: ${res.created} new, ${res.updated} updated${errs}.`);
      reloadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Import failed", "error");
    }
    if (importRef.current) importRef.current.value = "";
  }

  async function remindOwners() {
    try {
      const res = await api<{ reminders_sent: number }>(
        "/api/subscriptions/renewals/notify?days=30",
        { method: "POST" },
      );
      notify(`Sent ${res.reminders_sent} renewal reminder(s).`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  const s = summary.data;
  return (
    <div>
      <PageHead
        title="Subscriptions"
        subtitle="SaaS & tools the company pays for — billing, renewals and who holds a seat."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline"
              onClick={() =>
                downloadFile("/api/subscriptions/template.csv", "subscriptions-template.csv").catch(
                  () => notify("Download failed", "error"),
                )
              }
            >
              <FileText data-icon="inline-start" /> Template
            </Button>
            <Button type="button" variant="outline" onClick={() => importRef.current?.click()}>
              <Upload data-icon="inline-start" /> Import
            </Button>
            <Button type="button" variant="outline"
              onClick={() =>
                downloadFile("/api/subscriptions/export.csv", "subscriptions.csv").catch(() =>
                  notify("Export failed", "error"),
                )
              }
            >
              <Download data-icon="inline-start" /> Export
            </Button>
            <Button type="button" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" /> New
            </Button>
          </div>
        }
      />
      <Input aria-label="Import Csv" ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} />

      {s && (
        <div className="mb-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          <Metric icon={<Wallet size={16} />} label="Subscriptions" value={s.total} />
          <Metric icon={<Wallet size={16} />} label="Monthly spend" value={money(s.monthly_spend)} />
          <Metric icon={<CalendarClock size={16} />} label="Renewing ≤30d" value={s.renewing_soon} />
          <Metric label="Active" value={s.by_status.active ?? 0} />
        </div>
      )}

      {/* Renewing-soon banner */}
      {(renewals.data?.length ?? 0) > 0 && (
        <Card className="mb-4 ring-warning/40">
          <CardHeader className="grid grid-cols-[1fr_auto] items-center">
            <CardTitle className="inline-flex items-center gap-2">
              <CalendarClock /> Renewing in the next 30 days ({renewals.data!.length})
            </CardTitle>
            {isAdmin && (
              <Button type="button" variant="outline" size="sm" onClick={remindOwners}>
                <BellRing data-icon="inline-start" /> Remind owners
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {renewals.data!.slice(0, 6).map((r) => (
              <Button type="button"
                key={r.id}
                variant="ghost"
                className="h-auto w-full justify-between px-2 py-1 text-left"
                onClick={() => setOpenId(r.id)}
              >
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">{r.end_date} · {money(r.monthly_cost, r.currency)}/mo</span>
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      <ToggleGroup className="mb-4" value={[tab]} onValueChange={(value) => value[0] && setTab(value[0] as typeof tab)} variant="outline">
        <ToggleGroupItem value="list">Subscriptions</ToggleGroupItem>
        <ToggleGroupItem value="report">Spend report</ToggleGroupItem>
      </ToggleGroup>

      {tab === "report" ? (
        <SpendReport />
      ) : (
      <>
      <Card className="mb-4"><CardContent>
        <FieldGroup className="grid gap-3 sm:grid-cols-[3fr_1fr]">
          <Field><FieldLabel htmlFor="subscriptions-search">Search</FieldLabel>
            <Input id="subscriptions-search" placeholder="Name or vendor…" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field><FieldLabel htmlFor="subscriptions-status">Status</FieldLabel>
            <Select
              items={[{ value: null, label: "All" }, ...STATUSES.map((st) => ({ value: st, label: st }))]}
              value={status || null}
              onValueChange={(value) => setRecordStatus(value ?? "")}
            >
              <SelectTrigger id="subscriptions-status" aria-label="Status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={null}>All</SelectItem>
                {STATUSES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </CardContent></Card>

      <Card className="py-0"><CardContent className="p-0">
        {subs.loading ? (
          <Loading />
        ) : (subs.data?.length ?? 0) === 0 ? (
          <Empty message="No subscriptions yet." />
        ) : (
          <Table>
            <TableHeader><TableRow>
                <TableHead>Subscription</TableHead><TableHead>Assignment</TableHead><TableHead className="text-right">Billing</TableHead>
                <TableHead className="text-right">Seats</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {subs.data!.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="max-w-[24rem] whitespace-normal">
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto max-w-full justify-start p-0 text-left font-semibold text-foreground"
                      aria-label={`Open subscription: ${sub.name}`}
                      onClick={() => setOpenId(sub.id)}
                    >
                      <span className="truncate">{sub.name}</span>
                    </Button>
                    {sub.vendor && <div className="text-xs text-muted-foreground">{sub.vendor}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Badge variant="secondary">{sub.scope}</Badge>
                    {sub.scope === "department" && sub.department_name && (
                      <span className="text-xs text-muted-foreground"> · {sub.department_name}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {money(sub.monthly_cost, sub.currency)}
                    <span className="text-xs text-muted-foreground">/mo</span>
                    {sub.cost != null && (
                      <div className="text-xs text-muted-foreground">
                        {money(sub.cost, sub.currency)}
                        {CYCLE_LABEL[sub.billing_cycle] ?? ""}
                        {sub.cost_type === "per_seat" ? " / seat" : ""}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{sub.scope === "person" ? sub.active_seats : "—"}</TableCell>
                  <TableCell><Badge variant={STATUS_BADGE[sub.status] ?? "secondary"}>{sub.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>
      </>
      )}

      {adding && (
        <SubscriptionModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reloadAll(); }} />
      )}
      {openId && (
        <SubscriptionDetail id={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} />
      )}
    </div>
  );
}

function SpendReport() {
  const { data, loading } = useFetch<SubscriptionReport>("/api/subscriptions/report");
  if (loading) return <Loading />;
  if (!data) return <Empty message="No spend data." />;
  const max = (rows: { monthly: string }[]) =>
    Math.max(1, ...rows.map((r) => Number(r.monthly)));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <Metric icon={<Wallet size={16} />} label="Monthly total" value={money(data.monthly_total)} />
        <Metric icon={<Wallet size={16} />} label="Annual total" value={money(data.annual_total)} />
        <Metric label="Active seats" value={data.active_seats} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <BarCard title="By department" rows={data.by_department} max={max(data.by_department)} />
        <BarCard title="By vendor" rows={data.by_vendor} max={max(data.by_vendor)} />
        <BarCard title="By billing cycle" rows={data.by_billing_cycle} max={max(data.by_billing_cycle)} />
        <BarCard title="Top subscriptions" rows={data.top} max={max(data.top)} />
      </div>
    </div>
  );
}

function BarCard({ title, rows, max }: { title: string; rows: SpendBucket[]; max: number }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex justify-between text-sm">
                <span className="truncate">{r.label} <span className="text-xs text-muted-foreground">· {r.count}</span></span>
                <span className="font-medium">{money(r.monthly)}</span>
              </div>
              <div className="mt-0.5 h-1.5 bg-muted">
                <div
                  className="h-1.5 bg-primary"
                  style={{ width: `${(Number(r.monthly) / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      </CardContent>
    </Card>
  );
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card size="sm"><CardContent>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </CardContent></Card>
  );
}

type FormState = Partial<Subscription> & { user_ids?: string[] };

function SubscriptionModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Subscription;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const departments = useFetch<Department[]>("/api/departments");
  const users = useFetch<User[]>("/api/users");
  const [f, setF] = useState<FormState>(
    initial ?? {
      name: "",
      scope: "person",
      cost_type: "flat",
      currency: "USD",
      billing_cycle: "monthly",
      status: "active",
      auto_renew: true,
      user_ids: [],
    },
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: keyof FormState, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: (f.name ?? "").trim(),
        vendor: f.vendor || null,
        plan: f.plan || null,
        url: f.url || null,
        status: f.status,
        scope: f.scope,
        department_id: f.scope === "department" ? f.department_id || null : null,
        cost_type: f.cost_type,
        cost: f.cost === "" ? null : f.cost ?? null,
        currency: f.currency || "USD",
        billing_cycle: f.billing_cycle,
        start_date: f.start_date || null,
        end_date: f.end_date || null,
        auto_renew: f.auto_renew ?? true,
        owner_id: f.owner_id || null,
        notes: f.notes || null,
      };
      if (initial) {
        await api(`/api/subscriptions/${initial.id}`, { method: "PATCH", body });
      } else {
        await api("/api/subscriptions", { method: "POST", body: { ...body, user_ids: f.user_ids ?? [] } });
      }
      notify(initial ? "Subscription updated." : "Subscription created.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={initial ? `Edit ${initial.name}` : "New subscription"} onClose={onClose} maxWidth={620}>
      <form onSubmit={save}>
        <FieldGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="subscription-name">Name *</FieldLabel><Input id="subscription-name" required value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="ChatGPT Team" /></Field>
          <Field><FieldLabel htmlFor="subscription-vendor">Vendor</FieldLabel><Input id="subscription-vendor" value={f.vendor ?? ""} onChange={(e) => set("vendor", e.target.value)} placeholder="OpenAI" /></Field>
        </FieldGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="subscription-plan">Plan</FieldLabel><Input id="subscription-plan" value={f.plan ?? ""} onChange={(e) => set("plan", e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="subscription-url">Login URL</FieldLabel><Input id="subscription-url" value={f.url ?? ""} onChange={(e) => set("url", e.target.value)} /></Field>
        </FieldGroup>

        <FieldGroup className="grid gap-3 sm:grid-cols-3">
          <Field><FieldLabel htmlFor="subscription-scope">Assignment</FieldLabel>
            <Select
              items={[{ value: "company", label: "Company-wide" }, { value: "department", label: "Department" }, { value: "person", label: "Specific people (seats)" }]}
              value={f.scope}
              onValueChange={(value) => set("scope", value ?? "")}
            >
              <SelectTrigger id="subscription-scope" aria-label="Assignment" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="company">Company-wide</SelectItem>
                <SelectItem value="department">Department</SelectItem>
                <SelectItem value="person">Specific people (seats)</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          {f.scope === "department" && (
            <Field><FieldLabel htmlFor="subscription-department">Department</FieldLabel>
              <Select
                items={[{ value: null, label: "Select…" }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
                value={f.department_id || null}
                onValueChange={(value) => set("department_id", value ?? "")}
              >
                <SelectTrigger id="subscription-department" aria-label="Department" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value={null}>Select…</SelectItem>
                  {(departments.data ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
          )}
          <Field><FieldLabel htmlFor="subscription-state">Status</FieldLabel>
            <Select items={STATUSES.map((st) => ({ value: st, label: st }))} value={f.status} onValueChange={(value) => set("status", value ?? "")}>
              <SelectTrigger id="subscription-state" aria-label="Status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {STATUSES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <FieldGroup className="grid gap-3 sm:grid-cols-4">
          <Field><FieldLabel htmlFor="subscription-cost-type">Cost type</FieldLabel>
            <Select
              items={[{ value: "flat", label: "Flat total" }, { value: "per_seat", label: "Per seat" }]}
              value={f.cost_type}
              onValueChange={(value) => set("cost_type", value ?? "")}
            >
              <SelectTrigger id="subscription-cost-type" aria-label="Cost type" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="flat">Flat total</SelectItem><SelectItem value="per_seat">Per seat</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel htmlFor="subscription-cost">{f.cost_type === "per_seat" ? "Cost / seat" : "Cost"}</FieldLabel><Input id="subscription-cost" type="number" step="0.01" value={f.cost ?? ""} onChange={(e) => set("cost", e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="subscription-currency">Currency</FieldLabel><Input id="subscription-currency" value={f.currency ?? "USD"} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          <Field><FieldLabel htmlFor="subscription-cycle">Billing</FieldLabel>
            <Select
              items={CYCLES.map((c) => ({ value: c, label: c.replace("_", " ") }))}
              value={f.billing_cycle}
              onValueChange={(value) => set("billing_cycle", value ?? "")}
            >
              <SelectTrigger id="subscription-cycle" aria-label="Billing" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {CYCLES.map((c) => <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <FieldGroup className="grid gap-3 sm:grid-cols-3">
          <Field><FieldLabel htmlFor="subscription-start">Start date</FieldLabel><Input id="subscription-start" type="date" value={f.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="subscription-end">End / renewal date</FieldLabel><Input id="subscription-end" type="date" value={f.end_date ?? ""} onChange={(e) => set("end_date", e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="subscription-owner">Owner</FieldLabel>
            <Select
              items={[{ value: null, label: "—" }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]}
              value={f.owner_id || null}
              onValueChange={(value) => set("owner_id", value ?? "")}
            >
              <SelectTrigger id="subscription-owner" aria-label="Owner" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={null}>—</SelectItem>
                {(users.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        {!initial && f.scope === "person" && (
          <SeatPicker
            users={users.data ?? []}
            selected={f.user_ids ?? []}
            onChange={(ids) => set("user_ids", ids)}
          />
        )}

        <Field><FieldLabel htmlFor="subscription-notes">Notes</FieldLabel><Textarea id="subscription-notes" rows={2} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : initial ? "Save changes" : "Create"}
          </Button>
        </div>
        </FieldGroup>
      </form>
    </Modal>
  );
}

function SeatPicker({
  users,
  selected,
  onChange,
}: {
  users: User[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = users.filter((u) =>
    (u.display_name ?? u.email ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <Field>
      <FieldLabel htmlFor="seat-search">Assign people ({selected.length})</FieldLabel>
      <Input id="seat-search" placeholder="Search staff…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 max-h-44 overflow-auto border border-border">
        {filtered.slice(0, 60).map((u) => (
          <Field key={u.id} orientation="horizontal" className="px-2 py-1.5 hover:bg-muted">
            <Checkbox id={`seat-${u.id}`} checked={selected.includes(u.id)} onCheckedChange={() => toggle(u.id)} />
            <FieldLabel htmlFor={`seat-${u.id}`}>
            <span>{u.display_name ?? u.email}</span>
            {u.job_title && <span className="text-xs text-muted-foreground">· {u.job_title}</span>}
            </FieldLabel>
          </Field>
        ))}
      </div>
    </Field>
  );
}

function SubscriptionDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const sub = useFetch<Subscription>(`/api/subscriptions/${id}`);
  const users = useFetch<User[]>("/api/users");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const data = sub.data;

  async function revokeSeat(seatId: string) {
    await api(`/api/subscriptions/seats/${seatId}/revoke`, { method: "POST" });
    notify("Seat revoked.");
    sub.reload();
    onChanged();
  }
  async function removeSeat(seatId: string) {
    await api(`/api/subscriptions/seats/${seatId}`, { method: "DELETE" });
    sub.reload();
    onChanged();
  }
  async function remove() {
    if (!data) return;
    await api(`/api/subscriptions/${id}`, { method: "DELETE" });
    notify("Subscription deleted.");
    onChanged();
    onClose();
  }

  if (editing && data) {
    return (
      <SubscriptionModal
        initial={data}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); sub.reload(); onChanged(); }}
      />
    );
  }

  return (
    <Modal title={data?.name ?? "Subscription"} onClose={onClose} maxWidth={620}>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGE[data.status] ?? "secondary"}>{data.status}</Badge>
            <Badge variant="secondary">{data.scope}</Badge>
            {data.vendor && <Badge variant="secondary">{data.vendor}</Badge>}
            <span className="text-sm text-muted-foreground">
              {money(data.monthly_cost, data.currency)}/mo
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            {data.plan && <DetailField label="Plan" value={data.plan} />}
            <DetailField label="Billing" value={`${money(data.cost, data.currency)}${CYCLE_LABEL[data.billing_cycle] ?? ""}${data.cost_type === "per_seat" ? " / seat" : ""}`} />
            {data.start_date && <DetailField label="Start" value={data.start_date} />}
            {data.end_date && <DetailField label="End / renewal" value={data.end_date} />}
            {data.owner_name && <DetailField label="Owner" value={data.owner_name} />}
            {data.department_name && <DetailField label="Department" value={data.department_name} />}
          </div>
          {data.url && (
            <a
              href={data.url}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "link" }), "mt-2 px-0")}
            >
              Open login ↗
            </a>
          )}
          {data.notes && <p className="mt-2 text-sm text-muted-foreground">{data.notes}</p>}

          {data.scope === "person" && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h4>Seats ({data.active_seats} active)</h4>
                <Button type="button" variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
                  {adding ? "Done" : "+ Add people"}
                </Button>
              </div>
              {adding && (
                <AddSeats
                  users={users.data ?? []}
                  existing={data.seats.map((s) => s.user_id)}
                  onAdd={async (ids) => {
                    await api(`/api/subscriptions/${id}/seats`, { method: "POST", body: { user_ids: ids } });
                    sub.reload();
                    onChanged();
                  }}
                />
              )}
              <div className="mt-2 divide-y divide-border">
                {data.seats.length === 0 && <p className="text-sm text-muted-foreground">No one assigned yet.</p>}
                {data.seats.map((seat) => (
                  <div key={seat.id} className="flex items-center justify-between py-1.5 text-sm">
                    <div>
                      {seat.user_name}
                      {seat.user_title && <span className="text-xs text-muted-foreground"> · {seat.user_title}</span>}
                      {seat.status === "revoked" && <Badge variant="destructive" className="ml-2">revoked</Badge>}
                    </div>
                    <div className="flex gap-1">
                      {seat.status === "active" && (
                        <Button type="button" variant="outline" size="sm" onClick={() => revokeSeat(seat.id)}>
                          <UserMinus data-icon="inline-start" /> Revoke
                        </Button>
                      )}
                      <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => removeSeat(seat.id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-between gap-2">
            <Button type="button" variant="destructive" onClick={() => setDeleting(true)}>Delete</Button>
            <Button type="button" onClick={() => setEditing(true)}>Edit</Button>
          </div>
        </>
      )}
      {deleting && data && (
        <ConfirmDialog
          title="Delete subscription"
          message={`Delete subscription “${data.name}”?`}
          confirmLabel="Delete subscription"
          danger
          onConfirm={remove}
          onClose={() => setDeleting(false)}
        />
      )}
    </Modal>
  );
}

function AddSeats({ users, existing, onAdd }: { users: User[]; existing: string[]; onAdd: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <div className="border border-border p-2">
      <SeatPicker
        users={users.filter((u) => !existing.includes(u.id))}
        selected={sel}
        onChange={setSel}
      />
      <Button type="button"
        className="mt-1"
        disabled={!sel.length}
        onClick={() => { onAdd(sel); setSel([]); }}
      >
        Add {sel.length || ""}
      </Button>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
