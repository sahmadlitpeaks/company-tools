import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, Plus, Trash2, User as UserIcon } from "lucide-react";
import { api } from "../api/client";
import type { Task, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Loading, Modal, PageHead, useToast } from "../components/ui";

const COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const PRIO_BADGE: Record<string, string> = {
  urgent: "red",
  high: "amber",
  normal: "",
  low: "blue",
};

export default function TasksPage() {
  const { notify } = useToast();
  const [mine, setMine] = useState(false);
  const tasks = useFetch<Task[]>(`/api/tasks${mine ? "?mine=true" : ""}`);
  const users = useFetch<User[]>("/api/users");
  const [adding, setAdding] = useState(false);
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

  async function move(t: Task, status: string) {
    await api(`/api/tasks/${t.id}`, { method: "PATCH", body: { status } });
    tasks.reload();
  }
  async function remove(t: Task) {
    await api(`/api/tasks/${t.id}`, { method: "DELETE" });
    notify("Task deleted.");
    tasks.reload();
  }

  return (
    <div>
      <PageHead
        title="Tasks"
        subtitle="Assign work, track progress and hit deadlines."
        action={
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            <button
              className={`btn ${mine ? "btn-primary" : ""}`}
              style={{ flex: "0 0 auto" }}
              onClick={() => setMine((m) => !m)}
            >
              My tasks
            </button>
            <button
              className="btn-primary inline-flex items-center gap-1.5"
              style={{ flex: "0 0 auto" }}
              onClick={() => setAdding(true)}
            >
              <Plus size={15} /> New task
            </button>
          </div>
        }
      />

      {tasks.loading ? (
        <Loading />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          {COLUMNS.map((col) => (
            <div key={col.key} className="card" style={{ background: "var(--surface-2)" }}>
              <div className="spread mb-2">
                <h4 className="m-0">{col.label}</h4>
                <span className="badge">{byStatus[col.key].length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {byStatus[col.key].length === 0 && (
                  <p className="muted text-xs">Nothing here.</p>
                )}
                {byStatus[col.key].map((t) => (
                  <div
                    key={t.id}
                    className="card"
                    style={{ padding: 12, background: "var(--surface)" }}
                  >
                    <div className="spread">
                      <span className="font-semibold">{t.title}</span>
                      <span className={`badge ${PRIO_BADGE[t.priority] ?? ""}`}>
                        {t.priority}
                      </span>
                    </div>
                    {t.description && (
                      <p className="muted mt-1 text-xs">{t.description}</p>
                    )}
                    <div className="muted mt-2 flex flex-wrap items-center gap-3 text-xs">
                      {t.assignee_name && (
                        <span className="inline-flex items-center gap-1">
                          <UserIcon size={12} /> {t.assignee_name}
                        </span>
                      )}
                      {t.due_date && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock size={12} /> {t.due_date}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        className="!w-auto !py-1 text-xs"
                        value={t.status}
                        onChange={(e) => move(t, e.target.value)}
                      >
                        {COLUMNS.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
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
                ))}
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
    </div>
  );
}

function TaskModal({
  users,
  onClose,
  onSaved,
}: {
  users: User[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "normal",
    due_date: "",
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
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div className="row">
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
          <div className="field">
            <label>Due date</label>
            <input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Assign to</label>
          <select value={form.assignee_id} onChange={(e) => set("assignee_id", e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name ?? u.email}
              </option>
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
