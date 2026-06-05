import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageSquare, Plus, Send } from "lucide-react";
import { api } from "../api/client";
import type { Ticket, TicketDetail, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";
import Attachments from "../components/Attachments";

const CATEGORIES = ["it", "facilities", "hr", "finance", "other"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUS_BADGE: Record<string, string> = {
  open: "blue",
  in_progress: "amber",
  resolved: "green",
  closed: "",
};

export default function ServiceDeskPage() {
  const [scope, setScope] = useState<"all" | "mine" | "assigned">("all");
  const [status, setStatus] = useState("");
  const q = `?scope=${scope}${status ? `&status=${status}` : ""}`;
  const tickets = useFetch<Ticket[]>(`/api/tickets${q}`);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new")) {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  return (
    <div>
      <PageHead
        title="Service Desk"
        subtitle="Raise and track IT, facilities and HR requests."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setAdding(true)}>
            <Plus size={15} /> New ticket
          </button>
        }
      />

      <div className="card mb-4">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Show</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="all">All tickets</option>
              <option value="mine">Raised by me</option>
              <option value="assigned">Assigned to me</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {tickets.loading ? (
          <Loading />
        ) : (tickets.data?.length ?? 0) === 0 ? (
          <Empty message="No tickets here." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Requester</th>
                <th>Assignee</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tickets.data!.map((t) => (
                <tr key={t.id} className="cursor-pointer" onClick={() => setOpenId(t.id)}>
                  <td>
                    <span className="font-semibold">{t.subject}</span>
                    {t.comment_count > 0 && (
                      <span className="muted ml-2 inline-flex items-center gap-1 text-xs">
                        <MessageSquare size={11} /> {t.comment_count}
                      </span>
                    )}
                  </td>
                  <td><span className="badge">{t.category}</span></td>
                  <td>{t.priority}</td>
                  <td>{t.requester_name ?? "—"}</td>
                  <td>{t.assignee_name ?? "—"}</td>
                  <td><span className={`badge ${STATUS_BADGE[t.status] ?? ""}`}>{t.status.replace("_", " ")}</span></td>
                  <td className="text-right font-medium text-brand-600">Open ›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <TicketModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            tickets.reload();
            setAdding(false);
          }}
        />
      )}
      {openId && (
        <TicketDetailModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={tickets.reload}
        />
      )}
    </div>
  );
}

function TicketModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({ subject: "", description: "", category: "it", priority: "normal" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/tickets", { method: "POST", body: form });
      notify("Ticket raised.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="New ticket" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Subject *</label>
          <input required value={form.subject} onChange={(e) => set("subject", e.target.value)} />
        </div>
        <div className="field">
          <label>Describe the issue</label>
          <textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={(e) => set("category", e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Priority</label>
            <select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Submitting…" : "Raise ticket"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TicketDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const { notify } = useToast();
  const detail = useFetch<TicketDetail>(`/api/tickets/${id}`);
  const users = useFetch<User[]>("/api/users");
  const [comment, setComment] = useState("");
  const t = detail.data;
  const isAgent = user?.is_admin || user?.role === "manager";
  const canTriage = isAgent || t?.assignee_id === user?.id;

  async function patch(body: Record<string, unknown>) {
    await api(`/api/tickets/${id}`, { method: "PATCH", body });
    detail.reload();
    onChanged();
  }
  async function send() {
    if (!comment.trim()) return;
    await api(`/api/tickets/${id}/comments`, { method: "POST", body: { body: comment } });
    setComment("");
    detail.reload();
    onChanged();
    notify("Reply sent.");
  }

  return (
    <Modal title={t?.subject ?? "Ticket"} onClose={onClose} maxWidth={620}>
      {!t ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`badge ${STATUS_BADGE[t.status] ?? ""}`}>{t.status.replace("_", " ")}</span>
            <span className="badge">{t.category}</span>
            <span className="badge">{t.priority}</span>
            <span className="muted text-xs">Raised by {t.requester_name ?? "—"}</span>
          </div>
          {t.description && (
            <div className="card mb-3" style={{ padding: 12, background: "var(--surface-2)" }}>
              {t.description}
            </div>
          )}

          {canTriage && (
            <div className="row mb-3">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Status</label>
                <select value={t.status} onChange={(e) => patch({ status: e.target.value })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Assignee</label>
                <select value={t.assignee_id ?? ""} onChange={(e) => patch({ assignee_id: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {(users.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name ?? u.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="mb-3">
            <Attachments entityType="ticket" entityId={id} />
          </div>

          <h4 className="mb-2">Conversation</h4>
          <div className="mb-3 flex flex-col gap-2" style={{ maxHeight: 240, overflow: "auto" }}>
            {t.comments.length === 0 && <p className="muted text-sm">No replies yet.</p>}
            {t.comments.map((c) => (
              <div key={c.id} className="card" style={{ padding: 10, background: "var(--surface-2)" }}>
                <div className="spread">
                  <span className="text-sm font-semibold">{c.author_name ?? "—"}</span>
                  <span className="muted text-xs">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                <div className="text-sm">{c.body}</div>
              </div>
            ))}
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, flex: 4 }}>
              <input
                placeholder="Write a reply…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
            </div>
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={send}>
              <Send size={14} /> Send
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
