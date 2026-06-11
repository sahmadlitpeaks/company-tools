import { useRef, useState } from "react";
import { Download, Plus, Receipt, Send, Trash2, Upload } from "lucide-react";
import { api, apiUrl } from "../api/client";
import type { ExpenseClaim } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const CATEGORIES = ["travel", "meals", "accommodation", "supplies", "software", "training", "other"];
const STATUS_BADGE: Record<string, string> = {
  draft: "", submitted: "amber", approved: "green", rejected: "red", reimbursed: "blue",
};

function money(v: string | number, ccy?: string) {
  return `${ccy ?? ""} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

export default function ExpensesPage() {
  const { user } = useAuth();
  const canReview = !!user?.is_admin || user?.role === "manager" || !!user?.effective_permissions?.includes("hr");
  const [tab, setTab] = useState<"mine" | "review">("mine");
  const [creating, setCreating] = useState(false);
  const mine = useFetch<ExpenseClaim[]>("/api/expenses/my");

  return (
    <div>
      <PageHead
        title="Expenses"
        subtitle="Submit expense claims, attach receipts and track reimbursement."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setCreating(true)}>
            <Plus size={15} /> New claim
          </button>
        }
      />
      {canReview && (
        <div className="row mb-4" style={{ gap: 8 }}>
          <button className={tab === "mine" ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setTab("mine")}>My claims</button>
          <button className={tab === "review" ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setTab("review")}>All claims</button>
        </div>
      )}
      {tab === "mine" ? (
        <ClaimList q={mine} mine />
      ) : (
        <ReviewList />
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); mine.reload(); }} />}
    </div>
  );
}

function ClaimList({ q, mine }: { q: ReturnType<typeof useFetch<ExpenseClaim[]>>; mine?: boolean }) {
  const { notify } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  async function submit(c: ExpenseClaim) {
    try {
      await api(`/api/expenses/${c.id}/submit`, { method: "POST" });
      notify("Submitted for approval.");
      q.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(c: ExpenseClaim) {
    if (!confirm("Delete this claim?")) return;
    await api(`/api/expenses/${c.id}`, { method: "DELETE" });
    q.reload();
  }
  async function reimburse(c: ExpenseClaim) {
    try {
      await api(`/api/expenses/${c.id}/reimburse`, { method: "POST" });
      q.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !uploadFor) return;
    const form = new FormData();
    form.append("file", f);
    try {
      await api(`/api/expenses/${uploadFor}/receipt`, { method: "POST", form });
      notify("Receipt attached.");
      q.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
    setUploadFor(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (q.loading) return <Loading />;
  if ((q.data?.length ?? 0) === 0) return <div className="card"><Empty icon="🧾" message="No expense claims" hint="Create a claim and attach a receipt." /></div>;

  return (
    <div className="card">
      <input ref={fileRef} type="file" hidden onChange={onFile} />
      <table className="table">
        <thead><tr>{!mine && <th>Employee</th>}<th>Title</th><th>Category</th><th>Amount</th><th>Status</th><th /></tr></thead>
        <tbody>
          {q.data!.map((c) => (
            <tr key={c.id}>
              {!mine && <td className="font-medium">{c.user_name}</td>}
              <td>{c.title}{c.has_receipt && <Receipt size={13} className="ml-1 inline text-ink-muted" />}</td>
              <td className="capitalize">{c.category}</td>
              <td>{money(c.amount, c.currency)}</td>
              <td><span className={`badge ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
              <td className="text-right">
                <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                  {c.has_receipt && (
                    <a className="btn-sm" style={{ flex: "0 0 auto" }} href={apiUrl(`/api/expenses/${c.id}/receipt`)} target="_blank" rel="noreferrer"><Download size={13} /></a>
                  )}
                  {mine && c.status === "draft" && (
                    <>
                      <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => { setUploadFor(c.id); fileRef.current?.click(); }}><Upload size={13} /></button>
                      <button className="btn-sm btn-primary inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => submit(c)}><Send size={13} /> Submit</button>
                    </>
                  )}
                  {!mine && c.status === "approved" && (
                    <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={() => reimburse(c)}>Reimburse</button>
                  )}
                  {(c.status === "draft" || c.status === "rejected") && (
                    <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(c)}><Trash2 size={13} /></button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewList() {
  const q = useFetch<ExpenseClaim[]>("/api/expenses");
  return <ClaimList q={q} />;
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [f, setF] = useState({ title: "", category: "travel", amount: "", currency: "USD", expense_date: "", description: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.title.trim() || !f.amount) { notify("Title and amount required", "error"); return; }
    setBusy(true);
    try {
      await api("/api/expenses", { method: "POST", body: { ...f, amount: f.amount, expense_date: f.expense_date || null } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="New expense claim" onClose={onClose} maxWidth={480}>
      <div className="field"><label>Title</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Category</label>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        <div className="field" style={{ flex: 1 }}><label>Amount</label><input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div className="field" style={{ width: 80 }}><label>Currency</label><input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div>
      </div>
      <div className="field"><label>Date</label><input type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></div>
      <div className="field"><label>Description</label><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="row mt-2" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Create draft"}</button>
      </div>
    </Modal>
  );
}
