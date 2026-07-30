import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field as FormField, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useMemo, useRef, useState } from "react";
import {
  CreditCard,
  Download,
  FileText,
  History,
  Phone,
  Plus,
  Smartphone,
  Trash2,
  Upload,
  UserCheck,
  UserX,
} from "lucide-react";
import { api, downloadFile } from "../api/client";
import type {
  PhoneBill,
  PhoneLine,
  PhoneLineDetail,
  PhoneLineEvent,
  PhoneSummary,
  User,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const STATUSES = ["available", "assigned", "suspended", "cancelled"];
const STATUS_BADGE: Record<string, "info" | "success" | "warning" | "destructive"> = {
  available: "info",
  assigned: "success",
  suspended: "warning",
  cancelled: "destructive",
};

export default function PhoneLinesPage() {
  const [status, setRecordStatus] = useState("");
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (debouncedQ) p.set("q", debouncedQ);
    return p.toString();
  }, [status, debouncedQ]);
  const lines = useFetch<PhoneLine[]>(`/api/phone-lines${qs ? `?${qs}` : ""}`);
  const summary = useFetch<PhoneSummary>("/api/phone-lines/summary");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { notify } = useToast();
  const importRef = useRef<HTMLInputElement>(null);

  function reloadAll() {
    lines.reload();
    summary.reload();
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await api<{ created: number; updated: number; errors: string[] }>(
        "/api/phone-lines/import",
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

  const s = summary.data;
  return (
    <div>
      <PageHead
        title="Phone Lines"
        subtitle="Track mobile numbers, who holds them, packages and billing."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline"
              onClick={() =>
                downloadFile("/api/phone-lines/template.csv", "phone-lines-template.csv").catch(
                  () => notify("Download failed", "error"),
                )
              }
            >
              <FileText data-icon="inline-start" /> Template
            </Button>
            <Button type="button" variant="outline"
              onClick={() => importRef.current?.click()}
            >
              <Upload data-icon="inline-start" /> Import
            </Button>
            <Button type="button" variant="outline"
              onClick={() =>
                downloadFile("/api/phone-lines/export.csv", "phone-lines.csv").catch(() =>
                  notify("Export failed", "error"),
                )
              }
            >
              <Download data-icon="inline-start" /> Export
            </Button>
            <Button type="button" onClick={() => setAdding(true)}><Plus data-icon="inline-start" /> Add line</Button>
            <Input aria-label="Import Csv" ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} />
          </div>
        }
      />

      {s && (
        <div className="mb-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          <Metric icon={<Phone size={16} />} label="Total lines" value={s.total} />
          <Metric icon={<UserCheck size={16} />} label="Assigned" value={s.assigned} />
          <Metric icon={<CreditCard size={16} />} label="Monthly spend" value={fmtMoney(s.monthly_cost)} />
          <Metric label="Available" value={s.by_status.available ?? 0} />
        </div>
      )}

      <Card className="mb-4"><CardContent><FieldGroup className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(10rem,1fr)]">
          <FormField><FieldLabel htmlFor="phone-search">Search</FieldLabel>
            <Input id="phone-search" aria-label="Number, carrier or package…"
              placeholder="Number, carrier or package…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </FormField>
          <FormField><FieldLabel htmlFor="phone-status">Status</FieldLabel>
            <Select items={[{ value: null, label: "All" }, ...STATUSES.map((st) => ({ value: st, label: st }))]} value={status || null} onValueChange={(value) => setRecordStatus(value ?? "")}>
              <SelectTrigger id="phone-status" aria-label="Status" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>All</SelectItem>
              {STATUSES.map((st) => (
                <SelectItem key={st} value={st}>{st}</SelectItem>
              ))}
              </SelectGroup></SelectContent>
            </Select>
          </FormField>
        </FieldGroup></CardContent></Card>

      <Card className="py-0"><CardContent className="p-0">
        {lines.loading ? (
          <div className="px-(--card-spacing)"><Loading /></div>
        ) : (lines.data?.length ?? 0) === 0 ? (
          <div className="px-(--card-spacing)"><Empty message="No phone lines yet." /></div>
        ) : (
         <Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Carrier</TableHead><TableHead>Package</TableHead><TableHead className="text-right">Monthly</TableHead><TableHead>Assigned to</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
              {lines.data!.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 font-semibold text-foreground tabular-nums"
                      aria-label={`Open phone line ${l.number}`}
                      onClick={() => setOpenId(l.id)}
                    >
                      {l.number}
                    </Button>
                  </TableCell>
                  <TableCell>{l.carrier ?? "—"}</TableCell>
                  <TableCell>
                    {l.plan_name ?? "—"}
                    {l.data_allowance && <span className="text-xs text-muted-foreground"> · {l.data_allowance}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(l.monthly_cost)}</TableCell>
                  <TableCell>
                    {l.assigned_to_name ? (
                      <div className="leading-tight">
                        <div>{l.assigned_to_name}</div>
                        {l.assigned_to_title && (
                          <div className="text-xs text-muted-foreground">{l.assigned_to_title}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant={STATUS_BADGE[l.status] ?? "secondary"}>{l.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody></Table>
        )}
      </CardContent></Card>

      {adding && (
        <LineModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reloadAll();
          }}
        />
      )}
      {openId && (
        <LineDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} />
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card><CardContent><div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </div><div className="mt-1 text-2xl font-semibold">{value}</div></CardContent></Card>
  );
}

function fmtMoney(v?: string | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function LineModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    number: "",
    carrier: "",
    plan_name: "",
    sim_number: "",
    monthly_cost: "",
    data_allowance: "",
    contract_start: "",
    contract_end: "",
    notes: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/phone-lines", {
        method: "POST",
        body: {
          number: form.number.trim(),
          carrier: form.carrier || null,
          plan_name: form.plan_name || null,
          sim_number: form.sim_number || null,
          monthly_cost: form.monthly_cost || null,
          data_allowance: form.data_allowance || null,
          contract_start: form.contract_start || null,
          contract_end: form.contract_end || null,
          notes: form.notes || null,
        },
      });
      notify("Phone line added.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Add phone line" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4"><FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField><FieldLabel htmlFor="phone-number">Number *</FieldLabel><Input id="phone-number" aria-label="+9715xxxxxxxx" required placeholder="+9715xxxxxxxx" value={form.number} onChange={(e) => set("number", e.target.value)} /></FormField>
          <FormField><FieldLabel htmlFor="phone-carrier">Carrier</FieldLabel><Input id="phone-carrier" aria-label="Etisalat / du" placeholder="Etisalat / du" value={form.carrier} onChange={(e) => set("carrier", e.target.value)} /></FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField><FieldLabel htmlFor="phone-package">Package</FieldLabel><Input id="phone-package" aria-label="Business 20GB" placeholder="Business 20GB" value={form.plan_name} onChange={(e) => set("plan_name", e.target.value)} /></FormField>
          <FormField><FieldLabel htmlFor="phone-monthly">Monthly cost</FieldLabel><Input id="phone-monthly" type="number" step="0.01" min="0" value={form.monthly_cost} onChange={(e) => set("monthly_cost", e.target.value)} /></FormField>
          <FormField><FieldLabel htmlFor="phone-data">Data allowance</FieldLabel><Input id="phone-data" aria-label="20 GB" placeholder="20 GB" value={form.data_allowance} onChange={(e) => set("data_allowance", e.target.value)} /></FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField><FieldLabel htmlFor="phone-sim">SIM / ICCID</FieldLabel><Input id="phone-sim" value={form.sim_number} onChange={(e) => set("sim_number", e.target.value)} /></FormField>
          <FormField><FieldLabel htmlFor="phone-contract-start">Contract start</FieldLabel><Input id="phone-contract-start" type="date" value={form.contract_start} onChange={(e) => set("contract_start", e.target.value)} /></FormField>
          <FormField><FieldLabel htmlFor="phone-contract-end">Contract end</FieldLabel><Input id="phone-contract-end" type="date" value={form.contract_end} onChange={(e) => set("contract_end", e.target.value)} /></FormField>
        </div>
        <FormField><FieldLabel htmlFor="phone-notes">Notes</FieldLabel><Textarea id="phone-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></FormField>
        </FieldGroup><div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Add line"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LineDetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { notify } = useToast();
  const detail = useFetch<PhoneLineDetail>(`/api/phone-lines/${id}`);
  const users = useFetch<User[]>("/api/users");
  const [assignee, setAssignee] = useState("");
  const [bill, setBill] = useState({ period: "", amount: "", data_used: "", status: "unpaid" });
  const l = detail.data;

  async function act(path: string, body: Record<string, unknown> = {}) {
    try {
      await api(`/api/phone-lines/${id}${path}`, { method: "POST", body });
      detail.reload();
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
  }
  async function patch(body: Record<string, unknown>) {
    await api(`/api/phone-lines/${id}`, { method: "PATCH", body });
    detail.reload();
    onChanged();
  }
  async function addBill() {
    if (!bill.period.trim()) {
      notify("Enter a billing period (YYYY-MM).", "error");
      return;
    }
    await api(`/api/phone-lines/${id}/bills`, {
      method: "POST",
      body: {
        period: bill.period.trim(),
        amount: bill.amount || null,
        data_used: bill.data_used || null,
        status: bill.status,
      },
    });
    setBill({ period: "", amount: "", data_used: "", status: "unpaid" });
    detail.reload();
    onChanged();
    notify("Bill logged.");
  }
  async function delBill(b: PhoneBill) {
    await api(`/api/phone-lines/bills/${b.id}`, { method: "DELETE" });
    detail.reload();
  }
  async function removeLine() {
    await api(`/api/phone-lines/${id}`, { method: "DELETE" });
    notify("Line deleted.");
    onChanged();
    onClose();
  }

  return (
    <Modal title={l ? l.number : "Phone line"} onClose={onClose} maxWidth={640}>
      {!l ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGE[l.status] ?? "secondary"}>{l.status}</Badge>
            {l.carrier && <Badge variant="secondary">{l.carrier}</Badge>}
            {l.assigned_to_name && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Smartphone size={12} /> {l.assigned_to_name}
                {l.assigned_to_title && ` · ${l.assigned_to_title}`}
              </span>
            )}
          </div>

          {/* Package & contract */}
          <Card className="mb-3 bg-muted"><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Package" value={l.plan_name} />
            <Field label="Monthly" value={fmtMoney(l.monthly_cost)} />
            <Field label="Data" value={l.data_allowance} />
            <Field label="SIM / ICCID" value={l.sim_number} />
            <Field label="Contract start" value={l.contract_start} />
            <Field label="Contract end" value={l.contract_end} />
          </CardContent></Card>

          {/* Assignment + status controls */}
          <div className="mb-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
            <FormField className="flex-1"><FieldLabel htmlFor="phone-assign">Assign to</FieldLabel>
              <Select items={[{ value: null, label: "Select employee…" }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]} value={assignee || null} onValueChange={(value) => setAssignee(value ?? "")}>
                <SelectTrigger id="phone-assign" aria-label="Assign to" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Select employee…</SelectItem>
                {(users.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>
                ))}
                </SelectGroup></SelectContent>
              </Select>
            </FormField>
            <Button type="button" variant="outline"
              disabled={!assignee}
              onClick={() => assignee && act("/assign", { user_id: assignee })}
            >
              <UserCheck data-icon="inline-start" /> Assign
            </Button>
            {l.assigned_to_id && (
              <Button type="button" variant="outline" onClick={() => act("/unassign")}><UserX data-icon="inline-start" /> Release</Button>
            )}
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {l.status !== "suspended" && (
              <Button type="button" size="sm" variant="outline" onClick={() => act("/status", { status: "suspended" })}>Suspend</Button>
            )}
            {l.status !== "available" && l.status !== "assigned" && (
              <Button type="button" size="sm" variant="outline" onClick={() => act("/status", { status: "available" })}>Reactivate</Button>
            )}
            {l.status !== "cancelled" && (
              <Button type="button" size="sm" variant="destructive" onClick={() => act("/status", { status: "cancelled" })}>Cancel line</Button>
            )}
          </div>

          {/* Edit package inline */}
          <div className="mb-4 grid gap-4 sm:grid-cols-[2fr_120px]">
            <FormField><FieldLabel htmlFor="phone-update-package">Update package</FieldLabel><Input id="phone-update-package"
                defaultValue={l.plan_name ?? ""}
                onBlur={(e) => e.target.value !== (l.plan_name ?? "") && patch({ plan_name: e.target.value })}
              /></FormField>
            <FormField><FieldLabel htmlFor="phone-update-monthly">Monthly</FieldLabel><Input id="phone-update-monthly"
                type="number"
                step="0.01"
                defaultValue={l.monthly_cost ?? ""}
                onBlur={(e) => e.target.value !== (l.monthly_cost ?? "") && patch({ monthly_cost: e.target.value || null })}
              /></FormField>
          </div>

          {/* Billing */}
          <h4 className="mb-2 inline-flex items-center gap-1.5"><CreditCard size={15} /> Billing</h4>
          <div className="mb-2 flex flex-col gap-1">
            {l.bills.length === 0 && <p className="text-sm text-muted-foreground">No bills logged.</p>}
            {l.bills.map((b) => (
              <div key={b.id} className="group flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium [font-variant-numeric:tabular-nums]">{b.period}</span>
                  <span className="text-muted-foreground"> · {fmtMoney(b.amount)}{b.data_used ? ` · ${b.data_used}` : ""}</span>
                  <Badge className="ml-2" variant={b.status === "paid" ? "success" : "warning"}>{b.status}</Badge>
                </span>
                <Button aria-label="Delete" type="button" size="icon-xs" variant="destructive" onClick={() => delBill(b)}><Trash2 /></Button>
              </div>
            ))}
          </div>
          <div className="mb-4 grid items-end gap-3 sm:grid-cols-[110px_100px_1fr_110px_auto]">
            <FormField><FieldLabel htmlFor="bill-period">Period</FieldLabel><Input id="bill-period" aria-label="2026-06" placeholder="2026-06" value={bill.period} onChange={(e) => setBill((s) => ({ ...s, period: e.target.value }))} /></FormField>
            <FormField><FieldLabel htmlFor="bill-amount">Amount</FieldLabel><Input id="bill-amount" type="number" step="0.01" value={bill.amount} onChange={(e) => setBill((s) => ({ ...s, amount: e.target.value }))} /></FormField>
            <FormField><FieldLabel htmlFor="bill-data">Data used</FieldLabel><Input id="bill-data" aria-label="23 GB" placeholder="23 GB" value={bill.data_used} onChange={(e) => setBill((s) => ({ ...s, data_used: e.target.value }))} /></FormField>
            <FormField><FieldLabel htmlFor="bill-status">Status</FieldLabel><Select items={[{ value: "unpaid", label: "unpaid" }, { value: "paid", label: "paid" }]} value={bill.status} onValueChange={(value) => setBill((s) => ({ ...s, status: value ?? "" }))}><SelectTrigger id="bill-status" aria-label="Status" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="unpaid">unpaid</SelectItem><SelectItem value="paid">paid</SelectItem></SelectGroup></SelectContent></Select></FormField>
            <Button type="button" variant="outline" onClick={addBill}><Plus data-icon="inline-start" /> Log</Button>
          </div>

          {/* History */}
          <h4 className="mb-2 inline-flex items-center gap-1.5"><History size={15} /> History</h4>
          <div className="mb-3 flex max-h-50 flex-col gap-1.5 overflow-auto">
            {l.events.map((e: PhoneLineEvent) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  <Badge variant="secondary">{e.event_type.replace("_", " ")}</Badge>
                  {e.user_name && <span className="ml-1 font-medium">{e.user_name}</span>}
                  {e.note && <span className="text-muted-foreground"> — {e.note}</span>}
                </span>
                <span className="flex-none whitespace-nowrap text-muted-foreground">{new Date(e.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="destructive" onClick={removeLine}><Trash2 data-icon="inline-start" /> Delete line</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value || "—"}</div>
    </div>
  );
}
