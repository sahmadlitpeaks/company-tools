import { useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { BoardTask, TaskOptions } from "@/api/tasks";
import { dateLabel, TASK_STATUSES, taskError } from "@/api/tasks";
import type { TaskDetail as TaskDetailData } from "@/api/types";
import { useFetch } from "@/hooks/useApi";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, Loading } from "@/components/ui";
import { TaskChoice } from "./TaskChoice";
import { TaskForm } from "./TaskForm";

export function TaskDetail({ task, options, onClose, onReload, onStatus }: {
  task: BoardTask; options: TaskOptions; onClose: () => void; onReload: () => void; onStatus: (state: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) return <TaskForm task={task} options={options} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onReload(); }} />;
  if (task.source === "compliance") return <ComplianceTaskDetail task={task} options={options} onClose={onClose} onReload={onReload} onStatus={onStatus} />;
  return <OrdinaryTaskDetail task={task} onClose={onClose} onReload={onReload} onStatus={onStatus} onEdit={() => setEditing(true)} />;
}

function OrdinaryTaskDetail({ task, onClose, onReload, onStatus, onEdit }: {
  task: BoardTask; onClose: () => void; onReload: () => void; onStatus: (state: string) => Promise<void>; onEdit: () => void;
}) {
  const detail = useFetch<TaskDetailData>(`/api/tasks/${task.id}`);
  const [item, setItem] = useState("");
  const [comment, setComment] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  async function mutate(path: string, method: string, body?: unknown, reset?: () => void) {
    setState({ busy: true, error: "" });
    try { await api(path, { method, body }); reset?.(); detail.reload(); onReload(); setState({ busy: false, error: "" }); }
    catch (cause) { setState({ busy: false, error: taskError(cause) }); }
  }
  async function changeStatus(value: string) {
    setState({ busy: true, error: "" });
    try { await onStatus(value); detail.reload(); setState({ busy: false, error: "" }); }
    catch (cause) { setState({ busy: false, error: taskError(cause) }); }
  }
  const data = detail.data;
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
    <DialogHeader><DialogTitle className="break-words">{task.title}</DialogTitle><DialogDescription>{task.assignee_name || "Unassigned"} · {dateLabel(task.due_date)}</DialogDescription></DialogHeader>
    {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
    {detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> : detail.loading ? <Loading /> : data && <>
      <div className="flex flex-wrap items-end justify-between gap-4"><TaskChoice id="task-detail-status" label="Status" value={task.status} items={TASK_STATUSES} onChange={(value) => void changeStatus(value)} disabled={state.busy} /><Button variant="outline" onClick={onEdit} disabled={state.busy}>Edit task</Button></div>
      {data.description && <p className="whitespace-pre-wrap break-words text-sm">{data.description}</p>}
      <p className="text-xs text-muted-foreground">Created by {data.created_by_name || "the workspace"} · {new Date(data.created_at).toLocaleString()}</p>
      <section className="space-y-3 border-t border-border pt-4"><h3 className="font-semibold">Checklist <span className="text-sm font-normal text-muted-foreground">{data.subtasks_done}/{data.subtasks_total}</span></h3>
        {data.items.map((entry) => <div key={entry.id} className="flex items-center gap-3"><Checkbox checked={entry.done} disabled={state.busy} onCheckedChange={() => void mutate(`/api/tasks/items/${entry.id}`, "PATCH", { done: !entry.done })} aria-label={`Mark ${entry.title} ${entry.done ? "incomplete" : "done"}`} /><span className={`min-w-0 flex-1 break-words text-sm ${entry.done ? "text-muted-foreground line-through" : ""}`}>{entry.title}</span><Button variant="ghost" size="icon" disabled={state.busy} onClick={() => void mutate(`/api/tasks/items/${entry.id}`, "DELETE")} aria-label={`Remove checklist item: ${entry.title}`}><Trash2 /></Button></div>)}
        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (item.trim()) void mutate(`/api/tasks/${task.id}/items`, "POST", { title: item.trim() }, () => setItem("")); }}>
          <Field className="min-w-0 flex-1"><FieldLabel htmlFor="task-new-item">New checklist item</FieldLabel><Input id="task-new-item" value={item} onChange={(event) => setItem(event.target.value)} /></Field><Button type="submit" variant="outline" disabled={state.busy || !item.trim()}><Plus data-icon="inline-start" />Add</Button>
        </form>
      </section>
      <section className="space-y-3 border-t border-border pt-4"><h3 className="font-semibold">Comments</h3>
        {data.comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
        {data.comments.map((entry) => <div key={entry.id} className="space-y-1 border border-border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{entry.author_name || "Former employee"} · {new Date(entry.created_at).toLocaleString()}</p><p className="whitespace-pre-wrap break-words text-sm">{entry.body}</p></div>)}
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (comment.trim()) void mutate(`/api/tasks/${task.id}/comments`, "POST", { body: comment.trim() }, () => setComment("")); }}>
          <Field><FieldLabel htmlFor="task-comment">Add a comment</FieldLabel><Textarea id="task-comment" value={comment} onChange={(event) => setComment(event.target.value)} rows={2} /></Field><Button type="submit" disabled={state.busy || !comment.trim()}><Check data-icon="inline-start" />Post comment</Button>
        </form>
      </section>
    </>}
  </DialogContent></Dialog>;
}

function ComplianceTaskDetail({ task, options, onClose, onReload, onStatus }: {
  task: BoardTask; options: TaskOptions; onClose: () => void; onReload: () => void; onStatus: (state: string) => Promise<void>;
}) {
  const [form, setForm] = useState({ department: task.assignee_department_id ?? "none", owner: task.assignee_id ?? "inbox", note: "" });
  const [state, setState] = useState({ busy: false, error: "" });
  const members = options.users.filter((person) => person.department_id === form.department);
  async function assign(event: FormEvent) {
    event.preventDefault();
    if (form.department === "none" || !form.note.trim()) { setState({ busy: false, error: "Choose a department and enter a reason for the assignment." }); return; }
    setState({ busy: true, error: "" });
    try {
      await api(`/api/sharepoint/compliance/tasks/${task.id}/assign`, { method: "POST", body: {
        department_id: form.department, owner_user_id: form.owner === "inbox" ? null : form.owner,
        owner_department_id: form.owner === "inbox" ? form.department : null, note: form.note.trim(),
      } });
      setState({ busy: false, error: "" }); onReload(); onClose();
    } catch (cause) { setState({ busy: false, error: taskError(cause) }); }
  }
  async function change(value: string) {
    setState({ busy: true, error: "" });
    try { await onStatus(value); setState({ busy: false, error: "" }); }
    catch (cause) { setState({ busy: false, error: taskError(cause) }); }
  }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}><DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
    <DialogHeader><DialogTitle className="break-words">{task.title}</DialogTitle><DialogDescription>Document compliance action · {task.company || "External entity"}</DialogDescription></DialogHeader>
    <Badge variant="info">Document compliance</Badge>
    {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
    <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Action deadline</dt><dd className="font-medium">{dateLabel(task.due_date)}</dd></div><div><dt className="text-muted-foreground">Responsible owner</dt><dd>{task.assignee_name || "Unassigned"}</dd></div><div className="sm:col-span-2"><dt className="text-muted-foreground">Source document</dt><dd className="break-words">{task.document_name}</dd></div><div><dt className="text-muted-foreground">Deadline based on</dt><dd>{task.basis?.replace(/_/g, " ") || "Document action"}</dd></div>{task.document_expiry_date && <div><dt className="text-muted-foreground">Document expiry</dt><dd>{dateLabel(task.document_expiry_date)}</dd></div>}{task.reference_number && <div><dt className="text-muted-foreground">Reference</dt><dd>{task.reference_number}</dd></div>}</dl>
    {task.document_url && <Button variant="outline" nativeButton={false} render={<a aria-label="Open original in SharePoint" href={task.document_url} target="_blank" rel="noreferrer" />}>Open original in SharePoint<ArrowUpRight data-icon="inline-end" /></Button>}
    <TaskChoice id="document-task-status" label="Status" value={task.status} items={TASK_STATUSES} onChange={(value) => void change(value)} disabled={state.busy || task.can_change_status === false} />
    <p className="text-sm text-muted-foreground">Completing this action stops its deadline reminders. Reopening it restores the remaining reminders.</p>
    {task.can_assign && task.status !== "done" && <form onSubmit={(event) => void assign(event)} className="space-y-4 border-t border-border pt-4">
      <h3 className="font-semibold">Assign responsibility</h3><FieldGroup className="grid gap-4 sm:grid-cols-2">
        <TaskChoice id="document-task-department" label="Department" value={form.department} items={[{ value: "none", label: "Choose department" }, ...options.departments.map((entry) => ({ value: entry.id, label: entry.name }))]} onChange={(value) => setForm((current) => ({ ...current, department: value, owner: "inbox" }))} />
        <TaskChoice id="document-task-owner" label="Department member" value={form.owner} items={[{ value: "inbox", label: "Department inbox" }, ...members.map((entry) => ({ value: entry.id, label: entry.name }))]} onChange={(value) => setForm((current) => ({ ...current, owner: value }))} />
        <Field className="sm:col-span-2"><FieldLabel htmlFor="document-task-note">Assignment reason</FieldLabel><Textarea id="document-task-note" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} required minLength={3} maxLength={2000} /></Field>
      </FieldGroup><Button type="submit" disabled={state.busy}>{state.busy ? "Saving…" : "Save assignment"}</Button>
    </form>}
    <Button variant="outline" nativeButton={false} render={<Link to="/sharepoint/compliance" />}>View document and audit history<ArrowUpRight data-icon="inline-end" /></Button>
  </DialogContent></Dialog>;
}
