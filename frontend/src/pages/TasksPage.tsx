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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const RECURRENCES = ["", "daily", "weekly", "monthly"];
const PRIO_BADGE: Record<string, "destructive" | "warning" | "secondary" | "info"> = {
  urgent: "destructive",
  high: "warning",
  normal: "secondary",
  low: "info",
};

function dueMeta(due?: string | null, status?: string): { label: string; cls: string } | null {
  if (!due) return null;
  if (status === "done") return { label: due, cls: "text-muted-foreground" };
  const d = new Date(due);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `${due} · overdue`, cls: "text-destructive font-medium" };
  if (days === 0) return { label: `${due} · today`, cls: "text-warning-foreground font-medium" };
  if (days <= 3) return { label: `${due} · ${days}d`, cls: "text-warning-foreground" };
  return { label: due, cls: "text-muted-foreground" };
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
          <Button onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" /> New task
          </Button>
        }
      />

      {/* Filters */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SavedViews surface="tasks" currentParams={qs} onApply={applyView} />
          <FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field>
              <FieldLabel>View</FieldLabel>
              <Button variant={mine ? "default" : "outline"} onClick={() => setMine((m) => !m)}>
                {mine ? "My tasks" : "All tasks"}
              </Button>
            </Field>
            <Field>
              <FieldLabel htmlFor="tasks-filter-priority">Priority</FieldLabel>
              <Select
                items={[{ value: null, label: "All" }, ...PRIORITIES.map((p) => ({ value: p, label: p }))]}
                value={priority || null}
                onValueChange={(value) => setPriority(value ?? "")}
              >
                <SelectTrigger id="tasks-filter-priority" aria-label="Priority" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value={null}>All</SelectItem>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="tasks-filter-assignee">Assignee</FieldLabel>
              <Select
                items={[{ value: null, label: "Anyone" }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]}
                value={assignee || null}
                onValueChange={(value) => setAssignee(value ?? "")}
              >
                <SelectTrigger id="tasks-filter-assignee" aria-label="Assignee" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value={null}>Anyone</SelectItem>
                  {(users.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="tasks-filter-due">Due</FieldLabel>
              <Select
                items={[{ value: null, label: "Any time" }, { value: "overdue", label: "Overdue" }, { value: "week", label: "Due this week" }]}
                value={due || null}
                onValueChange={(value) => setDue(value ?? "")}
              >
                <SelectTrigger id="tasks-filter-due" aria-label="Due" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value={null}>Any time</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="week">Due this week</SelectItem>
                </SelectGroup></SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      {tasks.loading ? (
        <Loading />
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {COLUMNS.map((col) => (
            <Card
              key={col.key}
              className={cn("bg-muted/40 transition-colors", dropCol === col.key && "ring-2 ring-primary")}
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
              <CardHeader className="grid grid-cols-[1fr_auto] items-center">
                <CardTitle>{col.label}</CardTitle>
                <Badge variant="secondary">{byStatus[col.key].length}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {byStatus[col.key].length === 0 && <p className="text-xs text-muted-foreground">Nothing here.</p>}
                {byStatus[col.key].map((t) => {
                  const dm = dueMeta(t.due_date, t.status);
                  return (
                    <Card
                      key={t.id}
                      draggable
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropCol(null);
                      }}
                      size="sm"
                      className={cn("cursor-grab select-none transition-opacity", dragId === t.id && "opacity-50")}
                    >
                      <CardHeader className="grid grid-cols-[1fr_auto] items-start">
                        <CardTitle>
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto max-w-full justify-start whitespace-normal p-0 text-left text-sm"
                            aria-label={`Open task: ${t.title}`}
                            onClick={() => setOpenId(t.id)}
                          >
                            {t.title}
                          </Button>
                        </CardTitle>
                        {t.priority !== "normal" && (
                          <Badge variant={PRIO_BADGE[t.priority] ?? "secondary"}>{t.priority}</Badge>
                        )}
                      </CardHeader>
                      <CardContent className="flex flex-col gap-2">
                      {t.onboarding_task_id && <Badge variant="info">checklist</Badge>}

                      {t.subtasks_total > 0 && (
                        <div>
                          <div className="h-1.5 w-full overflow-hidden bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${Math.round((t.subtasks_done / t.subtasks_total) * 100)}%` }}
                            />
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {t.subtasks_done}/{t.subtasks_total} subtasks
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
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

                      <div className="flex items-center gap-2">
                        <Select
                          items={COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
                          value={t.status}
                          onValueChange={(value) => value !== null && move(t.id, value)}
                        >
                          <SelectTrigger
                            id={`task-card-status-${t.id}`}
                            aria-label="Task status"
                            className="w-full"
                            size="sm"
                            onClick={(e) => e.stopPropagation()}
                          ><SelectValue /></SelectTrigger>
                          <SelectContent><SelectGroup>
                            {COLUMNS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                          </SelectGroup></SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(t);
                          }}
                          title="Delete"
                          aria-label="Delete task"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </CardContent>
            </Card>
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="New task" onClose={onClose}>
      <form onSubmit={submit} aria-busy={isSubmitting || undefined}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="task-title">Title *</FieldLabel>
            <Input id="task-title" required minLength={1} value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="task-description">Description</FieldLabel>
            <Textarea id="task-description" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <FieldGroup className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
              <Select items={PRIORITIES.map((p) => ({ value: p, label: p }))} value={form.priority} onValueChange={(value) => set("priority", value ?? "")}>
                <SelectTrigger id="task-priority" aria-label="Priority" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="task-due">Due date</FieldLabel>
              <Input id="task-due" type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="task-recurrence">Repeat</FieldLabel>
              <Select
                items={RECURRENCES.map((r) => ({ value: r || null, label: r || "Don't repeat" }))}
                value={form.recurrence || null}
                onValueChange={(value) => set("recurrence", value ?? "")}
              >
                <SelectTrigger id="task-recurrence" aria-label="Repeat" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {RECURRENCES.map((r) => <SelectItem key={r} value={r || null}>{r || "Don't repeat"}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="task-assignee">Assign to</FieldLabel>
            <Select
              items={[{ value: null, label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]}
              value={form.assignee_id || null}
              onValueChange={(value) => set("assignee_id", value ?? "")}
            >
              <SelectTrigger id="task-assignee" aria-label="Assign to" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={null}>Unassigned</SelectItem>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Create task"}
            </Button>
          </div>
        </FieldGroup>
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
            <Card size="sm" className="mb-3 bg-muted/40"><CardContent>{t.description}</CardContent></Card>
          )}

          <FieldGroup className="mb-3 grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="task-detail-status">Status</FieldLabel>
              <Select items={COLUMNS.map((c) => ({ value: c.key, label: c.label }))} value={t.status} onValueChange={(value) => value !== null && patch({ status: value })}>
                <SelectTrigger id="task-detail-status" aria-label="Status" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {COLUMNS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="task-detail-priority">Priority</FieldLabel>
              <Select items={PRIORITIES.map((p) => ({ value: p, label: p }))} value={t.priority} onValueChange={(value) => value !== null && patch({ priority: value })}>
                <SelectTrigger id="task-detail-priority" aria-label="Priority" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="task-detail-assignee">Assignee</FieldLabel>
              <Select
                items={[{ value: null, label: "Unassigned" }, ...users.map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]}
                value={t.assignee_id ?? null}
                onValueChange={(value) => patch({ assignee_id: value ?? null })}
              >
                <SelectTrigger id="task-detail-assignee" aria-label="Assignee" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value={null}>Unassigned</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <FieldGroup className="mb-3 grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="task-detail-due">Due date</FieldLabel>
              <Input id="task-detail-due" type="date" value={t.due_date ?? ""} onChange={(e) => patch({ due_date: e.target.value || null })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="task-detail-recurrence">Repeat</FieldLabel>
              <Select
                items={RECURRENCES.map((r) => ({ value: r || null, label: r || "Don't repeat" }))}
                value={t.recurrence ?? null}
                onValueChange={(value) => patch({ recurrence: value ?? null })}
              >
                <SelectTrigger id="task-detail-recurrence" aria-label="Repeat" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                  {RECURRENCES.map((r) => <SelectItem key={r} value={r || null}>{r || "Don't repeat"}</SelectItem>)}
                </SelectGroup></SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          {/* Checklist */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="inline-flex items-center gap-1.5">
              <ListChecks /> Checklist
            </h4>
            {t.subtasks_total > 0 && <Badge variant="info">{pct}%</Badge>}
          </div>
          {t.subtasks_total > 0 && (
            <div className="mb-2 h-1.5 w-full overflow-hidden bg-muted">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="mb-2 flex flex-col gap-1">
            {t.items.map((it) => (
              <div key={it.id} className="group flex items-center gap-2">
                <Checkbox
                  checked={it.done}
                  onCheckedChange={() => toggleItem(it)}
                  aria-label={`Mark "${it.title}" ${it.done ? "incomplete" : "done"}`}
                />
                <span className={cn("flex-1 text-sm", it.done && "text-muted-foreground line-through")}>{it.title}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => delItem(it)}
                  title="Remove"
                  aria-label={`Remove "${it.title}"`}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <div className="mb-4 flex items-end gap-2">
            <Field>
              <FieldLabel htmlFor="task-checklist-new" className="sr-only">Checklist item</FieldLabel>
              <Input
                id="task-checklist-new"
                aria-label="Add a checklist item"
                placeholder="Add a checklist item…"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())}
              />
            </Field>
            <Button type="button" variant="outline" onClick={addItem}>
              <Plus data-icon="inline-start" /> Add
            </Button>
          </div>

          {/* Comments */}
          <h4 className="mb-2 inline-flex items-center gap-1.5">
            <MessageSquare /> Comments
          </h4>
          <div className="mb-3 flex max-h-56 flex-col gap-2 overflow-auto">
            {t.comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
            {t.comments.map((c: TaskComment) => (
              <Card key={c.id} size="sm" className="bg-muted/40">
                <CardHeader className="grid grid-cols-[1fr_auto] items-center">
                  <span className="text-sm font-semibold">{c.author_name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                </CardHeader>
                <CardContent className="text-sm">{c.body}</CardContent>
              </Card>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Field>
              <FieldLabel htmlFor="task-comment" className="sr-only">Comment</FieldLabel>
              <Input
                id="task-comment"
                aria-label="Write a comment"
                placeholder="Write a comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
            </Field>
            <Button type="button" onClick={send}>
              <CheckSquare data-icon="inline-start" /> Post
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
