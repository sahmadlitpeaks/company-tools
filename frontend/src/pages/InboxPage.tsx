import { useMemo, useState } from "react";
import { Copy, Plus, Trash2, UserPlus, Ticket as TicketIcon } from "lucide-react";
import { api, apiUrl } from "../api/client";
import type { IntakeSource, Submission } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const TYPES = ["lead", "complaint", "support", "inquiry", "feedback", "other"];
const STATUSES = ["new", "in_progress", "resolved", "spam", "archived"];
const TYPE_BADGE: Record<string, string> = {
  lead: "green", complaint: "red", support: "amber", inquiry: "blue", feedback: "", other: "",
};
const STATUS_BADGE: Record<string, string> = {
  new: "amber", in_progress: "blue", resolved: "green", spam: "red", archived: "",
};

export default function InboxPage() {
  const [tab, setTab] = useState<"inbox" | "sources">("inbox");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (type) p.set("type", type);
    if (q) p.set("q", q);
    return p.toString();
  }, [status, type, q]);
  const subs = useFetch<Submission[]>(`/api/intake/submissions${qs ? `?${qs}` : ""}`);
  const [open, setOpen] = useState<Submission | null>(null);

  return (
    <div>
      <PageHead title="Web Inbox" subtitle="Form submissions from your websites — leads, complaints, support and more." />

      <div className="mb-4 flex gap-2">
        <button className={`btn-sm ${tab === "inbox" ? "btn-primary" : ""}`} style={{ flex: "0 0 auto" }} onClick={() => setTab("inbox")}>Inbox</button>
        <button className={`btn-sm ${tab === "sources" ? "btn-primary" : ""}`} style={{ flex: "0 0 auto" }} onClick={() => setTab("sources")}>Connected websites</button>
      </div>

      {tab === "sources" ? (
        <SourcesTab />
      ) : (
        <div className="card">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="field" style={{ marginBottom: 0, flex: "1 1 200px" }}>
              <input placeholder="Search name, email, message…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
          </div>

          {subs.loading ? (
            <Loading />
          ) : (subs.data?.length ?? 0) === 0 ? (
            <Empty icon="📥" message="No submissions yet" hint="Connect a website under 'Connected websites' and point its form here." />
          ) : (
            <table className="table">
              <thead>
                <tr><th>Type</th><th>From</th><th>Subject</th><th>Source</th><th>Status</th><th>Received</th></tr>
              </thead>
              <tbody>
                {subs.data!.map((s) => (
                  <tr key={s.id} className="cursor-pointer" onClick={() => setOpen(s)}>
                    <td><span className={`badge ${TYPE_BADGE[s.type] ?? ""}`}>{s.type}</span></td>
                    <td>
                      <div className="font-medium">{s.name ?? s.email ?? "—"}</div>
                      {s.email && <div className="muted text-xs">{s.email}</div>}
                    </td>
                    <td className="max-w-[260px] truncate">{s.subject ?? s.message ?? "—"}</td>
                    <td className="muted text-sm">{s.source_name ?? "—"}</td>
                    <td><span className={`badge ${STATUS_BADGE[s.status] ?? ""}`}>{s.status.replace("_", " ")}</span></td>
                    <td className="muted text-sm">{new Date(s.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {open && <SubmissionModal sub={open} onClose={() => setOpen(null)} onChanged={() => subs.reload()} />}
    </div>
  );
}

function SubmissionModal({ sub, onClose, onChanged }: { sub: Submission; onClose: () => void; onChanged: () => void }) {
  const { notify } = useToast();
  const detail = useFetch<Submission>(`/api/intake/submissions/${sub.id}`);
  const s = detail.data ?? sub;

  async function patch(body: Record<string, unknown>) {
    await api(`/api/intake/submissions/${sub.id}`, { method: "PATCH", body });
    detail.reload();
    onChanged();
  }
  async function convert(kind: "lead" | "ticket") {
    try {
      await api(`/api/intake/submissions/${sub.id}/convert-${kind}`, { method: "POST" });
      notify(`Converted to ${kind}.`);
      detail.reload();
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function remove() {
    if (!confirm("Delete this submission?")) return;
    await api(`/api/intake/submissions/${sub.id}`, { method: "DELETE" });
    onChanged();
    onClose();
  }

  return (
    <Modal title={s.subject || `${s.type} from ${s.name ?? s.email ?? "website"}`} onClose={onClose} maxWidth={560}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`badge ${TYPE_BADGE[s.type] ?? ""}`}>{s.type}</span>
        <span className={`badge ${STATUS_BADGE[s.status] ?? ""}`}>{s.status.replace("_", " ")}</span>
        {s.source_name && <span className="badge">{s.source_name}</span>}
        {s.converted_lead_id && <span className="badge green">→ lead</span>}
        {s.converted_ticket_id && <span className="badge green">→ ticket</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <Field label="Name" value={s.name} />
        <Field label="Email" value={s.email} />
        <Field label="Phone" value={s.phone} />
        <Field label="Company" value={s.company} />
      </div>
      {s.message && <div className="mt-2"><div className="muted text-xs">Message</div><p className="whitespace-pre-wrap text-sm">{s.message}</p></div>}
      {s.page_url && <a href={s.page_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-brand-600">Source page ↗</a>}
      {s.payload && Object.keys(s.payload).length > 0 && (
        <div className="mt-2">
          <div className="muted text-xs">Other fields</div>
          <div className="rounded-lg p-2 text-xs" style={{ background: "var(--surface-2)" }}>
            {Object.entries(s.payload).map(([k, v]) => (
              <div key={k}><span className="muted">{k}:</span> {String(v)}</div>
            ))}
          </div>
        </div>
      )}

      <div className="row mt-4" style={{ alignItems: "flex-end", gap: 8 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Status</label>
          <select value={s.status} onChange={(e) => patch({ status: e.target.value })}>
            {STATUSES.map((st) => <option key={st} value={st}>{st.replace("_", " ")}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Type</label>
          <select value={s.type} onChange={(e) => patch({ type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="row mt-4" style={{ justifyContent: "space-between", gap: 8 }}>
        <button className="btn btn-danger" style={{ flex: "0 0 auto" }} onClick={remove}>Delete</button>
        <span className="flex gap-2">
          {!s.converted_ticket_id && (
            <button className="btn inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => convert("ticket")}>
              <TicketIcon size={15} /> To ticket
            </button>
          )}
          {!s.converted_lead_id && (
            <button className="btn-primary inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => convert("lead")}>
              <UserPlus size={15} /> To CRM lead
            </button>
          )}
        </span>
      </div>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <div><div className="muted text-xs">{label}</div><div>{value}</div></div>;
}

function SourcesTab() {
  const { notify } = useToast();
  const sources = useFetch<IntakeSource[]>("/api/intake/sources");
  const [name, setName] = useState("");
  const [type, setType] = useState("lead");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api("/api/intake/sources", { method: "POST", body: { name: name.trim(), default_type: type } });
      setName("");
      sources.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function toggle(s: IntakeSource) {
    await api(`/api/intake/sources/${s.id}`, { method: "PATCH", body: { active: !s.active } });
    sources.reload();
  }
  async function del(s: IntakeSource) {
    if (!confirm(`Delete "${s.name}"? Its submissions are kept but unlinked.`)) return;
    await api(`/api/intake/sources/${s.id}`, { method: "DELETE" });
    sources.reload();
  }
  async function rotate(s: IntakeSource) {
    if (!confirm(`Rotate the API token for "${s.name}"? The old token stops working immediately.`)) return;
    await api(`/api/intake/sources/${s.id}/rotate-key`, { method: "POST" });
    sources.reload();
    notify("Token rotated.");
  }
  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text);
    notify(`${what} copied.`);
  }

  const ingestUrl = apiUrl("/api/intake/ingest");

  return (
    <div className="card">
      <p className="muted text-sm">
        Connected systems (e.g. WordPress) POST to <code>{ingestUrl}</code> with the
        source's API token in an <code>Authorization: Bearer &lt;token&gt;</code> (or
        <code> X-API-Key</code>) header. JSON body fields like <code>name, email, phone,
        subject, message, type</code> are mapped; anything else is kept as extra fields.
      </p>
      <form onSubmit={add} className="row my-3" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ marginBottom: 0, flex: 2 }}><label>Website / form name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main website – contact form" /></div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Default type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </div>
        <button className="btn-primary inline-flex items-center gap-1" style={{ flex: "0 0 auto" }}><Plus size={14} /> Add</button>
      </form>

      {sources.loading ? (
        <Loading />
      ) : (sources.data?.length ?? 0) === 0 ? (
        <Empty icon="🔌" message="No websites connected yet." />
      ) : (
        <div className="divide-y divide-slate-100">
          {sources.data!.map((s) => (
            <div key={s.id} className="py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {s.name} <span className="muted text-xs">· default {s.default_type} · {s.submission_count} received</span>
                  {!s.active && <span className="badge ml-1">inactive</span>}
                </span>
                <span className="flex gap-1">
                  <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => rotate(s)}>Rotate token</button>
                  <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => toggle(s)}>{s.active ? "Disable" : "Enable"}</button>
                  <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(s)}><Trash2 size={13} /></button>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="muted text-xs">Token</span>
                <code className="flex-1 truncate rounded-lg px-2 py-1 text-xs" style={{ background: "var(--surface-2)" }}>{s.key}</code>
                <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => copy(s.key, "Token")}><Copy size={12} /> Copy</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
