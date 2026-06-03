import { useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { CrmLead, CrmSummary, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  ConfirmModal,
  Empty,
  ErrorState,
  ListSkeleton,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";
import { useBrand } from "../brand/BrandContext";

const STATUSES = ["new", "contacted", "qualified", "won", "lost"];
const STATUS_BADGE: Record<string, string> = {
  new: "blue",
  contacted: "amber",
  qualified: "",
  won: "green",
  lost: "red",
};

function money(v?: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  return Number.isNaN(n)
    ? String(v)
    : n.toLocaleString(undefined, { style: "currency", currency: "AED" });
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="card stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function LeadModal({
  lead,
  users,
  onClose,
  onSaved,
}: {
  lead: CrmLead | null;
  users: User[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const { brands } = useBrand();
  const [form, setForm] = useState({
    name: lead?.name ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    company: lead?.company ?? "",
    status: lead?.status ?? "new",
    owner_id: lead?.owner_id ?? "",
    value: lead?.value ?? "",
    brand_id: lead?.brand_id ?? "",
    notes: lead?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      name: form.name || null,
      email: form.email || null,
      phone: form.phone || null,
      company: form.company || null,
      status: form.status,
      owner_id: form.owner_id || null,
      value: form.value || null,
      brand_id: form.brand_id || null,
      notes: form.notes || null,
    };
    try {
      if (lead) {
        await api(`/api/crm/leads/${lead.id}`, { method: "PATCH", body });
      } else {
        await api("/api/crm/leads", { method: "POST", body });
      }
      notify(lead ? "Lead updated." : "Lead added.");
      onSaved();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={lead ? "Edit lead" : "Add lead"} onClose={onClose}>
      <form onSubmit={save}>
        <div className="row">
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="field">
            <label>Company</label>
            <input value={form.company} onChange={(e) => set("company", e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Email</label>
            <input value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Status</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Deal value</label>
            <input
              type="number"
              step="0.01"
              value={form.value}
              onChange={(e) => set("value", e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Owner</label>
            <select value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Brand</label>
            <select value={form.brand_id} onChange={(e) => set("brand_id", e.target.value)}>
              <option value="">—</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : lead ? "Save" : "Add lead"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function CrmPage() {
  const { notify } = useToast();
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (source) p.set("source", source);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [status, source, q]);

  const leads = useFetch<CrmLead[]>(`/api/crm/leads${query}`);
  const summary = useFetch<CrmSummary>("/api/crm/summary");
  const directory = useFetch<User[]>("/api/users");
  const importRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState<CrmLead | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<CrmLead | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  function reloadAll() {
    leads.reload();
    summary.reload();
  }

  async function changeStatus(l: CrmLead, s: string) {
    setSavingId(l.id);
    try {
      await api(`/api/crm/leads/${l.id}`, { method: "PATCH", body: { status: s } });
      notify(`Saved — ${l.name ?? "lead"} is now ${s}.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Couldn't save status", "error");
    } finally {
      setSavingId(null);
      reloadAll();
    }
  }

  async function syncExisting() {
    const r = await api<{ created: number }>("/api/crm/sync-existing", { method: "POST" });
    notify(r.created ? `Imported ${r.created} existing leads.` : "Already up to date.");
    reloadAll();
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api<{ created: number }>("/api/crm/import", { method: "POST", form: fd });
      notify(`Imported ${r.created} leads.`);
      reloadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Import failed", "error");
    }
    if (importRef.current) importRef.current.value = "";
  }

  async function remove(l: CrmLead) {
    await api(`/api/crm/leads/${l.id}`, { method: "DELETE" });
    notify("Lead deleted.");
    reloadAll();
  }

  return (
    <div>
      <PageHead
        title="Leads (CRM)"
        subtitle="Every lead from cards, landing pages, imports and manual entry in one pipeline."
        action={
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            <button className="btn" style={{ flex: "0 0 auto" }} onClick={syncExisting}>
              Sync existing
            </button>
            <button
              className="btn"
              style={{ flex: "0 0 auto" }}
              onClick={() => importRef.current?.click()}
            >
              Import CSV
            </button>
            <button className="btn-primary" style={{ flex: "0 0 auto" }} onClick={() => setAdding(true)}>
              + Add lead
            </button>
            <input ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} />
          </div>
        }
      />

      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <Stat value={summary.data?.total ?? "—"} label="Total leads" />
        <Stat value={summary.data?.by_status?.new ?? 0} label="New" />
        <Stat value={summary.data ? money(summary.data.open_value) : "—"} label="Open pipeline" />
        <Stat value={summary.data ? money(summary.data.won_value) : "—"} label="Won value" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 3 }}>
            <label>Search</label>
            <input placeholder="Name, email, company…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All</option>
              {["card", "landing", "manual", "import"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {leads.loading ? (
        <ListSkeleton rows={6} />
      ) : leads.error ? (
        <ErrorState message={leads.error} onRetry={leads.reload} />
      ) : !leads.data || leads.data.length === 0 ? (
        <Empty
          icon="🧲"
          message="No leads yet"
          hint="Leads from cards & landing forms arrive here automatically — or add/import them."
          action={
            <button className="btn-primary" onClick={() => setAdding(true)}>+ Add lead</button>
          }
        />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Source</th>
                <th>Owner</th>
                <th>Value</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.data.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="font-semibold">{l.name ?? "—"}</div>
                    <div className="muted text-xs">
                      {[l.company, l.email, l.phone].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>
                    <span className="badge">{l.source}</span>
                    {l.source_detail && (
                      <div className="muted text-xs">{l.source_detail}</div>
                    )}
                  </td>
                  <td>{l.owner_name ?? "—"}</td>
                  <td>{money(l.value)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <select
                        value={l.status}
                        disabled={savingId === l.id}
                        onChange={(e) => changeStatus(l, e.target.value)}
                        aria-label={`Status for ${l.name ?? "lead"}`}
                        className={`!w-auto !py-1 text-sm badge ${STATUS_BADGE[l.status] ?? ""}`}
                        style={{ borderRadius: 999 }}
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {savingId === l.id && (
                        <span className="text-xs text-ink-muted">Saving…</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setEditing(l)}>
                        Edit
                      </button>
                      <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => setDeleting(l)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <LeadModal
          lead={editing}
          users={directory.data ?? []}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={reloadAll}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete lead"
          message={`Delete ${deleting.name ?? "this lead"}?`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
