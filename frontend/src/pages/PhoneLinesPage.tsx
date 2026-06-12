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
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const STATUSES = ["available", "assigned", "suspended", "cancelled"];
const STATUS_BADGE: Record<string, string> = {
  available: "blue",
  assigned: "green",
  suspended: "amber",
  cancelled: "red",
};

export default function PhoneLinesPage() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    return p.toString();
  }, [status, q]);
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
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            <button
              className="btn inline-flex items-center gap-1.5"
              style={{ flex: "0 0 auto" }}
              onClick={() =>
                downloadFile("/api/phone-lines/template.csv", "phone-lines-template.csv").catch(
                  () => notify("Download failed", "error"),
                )
              }
            >
              <FileText size={15} /> Template
            </button>
            <button
              className="btn inline-flex items-center gap-1.5"
              style={{ flex: "0 0 auto" }}
              onClick={() => importRef.current?.click()}
            >
              <Upload size={15} /> Import
            </button>
            <button
              className="btn inline-flex items-center gap-1.5"
              style={{ flex: "0 0 auto" }}
              onClick={() =>
                downloadFile("/api/phone-lines/export.csv", "phone-lines.csv").catch(() =>
                  notify("Export failed", "error"),
                )
              }
            >
              <Download size={15} /> Export
            </button>
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setAdding(true)}>
              <Plus size={15} /> Add line
            </button>
            <input ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} />
          </div>
        }
      />

      {s && (
        <div className="grid mb-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
          <Metric icon={<Phone size={16} />} label="Total lines" value={s.total} />
          <Metric icon={<UserCheck size={16} />} label="Assigned" value={s.assigned} />
          <Metric icon={<CreditCard size={16} />} label="Monthly spend" value={fmtMoney(s.monthly_cost)} />
          <Metric label="Available" value={s.by_status.available ?? 0} />
        </div>
      )}

      <div className="card mb-4">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 3 }}>
            <label>Search</label>
            <input
              placeholder="Number, carrier or package…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {lines.loading ? (
          <Loading />
        ) : (lines.data?.length ?? 0) === 0 ? (
          <Empty message="No phone lines yet." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Carrier</th>
                <th>Package</th>
                <th>Monthly</th>
                <th>Assigned to</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.data!.map((l) => (
                <tr key={l.id} className="cursor-pointer" onClick={() => setOpenId(l.id)}>
                  <td className="font-semibold [font-variant-numeric:tabular-nums]">{l.number}</td>
                  <td>{l.carrier ?? "—"}</td>
                  <td>
                    {l.plan_name ?? "—"}
                    {l.data_allowance && <span className="muted text-xs"> · {l.data_allowance}</span>}
                  </td>
                  <td>{fmtMoney(l.monthly_cost)}</td>
                  <td>
                    {l.assigned_to_name ? (
                      <div className="leading-tight">
                        <div>{l.assigned_to_name}</div>
                        {l.assigned_to_title && (
                          <div className="muted text-xs">{l.assigned_to_title}</div>
                        )}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td><span className={`badge ${STATUS_BADGE[l.status] ?? ""}`}>{l.status}</span></td>
                  <td className="text-right font-medium text-brand-600">Open ›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
    <div className="card" style={{ padding: 14 }}>
      <div className="muted inline-flex items-center gap-1.5 text-xs">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
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
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <Modal title="Add phone line" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row">
          <div className="field">
            <label>Number *</label>
            <input required placeholder="+9715xxxxxxxx" value={form.number} onChange={(e) => set("number", e.target.value)} />
          </div>
          <div className="field">
            <label>Carrier</label>
            <input placeholder="Etisalat / du" value={form.carrier} onChange={(e) => set("carrier", e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Package</label>
            <input placeholder="Business 20GB" value={form.plan_name} onChange={(e) => set("plan_name", e.target.value)} />
          </div>
          <div className="field">
            <label>Monthly cost</label>
            <input type="number" step="0.01" min="0" value={form.monthly_cost} onChange={(e) => set("monthly_cost", e.target.value)} />
          </div>
          <div className="field">
            <label>Data allowance</label>
            <input placeholder="20 GB" value={form.data_allowance} onChange={(e) => set("data_allowance", e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>SIM / ICCID</label>
            <input value={form.sim_number} onChange={(e) => set("sim_number", e.target.value)} />
          </div>
          <div className="field">
            <label>Contract start</label>
            <input type="date" value={form.contract_start} onChange={(e) => set("contract_start", e.target.value)} />
          </div>
          <div className="field">
            <label>Contract end</label>
            <input type="date" value={form.contract_end} onChange={(e) => set("contract_end", e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : "Add line"}
          </button>
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
            <span className={`badge ${STATUS_BADGE[l.status] ?? ""}`}>{l.status}</span>
            {l.carrier && <span className="badge">{l.carrier}</span>}
            {l.assigned_to_name && (
              <span className="muted inline-flex items-center gap-1 text-xs">
                <Smartphone size={12} /> {l.assigned_to_name}
                {l.assigned_to_title && ` · ${l.assigned_to_title}`}
              </span>
            )}
          </div>

          {/* Package & contract */}
          <div className="card mb-3 grid grid-cols-3 gap-3" style={{ padding: 12, background: "var(--surface-2)" }}>
            <Field label="Package" value={l.plan_name} />
            <Field label="Monthly" value={fmtMoney(l.monthly_cost)} />
            <Field label="Data" value={l.data_allowance} />
            <Field label="SIM / ICCID" value={l.sim_number} />
            <Field label="Contract start" value={l.contract_start} />
            <Field label="Contract end" value={l.contract_end} />
          </div>

          {/* Assignment + status controls */}
          <div className="row mb-3" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, flex: 3 }}>
              <label>Assign to</label>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Select employee…</option>
                {(users.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>
                ))}
              </select>
            </div>
            <button
              className="btn inline-flex items-center gap-1.5"
              style={{ flex: "0 0 auto" }}
              disabled={!assignee}
              onClick={() => assignee && act("/assign", { user_id: assignee })}
            >
              <UserCheck size={14} /> Assign
            </button>
            {l.assigned_to_id && (
              <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => act("/unassign")}>
                <UserX size={14} /> Release
              </button>
            )}
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {l.status !== "suspended" && (
              <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => act("/status", { status: "suspended" })}>Suspend</button>
            )}
            {l.status !== "available" && l.status !== "assigned" && (
              <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => act("/status", { status: "available" })}>Reactivate</button>
            )}
            {l.status !== "cancelled" && (
              <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => act("/status", { status: "cancelled" })}>Cancel line</button>
            )}
          </div>

          {/* Edit package inline */}
          <div className="row mb-4" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, flex: 2 }}>
              <label>Update package</label>
              <input
                defaultValue={l.plan_name ?? ""}
                onBlur={(e) => e.target.value !== (l.plan_name ?? "") && patch({ plan_name: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 120 }}>
              <label>Monthly</label>
              <input
                type="number"
                step="0.01"
                defaultValue={l.monthly_cost ?? ""}
                onBlur={(e) => e.target.value !== (l.monthly_cost ?? "") && patch({ monthly_cost: e.target.value || null })}
              />
            </div>
          </div>

          {/* Billing */}
          <h4 className="mb-2 inline-flex items-center gap-1.5"><CreditCard size={15} /> Billing</h4>
          <div className="mb-2 flex flex-col gap-1">
            {l.bills.length === 0 && <p className="muted text-sm">No bills logged.</p>}
            {l.bills.map((b) => (
              <div key={b.id} className="group flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium [font-variant-numeric:tabular-nums]">{b.period}</span>
                  <span className="muted"> · {fmtMoney(b.amount)}{b.data_used ? ` · ${b.data_used}` : ""}</span>
                  <span className={`badge ml-2 ${b.status === "paid" ? "green" : "amber"}`}>{b.status}</span>
                </span>
                <button className="text-ink-muted opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100" onClick={() => delBill(b)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="row mb-4" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, width: 110 }}>
              <label>Period</label>
              <input placeholder="2026-06" value={bill.period} onChange={(e) => setBill((s) => ({ ...s, period: e.target.value }))} />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 100 }}>
              <label>Amount</label>
              <input type="number" step="0.01" value={bill.amount} onChange={(e) => setBill((s) => ({ ...s, amount: e.target.value }))} />
            </div>
            <div className="field" style={{ marginBottom: 0, flex: 1 }}>
              <label>Data used</label>
              <input placeholder="23 GB" value={bill.data_used} onChange={(e) => setBill((s) => ({ ...s, data_used: e.target.value }))} />
            </div>
            <div className="field" style={{ marginBottom: 0, width: 110 }}>
              <label>Status</label>
              <select value={bill.status} onChange={(e) => setBill((s) => ({ ...s, status: e.target.value }))}>
                <option value="unpaid">unpaid</option>
                <option value="paid">paid</option>
              </select>
            </div>
            <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={addBill}>
              <Plus size={14} /> Log
            </button>
          </div>

          {/* History */}
          <h4 className="mb-2 inline-flex items-center gap-1.5"><History size={15} /> History</h4>
          <div className="mb-3 flex flex-col gap-1.5" style={{ maxHeight: 200, overflow: "auto" }}>
            {l.events.map((e: PhoneLineEvent) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  <span className="badge">{e.event_type.replace("_", " ")}</span>
                  {e.user_name && <span className="ml-1 font-medium">{e.user_name}</span>}
                  {e.note && <span className="muted"> — {e.note}</span>}
                </span>
                <span className="muted flex-none whitespace-nowrap">{new Date(e.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn-danger inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={removeLine}>
              <Trash2 size={14} /> Delete line
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="muted text-[11px]">{label}</div>
      <div className="text-sm font-medium">{value || "—"}</div>
    </div>
  );
}
