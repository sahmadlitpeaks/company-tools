import { useId } from "react";
import { type PmIssue, type PmMember, type PmSprint, type PmProject, ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES } from "@/api/pm";
import { type ViewFilters } from "@/api/pm-workspace";
import { FilterSelect } from "@/components/ListControls";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "./WorkspaceContext";

export function WorkspaceFilters({ filters, members, issues = [], sprints = [], projects = [], global = false, onChange, searchLabel = "Search issues" }: {
  filters: ViewFilters; members: PmMember[]; issues?: PmIssue[]; sprints?: PmSprint[]; projects?: PmProject[];
  onChange: (next: ViewFilters) => void; searchLabel?: string; global?: boolean;
}) {
  const config = useWorkspace();
  const prefix = useId();
  const set = (key: keyof ViewFilters, value: string) => onChange({ ...filters, [key]: value });
  const all = { value: "", label: "Any" };
  const epics = issues.filter((issue) => issue.issue_type === "epic");
  return <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <Field className="sm:col-span-2"><FieldLabel htmlFor={`${prefix}-search`}>{searchLabel}</FieldLabel>
      <Input id={`${prefix}-search`} value={filters.q} onChange={(event) => set("q", event.target.value)} placeholder="Summary or issue key" /></Field>
    {projects.length > 0 && <FilterSelect id={`${prefix}-project`} label="Project scope" value={filters.project_ids[0] ?? ""} options={[{ value: "", label: "All accessible projects" }, ...projects.map((project) => ({ value: project.id, label: `${project.key} · ${project.name}` }))]} onChange={(value) => onChange({ ...filters, project_ids: value ? [value] : [] })} />}
    <FilterSelect id={`${prefix}-type`} label="Type" value={filters.issue_type} options={[all, ...ISSUE_TYPES]} onChange={(value) => set("issue_type", value)} />
    {global ? <FilterSelect id={`${prefix}-status`} label="Reporting status" value={filters.status} options={[all, ...ISSUE_STATUSES]} onChange={(value) => set("status", value)} /> : <FilterSelect id={`${prefix}-state`} label="Workflow state" value={filters.workflow_state} options={[all, ...config.states.map((state) => ({ value: state.key, label: state.name }))]} onChange={(value) => set("workflow_state", value)} />}
    <FilterSelect id={`${prefix}-priority`} label="Priority" value={filters.priority} options={[all, ...ISSUE_PRIORITIES]} onChange={(value) => set("priority", value)} />
    <FilterSelect id={`${prefix}-person`} label="Assignee" value={filters.assignee} options={[all, { value: "me", label: "Assigned to me" }, { value: "none", label: "Unassigned" }, ...members.filter((person) => person.role !== "viewer").map((person) => ({ value: person.user_id, label: person.name }))]} onChange={(value) => set("assignee", value)} />
    {epics.length > 0 && <FilterSelect id={`${prefix}-epic`} label="Epic" value={filters.parent_id} options={[all, ...epics.map((epic) => ({ value: epic.id, label: `${epic.key} · ${epic.summary}` }))]} onChange={(value) => set("parent_id", value)} />}
    {sprints.length > 0 && <FilterSelect id={`${prefix}-sprint`} label="Sprint" value={filters.sprint} options={[all, { value: "backlog", label: "Backlog" }, ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))]} onChange={(value) => set("sprint", value)} />}
    <Field><FieldLabel htmlFor={`${prefix}-label`}>Label</FieldLabel><Input id={`${prefix}-label`} value={filters.label} onChange={(event) => set("label", event.target.value)} placeholder="Exact label" /></Field>
    {config.components.length > 0 && <FilterSelect id={`${prefix}-component`} label="Component" value={filters.component} options={[all, ...config.components.map((item) => ({ value: item.key, label: item.name }))]} onChange={(value) => set("component", value)} />}
    <Field><FieldLabel htmlFor={`${prefix}-after`}>Due from</FieldLabel><Input id={`${prefix}-after`} type="date" value={filters.due_after} max={filters.due_before || undefined} onChange={(event) => set("due_after", event.target.value)} /></Field>
    <Field><FieldLabel htmlFor={`${prefix}-before`}>Due through</FieldLabel><Input id={`${prefix}-before`} type="date" value={filters.due_before} min={filters.due_after || undefined} onChange={(event) => set("due_before", event.target.value)} /></Field>
  </FieldGroup>;
}
