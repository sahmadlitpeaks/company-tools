import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  CheckSquare,
  ListChecks,
  MessageSquare,
  Plus,
  Repeat,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { api } from "../api/client";
import type { Task, TaskComment, TaskDetail, TaskItem, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Loading, Modal, PageHead, useToast } from "../components/ui";
import SavedViews from "../components/SavedViews";

const COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const RECURRENCES = ["", "daily", "weekly", "monthly"];
const PRIO_BADGE: Record<string, string> = {
  urgent: "red",
  high: "amber",
  normal: "",
  low: "blue",
};

function dueMeta(due?: string | null, status?: string): { label: string; cls: string } | null {
  if (!due) return null;
  if (status === "done") return { label: due, cls: "text-ink-muted" };
  const d = new Date(due);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `${due} · overdue`, cls: "text-red-600 font-medium" };
  if (days === 0) return { label: `${due} · today`, cls: "text-amber-600 font-medium" };
  if (days <= 3) return { label: `${due} · ${days}d`, cls: "text-amber-600" };
  return { label: due, cls: "text-ink-muted" };
}

export default function TasksPage() {
  const { notify } = useToast();
  const [mine, setMine] = useState(false);
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (mine) p.set("mine", "true");
    if (priority) p.set("priority", priority);
    if (assignee) p.set("assignee_id", assignee);
    if (due) p.set("due", due);
    return p.toString();
  }, [mine, priority, assignee, due]);
  const tasks = useFetch<Task[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
  const users = useFetch<User[]>("/api/users");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new")) {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const byStatus = useMemo(() => {
    const map: Record<string, Task[]> = { todo: [], in_progress: [], blocked: [], done: [] };
    (tasks.data ?? []).forEach((t) => (map[t.status] ?? map.todo).push(t));
    return map;
  }, [tasks.data]);

  async function move(id: string, status: string) {
    const t = (tasks.data ?? []).find((x) => x.id === id);
    if (!t || t.status === status) return;
    await api(`/api/tasks/${id}`, { method: "PATCH", body: { status } });
    tasks.reload();
  }
  async function remove(t: Task) {
    await api(`/api/tasks/${t.id}`, { method: "DELETE" });
    notify("Task deleted.");
    tasks.reload();
  }

  function applyView(p: string) {
    const u = new URLSearchParams(p);
    setMine(u.get("mine") === "true");
    setPriority(u.get("priority") || "");
    setAssignee(u.get("assignee_id") || "");
    setDue(u.get("due") || "");
  }

  return (
    <div>
      <PageHead
        title="Tasks"
        subtitle="Assign work, track progress and hit deadlines."
        action={
          <button
            className="btn-primary inline-flex items-center gap-1.5"
            style={{ flex: "0 0 auto" }}
            onClick={() => setAdding(true)}
          >
            <Plus size={15} /> New task
          </button>
        }
      />

      {/* Filters */}
      <div className="card mb-4">
        <SavedViews surface="tasks" currentParams={qs} onApply={applyView} />
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: "0 0 auto" }}>
            <label>View</label>
            <button className={`btn ${mine ? "btn-primary" : ""}`} onClick={() => setMine((m) => !m)}>
              {mine ? "My tasks" : "All tasks"}
            </button>
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
            <label>Assignee</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Anyone</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Due</label>
            <select value={due} onChange={(e) => setDue(e.target.value)}>
              <option value="">Any time</option>
              <option value="overdue">Overdue</option>
              <option value="week">Due this week</option>
            </select>
          </div>
        </div>
      </div>

      {tasks.loading ? (
        <Loading />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              className="card transition-colors"
              style={{
                background: dropCol === col.key ? "var(--brand-50)" : "var(--surface-2)",
                outline: dropCol === col.key ? "2px dashed var(--brand-400)" : "none",
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dropCol !== col.key) setDropCol(col.key);
              }}
              onDragLeave={() => setDropCol((c) => (c === col.key ? null : c))}
              onDrop={() => {
                if (dragId) void move(dragId, col.key);
                setDragId(null);
                setDropCol(null);
              }}
            >
              <div className="spread mb-2">
                <h4 className="m-0">{col.label}</h4>
                <span className="badge">{byStatus[col.key].length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {byStatus[col.key].length === 0 && <p className="muted text-xs">Nothing here.</p>}
                {byStatus[col.key].map((t) => {
                  const dm = dueMeta(t.due_date, t.status);
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropCol(null);
                      }}
                      onClick={() => setOpenId(t.id)}
                      className="card cursor-pointer select-none transition-shadow hover:shadow-soft"
                      style={{ padding: 12, background: "var(--surface)", opacity: dragId === t.id ? 0.5 : 1 }}
                    >
                      <div className="spread">
                        <span className="font-semibold">{t.title}</span>
                        {t.priority !== "normal" && (
                          <span className={`badge ${PRIO_BADGE[t.priority] ?? ""}`}>{t.priority}</span>
                        )}
                      </div>
                      {t.onboarding_task_id && (
                        <span className="badge blue mt-1 inline-block">checklist</span>
                      )}

                      {t.subtasks_total > 0 && (
                        <div className="mt-2">
                          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{ width: `${Math.round((t.subtasks_done / t.subtasks_total) * 100)}%` }}
                            />
                          </div>
                          <div className="muted mt-1 text-[11px]">
                            {t.subtasks_done}/{t.subtasks_total} subtasks
                          </div>
                        </div>
                      )}

                      <div className="muted mt-2 flex flex-wrap items-center gap-3 text-xs">
                        {t.assignee_name && (
                          <span className="inline-flex items-center gap-1">
                            <UserIcon size={12} /> {t.assignee_name}
                          </span>
                        )}
                        {dm && (
                          <span className={`inline-flex items-center gap-1 ${dm.cls}`}>
                            <CalendarClock size={12} /> {dm.label}
                          </span>
                        )}
                        {t.recurrence && (
                          <span className="inline-flex items-center gap-1">
                            <Repeat size={12} /> {t.recurrence}
                          </span>
                        )}
                        {t.comment_count > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare size={12} /> {t.comment_count}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          className="!w-auto !py-1 text-xs"
                          value={t.status}
                          onChange={(e) => move(t.id, e.target.value)}
                        >
                          {COLUMNS.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                        <button
                          className="btn-sm btn-danger"
                          style={{ flex: "0 0 auto" }}
                          onClick={() => remove(t)}
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <TaskModal
          users={users.data ?? []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            tasks.reload();
            setAdding(false);
          }}
        />
      )}
      {openId && (
        <TaskDetailModal
          id={openId}
          users={users.data ?? []}
          onClose={() => setOpenId(null)}
          onChanged={tasks.reload}
        />
      )}
    </div>
  );
}

function TaskModal({ users, onClose, onSaved }: { users: User[]; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "normal",
    due_date: "",
    recurrence: "",
    assignee_id: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        body: {
          title: form.title,
          description: form.description || null,
          priority: form.priority,
          due_date: form.due_date || null,
          recurrence: form.recurrence || null,
          assignee_id: form.assignee_id || null,
        },
      });
      notify("Task created.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="New task" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Title *</label>
          <input required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label>Priority</label>
            <select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Due date</label>
            <input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
          </div>
          <div className="field">
            <label>Repeat</label>
            <select value={form.recurrence} onChange={(e) => set("recurrence", e.target.value)}>
              {RECURRENCES.map((r) => (
                <option key={r} value={r}>{r || "Don't repeat"}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Assign to</label>
          <select value={form.assignee_id} onChange={(e) => set("assignee_id", e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>
            ))}
          </select>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : "Create task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TaskDetailModal({
  id,
  users,
  onClose,
  onChanged,
}: {
  id: string;
  users: User[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const detail = useFetch<TaskDetail>(`/api/tasks/${id}`);
  const [newItem, setNewItem] = useState("");
  const [comment, setComment] = useState("");
  const t = detail.data;

  async function patch(body: Record<string, unknown>) {
    await api(`/api/tasks/${id}`, { method: "PATCH", body });
    detail.reload();
    onChanged();
  }
  async function addItem() {
    if (!newItem.trim()) return;
    await api(`/api/tasks/${id}/items`, { method: "POST", body: { title: newItem.trim() } });
    setNewItem("");
    detail.reload();
    onChanged();
  }
  async function toggleItem(it: TaskItem) {
    await api(`/api/tasks/items/${it.id}`, { method: "PATCH", body: { done: !it.done } });
    detail.reload();
    onChanged();
  }
  async function delItem(it: TaskItem) {
    await api(`/api/tasks/items/${it.id}`, { method: "DELETE" });
    detail.reload();
    onChanged();
  }
  async function send() {
    if (!comment.trim()) return;
    await api(`/api/tasks/${id}/comments`, { method: "POST", body: { body: comment } });
    setComment("");
    detail.reload();
    onChanged();
    notify("Comment added.");
  }

  const pct = t && t.subtasks_total > 0 ? Math.round((t.subtasks_done / t.subtasks_total) * 100) : 0;

  return (
    <Modal title={t?.title ?? "Task"} onClose={onClose} maxWidth={620}>
      {!t ? (
        <Loading />
      ) : (
        <>
          {t.description && (
            <div className="card mb-3" style={{ padding: 12, background: "var(--surface-2)" }}>
              {t.description}
            </div>
          )}

          <div className="row mb-3">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Status</label>
              <select value={t.status} onChange={(e) => patch({ status: e.target.value })}>
                {COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
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
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="row mb-3">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Due date</label>
              <input type="date" value={t.due_date ?? ""} onChange={(e) => patch({ due_date: e.target.value || null })} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Repeat</label>
              <select value={t.recurrence ?? ""} onChange={(e) => patch({ recurrence: e.target.value || null })}>
                {RECURRENCES.map((r) => (
                  <option key={r} value={r}>{r || "Don't repeat"}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Checklist */}
          <div className="spread mb-2">
            <h4 className="m-0 inline-flex items-center gap-1.5">
              <ListChecks size={15} /> Checklist
            </h4>
            {t.subtasks_total > 0 && <span className="badge blue">{pct}%</span>}
          </div>
          {t.subtasks_total > 0 && (
            <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="mb-2 flex flex-col gap-1">
            {t.items.map((it) => (
              <div key={it.id} className="group flex items-center gap-2">
                <input type="checkbox" checked={it.done} onChange={() => toggleItem(it)} style={{ width: 16 }} />
                <span className={`flex-1 text-sm ${it.done ? "text-ink-muted line-through" : ""}`}>{it.title}</span>
                <button
                  className="text-ink-muted opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                  onClick={() => delItem(it)}
                  title="Remove"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="row mb-4" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, flex: 4 }}>
              <input
                placeholder="Add a checklist item…"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())}
              />
            </div>
            <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={addItem}>
              <Plus size={14} /> Add
            </button>
          </div>

          {/* Comments */}
          <h4 className="mb-2 inline-flex items-center gap-1.5">
            <MessageSquare size={15} /> Comments
          </h4>
          <div className="mb-3 flex flex-col gap-2" style={{ maxHeight: 220, overflow: "auto" }}>
            {t.comments.length === 0 && <p className="muted text-sm">No comments yet.</p>}
            {t.comments.map((c: TaskComment) => (
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
                placeholder="Write a comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
            </div>
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={send}>
              <CheckSquare size={14} /> Post
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
