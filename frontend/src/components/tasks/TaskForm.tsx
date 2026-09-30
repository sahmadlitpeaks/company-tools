import { useState, type FormEvent } from "react";
import { api } from "@/api/client";
import type { BoardTask, TaskOptions } from "@/api/tasks";
import { TASK_PRIORITIES, taskError } from "@/api/tasks";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TaskChoice } from "./TaskChoice";

export function TaskForm({ task, options, defaultDepartment, onClose, onSaved }: {
  task?: BoardTask; options: TaskOptions; defaultDepartment?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: task?.title ?? "", description: task?.description ?? "", priority: task?.priority ?? "normal",
    due_date: task?.due_date ?? "", recurrence: task?.recurrence ?? "none", assignee_id: task?.assignee_id ?? "none",
    department_id: task?.assignee_department_id ?? defaultDepartment ?? "none",
  });
  const [state, setState] = useState({ busy: false, error: "" });
  const members = options.users.filter((person) => form.department_id === "none" ? !person.department_id : person.department_id === form.department_id);
  function set(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) { setState({ busy: false, error: "Enter a task title." }); document.getElementById("task-title")?.focus(); return; }
    setState({ busy: true, error: "" });
    try {
      await api(task ? `/api/tasks/${task.id}` : "/api/tasks", { method: task ? "PATCH" : "POST", body: {
        ...form, title: form.title.trim(), description: form.description.trim() || null,
        due_date: form.due_date || null, recurrence: form.recurrence === "none" ? null : form.recurrence,
        assignee_id: form.assignee_id === "none" ? null : form.assignee_id,
        department_id: form.department_id === "none" ? null : form.department_id,
      } });
      onSaved();
    } catch (cause) { setState({ busy: false, error: taskError(cause) }); }
  }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}><DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
    <DialogHeader><DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle><DialogDescription>Choose a department, then assign an active member. Assigned people receive a task notification and an email when email delivery is configured.</DialogDescription></DialogHeader>
    <form onSubmit={(event) => void save(event)} className="space-y-4" aria-busy={state.busy}>
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      <FieldGroup>
        <Field><FieldLabel htmlFor="task-title">Task title</FieldLabel><Input id="task-title" value={form.title} onChange={(event) => set("title", event.target.value)} maxLength={512} required /></Field>
        <Field><FieldLabel htmlFor="task-description">Description and instructions</FieldLabel><Textarea id="task-description" value={form.description} onChange={(event) => set("description", event.target.value)} rows={3} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <TaskChoice id="task-department" label="Department" value={form.department_id} items={[{ value: "none", label: "No department" }, ...options.departments.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => setForm((current) => ({ ...current, department_id: value, assignee_id: "none" }))} />
          <TaskChoice id="task-assignee" label="Assign to" value={form.assignee_id} items={[{ value: "none", label: "Unassigned" }, ...members.map((person) => ({ value: person.id, label: person.name }))]} onChange={(value) => set("assignee_id", value)} />
          <Field><FieldLabel htmlFor="task-due">Due date</FieldLabel><Input id="task-due" type="date" value={form.due_date} onChange={(event) => set("due_date", event.target.value)} /></Field>
          <TaskChoice id="task-priority" label="Priority" value={form.priority} items={TASK_PRIORITIES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={(value) => set("priority", value)} />
          <TaskChoice id="task-recurrence" label="Repeat" value={form.recurrence} items={[{ value: "none", label: "Does not repeat" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} onChange={(value) => set("recurrence", value)} />
        </div>
      </FieldGroup>
      <div className="sticky bottom-[-1rem] -mx-4 -mb-4 flex justify-end gap-2 border-t border-border bg-popover p-4"><Button type="button" variant="outline" disabled={state.busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={state.busy}>{state.busy ? "Saving…" : task ? "Save changes" : "Create task"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
