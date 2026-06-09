import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Paperclip, Plus, X } from "lucide-react";
import { api } from "../api/client";
import type { Approval, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, PromptModal, useToast } from "../components/ui";
import Attachments from "../components/Attachments";

const TYPES = ["leave", "expense", "purchase", "document", "access", "general"];
const STATUS_BADGE: Record<string, string> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  cancelled: "",
};

function money(v?: string | null) {
  if (!v) return null;
  const n = Number(v);
  return Number.isNaN(n)
    ? v
    : n.toLocaleString(undefined, { style: "currency", currency: "AED" });
}

export default function ApprovalsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [scope, setScope] = useState<"mine" | "to_review">("mine");
  const list = useFetch<Approval[]>(`/api/approvals?scope=${scope}`);
  const [adding, setAdding] = useState(false);
  const [attachOf, setAttachOf] = useState<Approval | null>(null);
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const canReview = user?.is_admin || user?.role === "manager";
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new")) {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  async function decide(a: Approval, status: "approved" | "rejected", note?: string) {
    await api(`/api/approvals/${a.id}/decision`, {
      method: "POST",
      body: { status, note: note || null },
    });
    notify(`Request ${status}.`);
    list.reload();
  }
  async function cancel(a: Approval) {
    await api(`/api/approvals/${a.id}/cancel`, { method: "POST" });
    notify("Request cancelled.");
    list.reload();
  }

  return (
    <div>
      <PageHead
        title="Approvals"
        subtitle="Submit and track requests for leave, expenses, purchases and more."
        action={
          <button
            className="btn-primary inline-flex items-center gap-1.5"
            onClick={() => setAdding(true)}
          >
            <Plus size={15} /> New request
          </button>
        }
      />

      <div className="mb-4 inline-flex gap-1 rounded-[10px] p-1" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <button className={`btn-sm ${scope === "mine" ? "btn-primary" : ""}`} style={{ flex: "0 0 auto", background: scope === "mine" ? undefined : "transparent", border: scope === "mine" ? undefined : "1px solid transparent" }} onClick={() => setScope("mine")}>
          My requests
        </button>
        {canReview && (
          <button className={`btn-sm ${scope === "to_review" ? "btn-primary" : ""}`} style={{ flex: "0 0 auto", background: scope === "to_review" ? undefined : "transparent", border: scope === "to_review" ? undefined : "1px solid transparent" }} onClick={() => setScope("to_review")}>
            To review
          </button>
        )}
      </div>

      <div className="card">
        {list.loading ? (
          <Loading />
        ) : (list.data?.length ?? 0) === 0 ? (
          <Empty message={scope === "mine" ? "You haven't made any requests." : "Nothing to review."} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Request</th>
                <th>{scope === "mine" ? "Approver" : "Requester"}</th>
                <th>Amount / dates</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.data!.map((a) => (
                <tr key={a.id}>
                  <td><span className="badge">{a.type}</span></td>
                  <td>
                    <div className="font-semibold">{a.title}</div>
                    {a.details && <div className="muted text-xs">{a.details}</div>}
                  </td>
                  <td>{scope === "mine" ? a.approver_name ?? "Any manager" : a.requester_name ?? "—"}</td>
                  <td className="muted text-sm">
                    {money(a.amount) ??
                      (a.start_date ? `${a.start_date}${a.end_date ? ` → ${a.end_date}` : ""}` : "—")}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[a.status] ?? ""}`}>{a.status}</span>
                    {a.decision_note && <div className="muted text-xs">“{a.decision_note}”</div>}
                  </td>
                  <td className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        className="btn-sm"
                        title="Attachments"
                        onClick={() => setAttachOf(a)}
                      >
                        <Paperclip size={14} />
                      </button>
                      {a.status === "pending" && scope === "to_review" && (
                        <>
                          <button className="btn-sm btn-primary inline-flex items-center gap-1" onClick={() => decide(a, "approved")}>
                            <Check size={14} /> Approve
                          </button>
                          <button className="btn-sm btn-danger inline-flex items-center gap-1" onClick={() => setRejecting(a)}>
                            <X size={14} /> Reject
                          </button>
                        </>
                      )}
                      {a.status === "pending" && scope === "mine" && (
                        <button className="btn-sm" onClick={() => cancel(a)}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <ApprovalModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setScope("mine");
            list.reload();
            setAdding(false);
          }}
        />
      )}
      {attachOf && (
        <Modal title={`Attachments — ${attachOf.title}`} onClose={() => setAttachOf(null)} maxWidth={460}>
          <Attachments entityType="approval" entityId={attachOf.id} />
        </Modal>
      )}
      {rejecting && (
        <PromptModal
          title="Reject request"
          label="Reason (optional)"
          placeholder="Let them know why…"
          submitLabel="Reject"
          onSubmit={async (note) => {
            await decide(rejecting, "rejected", note);
          }}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  );
}

function ApprovalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const users = useFetch<User[]>("/api/users");
  const [form, setForm] = useState({
    type: "leave",
    title: "",
    details: "",
    amount: "",
    start_date: "",
    end_date: "",
    approver_id: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const showAmount = ["expense", "purchase"].includes(form.type);
  const showDates = form.type === "leave";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/approvals", {
        method: "POST",
        body: {
          type: form.type,
          title: form.title,
          details: form.details || null,
          amount: showAmount && form.amount ? form.amount : null,
          start_date: showDates && form.start_date ? form.start_date : null,
          end_date: showDates && form.end_date ? form.end_date : null,
          approver_id: form.approver_id || null,
        },
      });
      notify("Request submitted.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="New request" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row">
          <div className="field">
            <label>Type</label>
            <select value={form.type} onChange={(e) => set("type", e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Approver (optional)</label>
            <select value={form.approver_id} onChange={(e) => set("approver_id", e.target.value)}>
              <option value="">Any manager</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name ?? u.email}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Title *</label>
          <input required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="field">
          <label>Details</label>
          <textarea rows={2} value={form.details} onChange={(e) => set("details", e.target.value)} />
        </div>
        {showAmount && (
          <div className="field">
            <label>Amount</label>
            <input type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </div>
        )}
        {showDates && (
          <div className="row">
            <div className="field">
              <label>From</label>
              <input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
