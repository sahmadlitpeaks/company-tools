import { useState, type FormEvent } from "react";
import { api } from "@/api/client";
import {
  BOARD_TYPES, ISSUE_PRIORITIES, ISSUE_TYPES, parentCandidates, pmError,
  type IssuePriority, type IssueStatus, type IssueType, type PmIssue, type PmMember, type PmProject, type PmSprint,
} from "@/api/pm";
import { useAuth } from "@/auth/AuthContext";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { MarkdownField } from "./MarkdownField";
import { useWorkspace } from "./WorkspaceContext";

const NONE = "none";

/** Create or edit an issue. Field rules mirror the API (see backend/app/api/pm.py). */
export function IssueForm({ project, members, issues, sprints = [], issue, defaults, onClose, onSaved }: {
  project: PmProject;
  members: PmMember[];
  issues: PmIssue[];
  /** Open (active and future) sprints. */
  sprints?: PmSprint[];
  issue?: PmIssue;
  defaults?: { issue_type?: IssueType; parent_id?: string; sprint_id?: string; workflow_state?: string };
  onClose: () => void;
  onSaved: (saved: PmIssue) => void;
}) {
  const { user } = useAuth();
  const config = useWorkspace();
  const [template, setTemplate] = useState(NONE);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(() => ({ ...Object.fromEntries(config.fields.filter((field) => field.kind === "checkbox").map((field) => [field.key, false])), ...issue?.custom_fields }));
  const [form, setForm] = useState({
    issue_type: issue?.issue_type ?? defaults?.issue_type ?? "task",
    summary: issue?.summary ?? "",
    description: issue?.description ?? "",
    workflow_state: issue?.workflow_state ?? issue?.status ?? defaults?.workflow_state ?? "todo",
    component: issue?.component ?? NONE,
    priority: issue?.priority ?? "medium",
    story_points: issue?.story_points?.toString() ?? "",
    labels: (issue?.labels ?? []).join(", "),
    parent_id: issue?.parent_id ?? defaults?.parent_id ?? NONE,
    assignee_id: issue?.assignee_id ?? NONE,
    sprint_id: issue?.sprint_id ?? defaults?.sprint_id ?? NONE,
    reporter_id: issue?.reporter_id ?? (members.some((m) => m.user_id === user?.id) ? user!.id : NONE),
    start_date: issue?.start_date ?? "",
    due_date: issue?.due_date ?? "",
  });
  const [state, setState] = useState({ busy: false, error: "" });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const type = form.issue_type as IssueType;
  const parents = parentCandidates(issues, type, issue?.id);
  const assignable = members.filter((member) => member.role !== "viewer");
  const parentRequired = type === "subtask";
  const sprintable = project.sprints_enabled && BOARD_TYPES.includes(type);
  // Keep showing a closed sprint the issue already belongs to, so editing doesn't silently move it.
  const sprintChoices = [...sprints, ...(issue?.sprint_id && !sprints.some((s) => s.id === issue.sprint_id) ? [{ id: issue.sprint_id, name: issue.sprint_name ?? "Closed sprint" }] : [])];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.summary.trim()) return setState({ busy: false, error: "Enter a summary." });
    if (parentRequired && form.parent_id === NONE) return setState({ busy: false, error: "Choose the parent issue for this sub-task." });
    const points = form.story_points.trim();
    if (points && (!Number.isFinite(Number(points)) || Number(points) < 0 || Number(points) > 1000)) return setState({ busy: false, error: "Story points must be between zero and 1000." });
    const body = {
      issue_type: type,
      summary: form.summary.trim(),
      description: form.description.trim() || null,
      status: config.states.find((item) => item.key === form.workflow_state)?.category as IssueStatus,
      workflow_state: form.workflow_state,
      component: form.component === NONE ? null : form.component,
      custom_fields: customFields,
      priority: form.priority as IssuePriority,
      story_points: points ? Number(points) : null,
      labels: form.labels.split(",").map((label) => label.trim()).filter(Boolean),
      parent_id: type === "epic" || form.parent_id === NONE ? null : form.parent_id,
      assignee_id: form.assignee_id === NONE ? null : form.assignee_id,
      ...(project.sprints_enabled ? { sprint_id: sprintable && form.sprint_id !== NONE ? form.sprint_id : null } : {}),
      ...(form.reporter_id !== NONE ? { reporter_id: form.reporter_id } : {}),
      start_date: form.start_date || null,
      due_date: form.due_date || null,
    };
    setState({ busy: true, error: "" });
    try {
      const saved = issue
        ? await api<PmIssue>(`/api/pm/issues/${issue.id}`, { method: "PATCH", body })
        : await api<PmIssue>(`/api/pm/projects/${project.id}/issues`, { method: "POST", body });
      onSaved(saved);
    } catch (cause) {
      setState({ busy: false, error: pmError(cause) });
    }
  }

  const title = issue ? `Edit ${issue.key}` : "Create issue";
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{project.key} · {project.name}</DialogDescription>
      </DialogHeader>
      <form id="pm-issue-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          {!issue && config.templates.length > 0 && <div className="flex flex-col gap-2 sm:col-span-2">
            <TaskChoice id="pm-issue-template" label="Issue template" value={template} items={[{ value: NONE, label: "Start from scratch" }, ...config.templates.map((item) => ({ value: item.key, label: item.name }))]} onChange={setTemplate} />
            <Button type="button" variant="outline" className="self-start" disabled={template === NONE} onClick={() => {
              const selected = config.templates.find((item) => item.key === template);
              if (selected) setForm((current) => ({ ...current, issue_type: selected.issue_type, description: selected.description, priority: selected.priority as IssuePriority, parent_id: selected.issue_type !== "epic" && issues.some((item) => item.id === current.parent_id && item.issue_type === "epic") ? current.parent_id : NONE }));
            }}>Apply template</Button>
            <FieldDescription>Applying a template replaces the type, priority and description in this draft.</FieldDescription>
          </div>}
          <TaskChoice id="pm-issue-type" label="Issue type" value={form.issue_type} items={ISSUE_TYPES} onChange={(value) => setForm((current) => ({ ...current, issue_type: value as IssueType, parent_id: NONE }))} />
          {type !== "epic" && <TaskChoice
            id="pm-issue-parent" label={parentRequired ? "Parent issue" : "Epic"} value={form.parent_id}
            items={[...(parentRequired ? [] : [{ value: NONE, label: "No epic" }]), ...(parentRequired && form.parent_id === NONE ? [{ value: NONE, label: "Choose a parent" }] : []), ...parents.map((p) => ({ value: p.id, label: `${p.key} ${p.summary}` }))]}
            onChange={(value) => set("parent_id", value)}
          />}
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="pm-issue-summary">Summary</FieldLabel>
            <Input id="pm-issue-summary" value={form.summary} maxLength={255} required onChange={(event) => set("summary", event.target.value)} />
          </Field>
          <div className="sm:col-span-2"><MarkdownField id="pm-issue-description" label="Description" value={form.description} onChange={(value) => set("description", value)} /></div>
          {sprintable && <TaskChoice id="pm-issue-sprint" label="Sprint" value={form.sprint_id}
            items={[{ value: NONE, label: "Backlog" }, ...sprintChoices.map((s) => ({ value: s.id, label: s.name }))]} onChange={(value) => set("sprint_id", value)} />}
          <TaskChoice id="pm-issue-status" label="Status" value={form.workflow_state} items={config.states.filter((item) => {
            const original = config.states.find((state) => state.key === (issue?.workflow_state ?? issue?.status));
            return !issue || !original?.allowed_next || item.key === original.key || original.allowed_next.includes(item.key);
          }).map((item) => ({ value: item.key, label: item.name }))} onChange={(value) => set("workflow_state", value)} />
          <TaskChoice id="pm-issue-priority" label="Priority" value={form.priority} items={ISSUE_PRIORITIES} onChange={(value) => set("priority", value)} />
          <TaskChoice id="pm-issue-assignee" label="Assignee" value={form.assignee_id} items={[{ value: NONE, label: "Unassigned" }, ...assignable.map((m) => ({ value: m.user_id, label: m.name }))]} onChange={(value) => set("assignee_id", value)} />
          <TaskChoice id="pm-issue-reporter" label="Reporter" value={form.reporter_id} items={[...(form.reporter_id === NONE ? [{ value: NONE, label: "Me" }] : []), ...members.map((m) => ({ value: m.user_id, label: m.name }))]} onChange={(value) => set("reporter_id", value)} />
          <Field>
            <FieldLabel htmlFor="pm-issue-points">Story points</FieldLabel>
            <Input id="pm-issue-points" type="number" min={0} step={0.5} inputMode="decimal" value={form.story_points} onChange={(event) => set("story_points", event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pm-issue-labels">Labels</FieldLabel>
            <Input id="pm-issue-labels" value={form.labels} placeholder="frontend, reporting" onChange={(event) => set("labels", event.target.value)} />
            <FieldDescription>Separate labels with commas.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="pm-issue-start">Start date</FieldLabel>
            <Input id="pm-issue-start" type="date" value={form.start_date} onChange={(event) => set("start_date", event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pm-issue-due">Due date</FieldLabel>
            <Input id="pm-issue-due" type="date" value={form.due_date} onChange={(event) => set("due_date", event.target.value)} />
          </Field>
          {config.components.length > 0 && <TaskChoice id="pm-issue-component" label="Component" value={form.component} items={[{ value: NONE, label: "None" }, ...config.components.map((item) => ({ value: item.key, label: item.name }))]} onChange={(value) => set("component", value)} />}
          {config.fields.map((field) => {
            const id = `pm-custom-${field.key}`;
            const value = customFields[field.key];
            const update = (next: unknown) => setCustomFields((current) => ({ ...current, [field.key]: next }));
            const label = `${field.name}${field.required ? " *" : ""}`;
            return field.kind === "select" ? <TaskChoice key={field.key} id={id} label={label} value={typeof value === "string" ? value : NONE} items={[{ value: NONE, label: "Choose an option" }, ...field.options.map((option) => ({ value: option, label: option }))]} onChange={(next) => update(next === NONE ? null : next)} /> :
              field.kind === "checkbox" ? <Field key={field.key} orientation="horizontal"><Checkbox id={id} checked={value === true} onCheckedChange={(next) => update(Boolean(next))} /><FieldLabel htmlFor={id}>{label}</FieldLabel></Field> :
              <Field key={field.key}><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} required={field.required} type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"} step={field.kind === "number" ? "any" : undefined} maxLength={4000} value={value == null ? "" : String(value)} onChange={(event) => update(event.target.value === "" ? null : field.kind === "number" ? Number(event.target.value) : event.target.value)} /></Field>;
          })}
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
        <Button type="submit" form="pm-issue-form" disabled={state.busy}>
          {state.busy && <Spinner data-icon="inline-start" />}
          {issue ? "Save changes" : "Create"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
