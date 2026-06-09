import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock, History, Lock, MessageSquare, Plus, RotateCcw, Send } from "lucide-react";
import { api } from "../api/client";
import type { ActivityEntry, Ticket, TicketDetail, User, WorkLog } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";
import Attachments from "../components/Attachments";
import SavedViews from "../components/SavedViews";
import { hm } from "./WorkLogPage";

const CATEGORIES = ["it", "facilities", "hr", "finance", "other"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const OPEN_STATUSES = new Set(["open", "in_progress"]);
const STATUS_BADGE: Record<string, string> = {
  open: "blue",
  in_progress: "amber",
  resolved: "green",
  closed: "",
};
const PRIO_BADGE: Record<string, string> = { urgent: "red", high: "amber", normal: "", low: "blue" };

/** SLA state for the resolution target (open tickets only). */
function slaState(t: Ticket): { label: string; cls: string } | null {
  if (!OPEN_STATUSES.has(t.status) || !t.sla_resolution_due) return null;
  const due = new Date(t.sla_resolution_due).getTime();
  const now = Date.now();
  if (now > due) return { label: "Overdue", cls: "red" };
  if ((due - now) / 3600000 < 4) return { label: "Due soon", cls: "amber" };
  return { label: "On track", cls: "green" };
}

function durationBetween(a?: string | null, b?: string | null): string {
  if (!a || !b) return "—";
  const mins = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return hm(Math.max(0, mins));
}

export default function ServiceDeskPage() {
  const { user } = useAuth();
  const isAgent = user?.is_admin || user?.role === "manager";
  const [scope, setScope] = useState<"all" | "mine" | "assigned" | "unassigned">("all");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [sort, setSort] = useState("recent");
  const { notify } = useToast();

  const qs = useMemo(() => {
    const p = new URLSearchParams({ scope, sort });
    if (status) p.set("status", status);
    if (priority) p.set("priority", priority);
    if (overdue) p.set("overdue", "true");
    return p.toString();
  }, [scope, status, priority, overdue, sort]);
  const tickets = useFetch<Ticket[]>(`/api/tickets?${qs}`);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new")) {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  async function assignToMe(e: React.MouseEvent, t: Ticket) {
    e.stopPropagation();
    await api(`/api/tickets/${t.id}`, { method: "PATCH", body: { assignee_id: user?.id } });
    notify(`Assigned #${t.number} to you.`);
    tickets.reload();
  }

  function applyView(p: string) {
    const u = new URLSearchParams(p);
    setScope((u.get("scope") as typeof scope) || "all");
    setStatus(u.get("status") || "");
    setPriority(u.get("priority") || "");
    setOverdue(u.get("overdue") === "true");
    setSort(u.get("sort") || "recent");
  }

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
        <SavedViews surface="tickets" currentParams={qs} onApply={applyView} />
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Show</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="all">All tickets</option>
              <option value="mine">Raised by me</option>
              <option value="assigned">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace("_", " ")}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">All</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Sort</label>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">Newest</option>
              <option value="priority">Priority</option>
              <option value="due">SLA due</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, flex: "0 0 auto" }}>
            <label>&nbsp;</label>
            <button className={`btn ${overdue ? "btn-primary" : ""}`} onClick={() => setOverdue((o) => !o)}>
              Overdue only
            </button>
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
                <th>#</th>
                <th>Subject</th>
                <th>Category</th>
                <th>Priority</th>
                <th>SLA</th>
                <th>Requester</th>
                <th>Assignee</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tickets.data!.map((t) => {
                const sla = slaState(t);
                return (
                  <tr key={t.id} className="cursor-pointer" onClick={() => setOpenId(t.id)}>
                    <td className="text-ink-muted [font-variant-numeric:tabular-nums]">#{t.number}</td>
                    <td>
                      <span className="font-semibold">{t.subject}</span>
                      {t.comment_count > 0 && (
                        <span className="muted ml-2 inline-flex items-center gap-1 text-xs">
                          <MessageSquare size={11} /> {t.comment_count}
                        </span>
                      )}
                    </td>
                    <td><span className="badge">{t.category}</span></td>
                    <td>
                      <span className={`badge ${PRIO_BADGE[t.priority] ?? ""}`}>{t.priority}</span>
                    </td>
                    <td>{sla ? <span className={`badge ${sla.cls}`}>{sla.label}</span> : <span className="muted">—</span>}</td>
                    <td>{t.requester_name ?? "—"}</td>
                    <td>
                      {t.assignee_name ?? (
                        isAgent ? (
                          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={(e) => assignToMe(e, t)}>
                            Assign to me
                          </button>
                        ) : (
                          "—"
                        )
                      )}
                    </td>
                    <td><span className={`badge ${STATUS_BADGE[t.status] ?? ""}`}>{t.status.replace("_", " ")}</span></td>
                    <td className="text-right font-medium text-brand-600">Open ›</td>
                  </tr>
                );
              })}
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
        <TicketDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={tickets.reload} />
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
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Priority</label>
            <select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="muted text-xs">
          SLA targets are set automatically from the priority (urgent → 4h, high → 24h, normal → 72h, low → 120h).
        </p>
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
  const activity = useFetch<ActivityEntry[]>(`/api/activity?entity_type=ticket&entity_id=${id}`);
  const [comment, setComment] = useState("");
  const [internal, setInternal] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const t = detail.data;
  const isAgent = user?.is_admin || user?.role === "manager";
  const canTriage = isAgent || t?.assignee_id === user?.id;

  useEffect(() => {
    if (t) setResolutionNote(t.resolution_note ?? "");
  }, [t]);

  async function patch(body: Record<string, unknown>) {
    await api(`/api/tickets/${id}`, { method: "PATCH", body });
    detail.reload();
    activity.reload();
    onChanged();
  }
  async function changeStatus(s: string) {
    if (s === "resolved" && !resolutionNote.trim()) {
      notify("Add a resolution note before resolving.", "error");
      return;
    }
    try {
      await patch({ status: s, ...(s === "resolved" ? { resolution_note: resolutionNote } : {}) });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
  }
  async function send() {
    if (!comment.trim()) return;
    await api(`/api/tickets/${id}/comments`, { method: "POST", body: { body: comment, is_internal: internal } });
    setComment("");
    detail.reload();
    onChanged();
    notify(internal ? "Internal note added." : "Reply sent.");
  }

  const sla = t ? slaState(t) : null;
  const resolved = t && !OPEN_STATUSES.has(t.status);

  return (
    <Modal title={t ? `#${t.number} · ${t.subject}` : "Ticket"} onClose={onClose} maxWidth={640}>
      {!t ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`badge ${STATUS_BADGE[t.status] ?? ""}`}>{t.status.replace("_", " ")}</span>
            <span className="badge">{t.category}</span>
            <span className={`badge ${PRIO_BADGE[t.priority] ?? ""}`}>{t.priority}</span>
            {sla && <span className={`badge ${sla.cls}`}>{sla.label}</span>}
            <span className="muted text-xs">Raised by {t.requester_name ?? "—"}</span>
          </div>

          {/* SLA / timing summary */}
          <div className="card mb-3 grid grid-cols-3 gap-2 text-center" style={{ padding: 10, background: "var(--surface-2)" }}>
            <div>
              <div className="muted text-[11px]">Resolution due</div>
              <div className="text-sm font-semibold">
                {t.sla_resolution_due ? new Date(t.sla_resolution_due).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}
              </div>
            </div>
            <div>
              <div className="muted text-[11px]">First response</div>
              <div className="text-sm font-semibold">{durationBetween(t.created_at, t.first_responded_at)}</div>
            </div>
            <div>
              <div className="muted text-[11px]">Time to resolve</div>
              <div className="text-sm font-semibold">{durationBetween(t.created_at, t.resolved_at)}</div>
            </div>
          </div>

          {t.description && (
            <div className="card mb-3" style={{ padding: 12, background: "var(--surface-2)" }}>
              {t.description}
            </div>
          )}

          {canTriage && (
            <>
              <div className="row mb-3">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Status</label>
                  <select value={t.status} onChange={(e) => changeStatus(e.target.value)}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace("_", " ")}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Priority</label>
                  <select value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Assignee</label>
                  <select value={t.assignee_id ?? ""} onChange={(e) => patch({ assignee_id: e.target.value || null })}>
                    <option value="">Unassigned</option>
                    {(users.data ?? []).map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Resolution note {!resolved && <span className="muted text-xs">(required to resolve)</span>}</label>
                <textarea
                  rows={2}
                  placeholder="What was done to resolve this?"
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                />
              </div>
            </>
          )}

          {resolved && t.resolution_note && (
            <div className="card mb-3" style={{ padding: 12, background: "color-mix(in srgb, var(--ok) 10%, var(--surface))" }}>
              <div className="muted mb-1 text-[11px] font-semibold uppercase tracking-wide">Resolution</div>
              <div className="text-sm">{t.resolution_note}</div>
              {canTriage && (
                <button className="btn-sm mt-2 inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => changeStatus("open")}>
                  <RotateCcw size={13} /> Reopen
                </button>
              )}
            </div>
          )}

          <div className="mb-3">
            <Attachments entityType="ticket" entityId={id} />
          </div>

          <TicketEffort ticketId={id} initial={t.effort_minutes} onLogged={detail.reload} />

          <h4 className="mb-2">Conversation</h4>
          <div className="mb-3 flex flex-col gap-2" style={{ maxHeight: 220, overflow: "auto" }}>
            {t.comments.length === 0 && <p className="muted text-sm">No replies yet.</p>}
            {t.comments.map((c) => (
              <div
                key={c.id}
                className="card"
                style={{
                  padding: 10,
                  background: c.is_internal
                    ? "color-mix(in srgb, var(--warn) 12%, var(--surface))"
                    : "var(--surface-2)",
                }}
              >
                <div className="spread">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    {c.author_name ?? "—"}
                    {c.is_internal && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-700">
                        <Lock size={10} /> internal
                      </span>
                    )}
                  </span>
                  <span className="muted text-xs">{new Date(c.created_at).toLocaleString()}</span>
                </div>
                <div className="text-sm">{c.body}</div>
              </div>
            ))}
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, flex: 4 }}>
              <input
                placeholder={internal ? "Write an internal note…" : "Write a reply…"}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
            </div>
            <button
              className={`inline-flex items-center gap-1.5 ${internal ? "btn" : "btn-primary"}`}
              style={{ flex: "0 0 auto" }}
              onClick={send}
            >
              <Send size={14} /> {internal ? "Add note" : "Send"}
            </button>
          </div>
          {canTriage && (
            <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} style={{ width: 14 }} />
              Internal note (visible to agents only)
            </label>
          )}

          {/* Activity timeline */}
          {(activity.data?.length ?? 0) > 0 && (
            <>
              <h4 className="mb-2 mt-4 inline-flex items-center gap-1.5">
                <History size={15} /> Activity
              </h4>
              <div className="flex flex-col gap-1.5">
                {activity.data!.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-ink">{a.summary}</span>
                    <span className="muted flex-none whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function TicketEffort({
  ticketId,
  initial,
  onLogged,
}: {
  ticketId: string;
  initial: number;
  onLogged: () => void;
}) {
  const { notify } = useToast();
  const logs = useFetch<WorkLog[]>(`/api/worklogs?entity_type=ticket&entity_id=${ticketId}`);
  const [minutes, setMinutes] = useState("30");
  const [note, setNote] = useState("");

  async function log() {
    if (!note.trim()) return;
    await api("/api/worklogs", {
      method: "POST",
      body: {
        minutes: Number(minutes) || 0,
        description: note,
        kind: "ticket",
        entity_type: "ticket",
        entity_id: ticketId,
      },
    });
    setNote("");
    setMinutes("30");
    notify("Effort logged.");
    logs.reload();
    onLogged();
  }

  const total = (logs.data ?? []).reduce((s, l) => s + l.minutes, 0) || initial;

  return (
    <div className="mb-3">
      <div className="spread mb-2">
        <h4 className="m-0 inline-flex items-center gap-1.5">
          <Clock size={15} /> Effort
        </h4>
        <span className="badge blue">{hm(total)}</span>
      </div>
      {(logs.data?.length ?? 0) > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {logs.data!.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                <span className="font-medium">{l.user_name}</span>
                <span className="muted"> · {l.description}</span>
              </span>
              <span className="muted flex-none whitespace-nowrap">{hm(l.minutes)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ marginBottom: 0, flex: 4 }}>
          <input placeholder="What did you do?" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0, width: 90 }}>
          <input type="number" min="0" value={minutes} onChange={(e) => setMinutes(e.target.value)} title="Minutes" />
        </div>
        <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={log}>
          <Clock size={14} /> Log
        </button>
      </div>
    </div>
  );
}
