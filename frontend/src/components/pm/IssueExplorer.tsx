import { useIssueHref } from "./useIssueHref";
import { useState } from "react";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { Copy, Filter, Save, Settings2, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { canEdit, ISSUE_PRIORITIES, labelOf, pmError, type PmIssue, type PmMember, type PmProject, type PmSprint } from "@/api/pm";
import { EMPTY_FILTERS, defaultSettings, issueParams, type IssuePage, type PmView, type ViewFilters, type ViewSettings } from "@/api/pm-workspace";
import { FilterSelect, ListPagination } from "@/components/ListControls";
import { Empty, ErrorState, Loading } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFetch } from "@/hooks/useApi";
import { IssueCalendar } from "./IssueCalendar";
import { IssueTypeIcon, pointsLabel, StatusBadge } from "./IssueBits";
import { ViewDialog } from "./ViewDialog";
import { useWorkspace } from "./WorkspaceContext";
import { WorkspaceFilters } from "./WorkspaceFilters";

const EMPTY_MEMBERS: PmMember[] = [];
const EMPTY_ISSUES: PmIssue[] = [];
const EMPTY_SPRINTS: PmSprint[] = [];
const EMPTY_PROJECTS: PmProject[] = [];

export function IssueExplorer({ project, members = EMPTY_MEMBERS, issues = EMPTY_ISSUES, sprints = EMPTY_SPRINTS, projects = EMPTY_PROJECTS, view, onChanged, onViewSaved, onViewDeleted }: {
  project?: PmProject; members?: PmMember[]; issues?: PmIssue[]; sprints?: PmSprint[]; projects?: PmProject[];
  view?: PmView; onChanged?: () => void; onViewSaved?: (view: PmView) => void; onViewDeleted?: () => void;
}) {
  const issueHref = useIssueHref();
  const [params, setParams] = useSearchParams();
  const config = useWorkspace();
  const mobile = useIsMobile();
  const initial = view?.settings ?? { ...defaultSettings(Boolean(project?.sprints_enabled)), layout: "table" as const };
  const filters: ViewFilters = { ...EMPTY_FILTERS, ...initial.filters };
  for (const key of Object.keys(EMPTY_FILTERS)) if (key !== "project_ids" && params.has(`f_${key}`)) Object.assign(filters, { [key]: params.get(`f_${key}`) ?? "" });
  if (params.has("f_project")) filters.project_ids = params.get("f_project") ? [params.get("f_project")!] : [];
  const rawLayout = params.get("issue_layout") ?? initial.layout;
  const layout = rawLayout === "calendar" || rawLayout === "list" ? rawLayout : "table";
  const group = params.get("issue_group") ?? (view?.settings.group_by === "none" ? "list" : view?.settings.group_by ?? (project ? "epic" : "list"));
  const order = (params.get("issue_order") ?? initial.order_by) as ViewSettings["order_by"];
  const rawMonth = params.get("month");
  const month = rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) && Number(rawMonth.slice(5)) >= 1 && Number(rawMonth.slice(5)) <= 12 ? new Date(Number(rawMonth.slice(0, 4)), Number(rawMonth.slice(5)) - 1, 1) : startOfMonth(new Date());
  function display(key: string, value: string) {
    setSelected([]); setParams((old) => { const next = new URLSearchParams(old); next.set(key, value); next.delete("offset"); return next; }, { replace: true });
  }
  const [selected, setSelected] = useState<string[]>([]);
  const [quickEdit, setQuickEdit] = useState<PmIssue | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [saving, setSaving] = useState<"save" | "edit" | "copy" | null>(null);
  const [mutation, setMutation] = useState({ busy: "", error: "" });
  const limit = [10, 25, 50, 100].includes(Number(params.get("page_size"))) ? Number(params.get("page_size")) : 50;
  const rawOffset = Number(params.get("offset"));
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const monthFrom = format(month, "yyyy-MM-dd"), monthTo = format(endOfMonth(month), "yyyy-MM-dd");
  const queryFilters = layout === "calendar" ? { ...filters, due_after: filters.due_after > monthFrom ? filters.due_after : monthFrom, due_before: filters.due_before && filters.due_before < monthTo ? filters.due_before : monthTo } : filters;
  const query = issueParams(queryFilters, { ...(project ? { project_id: project.id, include_archived: "true" } : {}),
    order_by: order, limit: String(limit), offset: String(offset) });
  const page = useFetch<IssuePage>(`/api/pm/issues/page?${query}`);
  const rows = page.data?.items ?? [];
  const editable = Boolean(project && canEdit(project.my_role) && project.status === "active");
  const settings: ViewSettings = { ...initial, layout, group_by: group === "list" ? "none" : group as ViewSettings["group_by"], order_by: order, filters };
  function setFilters(next: ViewFilters) {
    setSelected([]);
    setParams((current) => { const copy = new URLSearchParams(current); copy.delete("offset");
      for (const [key, value] of Object.entries(next)) if (key !== "project_ids") copy.set(`f_${key}`, value as string);
      copy.set("f_project", next.project_ids[0] ?? "");
      return copy; }, { replace: true });
  }
  function paginate(value: number, size = limit) {
    setSelected([]); setParams((current) => { const copy = new URLSearchParams(current); copy.set("offset", String(value)); copy.set("page_size", String(size)); return copy; }, { replace: true });
  }
  async function change(issue: PmIssue, changes: Record<string, unknown>) {
    setMutation({ busy: issue.id, error: "" });
    try { await api(`/api/pm/issues/${issue.id}`, { method: "PATCH", body: changes }); void page.refresh(); onChanged?.(); }
    catch (cause) { setMutation({ busy: "", error: pmError(cause) }); return; }
    setMutation({ busy: "", error: "" });
  }
  const epics = issues.filter((issue) => issue.issue_type === "epic");
  const epicGroups = group === "epic" && !filters.issue_type ? [
    ...epics.map((epic) => ({ id: epic.id, epic, items: rows.filter((issue) => issue.parent_id === epic.id || issue.id === epic.id) })),
    { id: "none", epic: null, items: rows.filter((issue) => !epics.some((epic) => epic.id === issue.parent_id || epic.id === issue.id)) },
  ].filter((item) => item.items.length || (item.epic && !Object.values(filters).some((value) => typeof value === "string" && value))) :
    [{ id: "all", epic: null, items: rows }];
  const groupedKey = (issue: PmIssue) => group === "assignee" ? issue.assignee_id ?? "none" : group === "priority" ? issue.priority : issue.parent_id ?? "none";
  const groups = group === "assignee" || group === "priority" || group === "epic" && !project ? [...new Set(rows.map(groupedKey))].map((key) => {
    const sample = rows.find((issue) => groupedKey(issue) === key)!;
    return { id: key, epic: null, label: group === "assignee" ? sample.assignee_name ?? "Unassigned" : group === "priority" ? labelOf(ISSUE_PRIORITIES, sample.priority) : sample.parent?.summary ?? "Without an epic", items: rows.filter((issue) => groupedKey(issue) === key) };
  }) : epicGroups.map((item) => ({ ...item, label: "" }));
  const properties = view?.settings.properties ?? ["assignee", "priority", "points", "due"];
  function toggle(id: string, checked: boolean) {
    setSelected((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)); }
  function issueRow(issue: PmIssue) {
    const href = issueHref(project?.key ?? issue.key.split("-")[0], issue.key);
    return <TableRow key={issue.id}>
      {editable && <TableCell className="w-10"><Checkbox aria-label={`Select ${issue.key}`} checked={selected.includes(issue.id)} onCheckedChange={(checked) => toggle(issue.id, Boolean(checked))} /></TableCell>}
      <TableCell className="w-28"><Link to={href} className="flex items-center gap-2 underline-offset-4 hover:underline"><IssueTypeIcon type={issue.issue_type} />{issue.key}</Link></TableCell>
      <TableCell className="min-w-40"><Link to={href} className="block font-medium underline-offset-4 hover:underline">{issue.summary}</Link>
        {properties.includes("labels") && <span className="flex flex-wrap gap-1 pt-1">{issue.labels?.map((label) => <Badge key={label} variant="outline">{label}</Badge>)}</span>}</TableCell>
      <TableCell>{editable ? <FilterSelect id={`pm-inline-state-${issue.id}`} labelClassName="sr-only" label={`State for ${issue.key}`} value={issue.workflow_state || issue.status} options={config.states.map((state) => ({ value: state.key, label: state.name }))} disabled={Boolean(mutation.busy)} onChange={(value) => void change(issue, { workflow_state: value })} /> : <StatusBadge status={issue.status} label={issue.workflow_name} />}</TableCell>
      {properties.includes("assignee") && <TableCell>{editable ? <FilterSelect id={`pm-inline-person-${issue.id}`} labelClassName="sr-only" label={`Assignee for ${issue.key}`} value={issue.assignee_id ?? ""} options={[{ value: "", label: "Unassigned" }, ...members.filter((member) => member.role !== "viewer").map((member) => ({ value: member.user_id, label: member.name }))]} disabled={Boolean(mutation.busy)} onChange={(value) => void change(issue, { assignee_id: value || null })} /> : issue.assignee_name ?? "Unassigned"}</TableCell>}
      {properties.includes("priority") && <TableCell>{editable ? <FilterSelect id={`pm-inline-priority-${issue.id}`} labelClassName="sr-only" label={`Priority for ${issue.key}`} value={issue.priority} options={ISSUE_PRIORITIES} disabled={Boolean(mutation.busy)} onChange={(value) => void change(issue, { priority: value })} /> : labelOf(ISSUE_PRIORITIES, issue.priority)}</TableCell>}
      {properties.includes("points") && <TableCell className="w-24">{editable ? <Input aria-label={`Points for ${issue.key}`} className="w-20" type="number" min={0} max={1000} step={0.5} defaultValue={issue.story_points ?? ""} key={`${issue.id}-${issue.story_points}`} onBlur={(event) => { const value = event.target.value ? Number(event.target.value) : null; if (value !== issue.story_points) void change(issue, { story_points: value }); }} /> : pointsLabel(issue.story_points)}</TableCell>}
      {properties.includes("due") && <TableCell>{editable ? <Input aria-label={`Due date for ${issue.key}`} type="date" defaultValue={issue.due_date ?? ""} key={`${issue.id}-${issue.due_date}`} onBlur={(event) => { if ((event.target.value || null) !== issue.due_date) void change(issue, { due_date: event.target.value || null }); }} /> : issue.due_date ?? "—"}</TableCell>}
      {properties.includes("component") && <TableCell>{config.components.find((item) => item.key === issue.component)?.name ?? "—"}</TableCell>}
    </TableRow>;
  }
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ToggleGroup value={[layout]} onValueChange={(values) => { if (values[0]) { display("issue_layout", values[0]); } }} aria-label="Issue layout">
        <ToggleGroupItem value="table">Table</ToggleGroupItem><ToggleGroupItem value="list">List</ToggleGroupItem><ToggleGroupItem value="calendar">Calendar</ToggleGroupItem>
      </ToggleGroup>
      <div className="flex flex-wrap gap-2">
        {view?.can_manage && project?.status !== "archived" && <Button variant="outline" onClick={() => setSaving("edit")}><Settings2 data-icon="inline-start" />Configure view</Button>}
        {view && project?.status !== "archived" && <Button variant="outline" onClick={() => setSaving("copy")}><Copy data-icon="inline-start" />Duplicate view</Button>}
        {view?.can_manage && !project && <Button variant="outline" onClick={() => setDeleting(true)}><Trash2 data-icon="inline-start" />Delete view</Button>}
        <Button variant="outline" disabled={project?.status === "archived"} onClick={() => setSaving("save")}><Save data-icon="inline-start" />Save as view</Button>
      </div>
    </div>
    {mobile && <Field><FieldLabel htmlFor="pm-mobile-search">Search issues</FieldLabel><Input id="pm-mobile-search" value={filters.q} placeholder="Summary or issue key" onChange={(event) => setFilters({ ...filters, q: event.target.value })} /></Field>}
    <Collapsible key={mobile ? "mobile-filters" : "desktop-filters"} defaultOpen={!view && !mobile} className="border border-border">
      <CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start" />}><Filter data-icon="inline-start" />Filters and sorting</CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 border-t border-border p-4">
        <WorkspaceFilters filters={filters} members={members} issues={issues} sprints={sprints} projects={projects} global={!project} searchLabel={mobile ? "Search in filters" : "Search issues"} onChange={setFilters} />
        <div className="flex flex-wrap items-end gap-3"><div className="w-48"><FilterSelect id="pm-list-order" label="Sort by" value={order} options={["rank", "updated", "created", "due", "priority"].map((value) => ({ value, label: value === "rank" ? "Manual order" : value[0].toUpperCase() + value.slice(1) }))} onChange={(value) => { display("issue_order", value); }} /></div>
          <ToggleGroup value={[group]} onValueChange={(values) => values[0] && display("issue_group", values[0])} aria-label="Group issues"><ToggleGroupItem value="epic">By epic</ToggleGroupItem><ToggleGroupItem value="list">List</ToggleGroupItem><ToggleGroupItem value="assignee">Assignee</ToggleGroupItem><ToggleGroupItem value="priority">Priority</ToggleGroupItem></ToggleGroup>
          <Button variant="ghost" onClick={() => setFilters({ ...EMPTY_FILTERS })}>Clear filters</Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
    {mutation.error && <Alert variant="destructive" role="alert"><AlertDescription>{mutation.error}</AlertDescription></Alert>}
    {selected.length > 0 && <div className="flex flex-wrap items-center gap-3 border border-border bg-muted/30 p-3"><span className="text-sm font-medium">{selected.length} selected</span><Button variant="outline" onClick={() => setBulk(true)}>Bulk edit</Button><Button variant="ghost" onClick={() => setSelected([])}>Clear selection</Button></div>}
    {page.error ? <ErrorState message={page.error} onRetry={page.reload} /> : !page.data ? <Loading /> : layout === "calendar" ? <IssueCalendar issues={rows} projectKey={project?.key} month={month} onMonth={(next) => { display("month", format(next, "yyyy-MM")); }} /> : !rows.length ? <Empty message="No issues match these filters" hint="Clear the filters or create an issue." /> :
      groups.map((groupRow) => <section key={groupRow.id} className="flex flex-col gap-2" aria-label={groupRow.epic ? `Epic ${groupRow.epic.key}` : groupRow.label || "Issues"}>
        {groupRow.label && <h2 className="border-b border-border pb-2 text-sm font-semibold">{groupRow.label} · {groupRow.items.length}</h2>}
        {project && group === "epic" && groupRow.id !== "all" && <div className="flex flex-wrap items-center gap-2 border border-border bg-muted/30 px-3 py-2 text-sm">{groupRow.epic ? <><IssueTypeIcon type="epic" /><Link to={issueHref(project.key, groupRow.epic.key)} className="font-medium">{groupRow.epic.key} · {groupRow.epic.summary}</Link><span className="text-muted-foreground">{groupRow.epic.child_done}/{groupRow.epic.child_count} done</span></> : <span className="font-medium">Without an epic</span>}</div>}
        {!groupRow.items.length ? <p className="text-sm text-muted-foreground">No issues in this epic yet.</p> : mobile || layout === "list" ?
          <div className="flex flex-col divide-y divide-border border border-border">{groupRow.items.map((issue) => <article key={issue.id} className="flex gap-3 p-3">
            {editable && <Checkbox aria-label={`Select ${issue.key}`} checked={selected.includes(issue.id)} onCheckedChange={(checked) => toggle(issue.id, Boolean(checked))} />}
            <div className="flex min-w-0 flex-1 flex-col gap-2"><Link to={issueHref(project?.key ?? issue.key.split("-")[0], issue.key)} className="break-words font-medium">{issue.summary}</Link><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><IssueTypeIcon type={issue.issue_type} />{issue.key}<StatusBadge status={issue.status} label={issue.workflow_name} /><span>{issue.assignee_name ?? "Unassigned"}</span><span>{issue.due_date}</span></div>{editable && <Button variant="outline" size="sm" className="self-start" aria-label={`Quick edit ${issue.key}`} onClick={() => setQuickEdit(issue)}>Quick edit</Button>}</div>
          </article>)}</div> :
          <TableSurface><Table><TableHeader><TableRow>{editable && <TableHead><Checkbox aria-label="Select this page" checked={groupRow.items.every((issue) => selected.includes(issue.id))} onCheckedChange={(checked) => setSelected(checked ? [...new Set([...selected, ...groupRow.items.map((issue) => issue.id)])] : selected.filter((id) => !groupRow.items.some((issue) => issue.id === id)))} /></TableHead>}<TableHead>Key</TableHead><TableHead>Summary</TableHead><TableHead>State</TableHead>{properties.includes("assignee") && <TableHead>Assignee</TableHead>}{properties.includes("priority") && <TableHead>Priority</TableHead>}{properties.includes("points") && <TableHead>Points</TableHead>}{properties.includes("due") && <TableHead>Due</TableHead>}{properties.includes("component") && <TableHead>Component</TableHead>}</TableRow></TableHeader><TableBody>{groupRow.items.map(issueRow)}</TableBody></Table></TableSurface>}
      </section>)}
    {page.data && <ListPagination id="pm-issues" total={page.data.total} offset={page.data.offset} limit={page.data.limit} loading={page.loading} onPage={paginate} onPageSize={(size) => paginate(0, size)} />}
    {quickEdit && <QuickEditDialog issue={quickEdit} members={members} onClose={() => setQuickEdit(null)} onSaved={() => { setQuickEdit(null); void page.refresh(); onChanged?.(); }} />}
    {bulk && <BulkDialog ids={selected} members={members} sprints={sprints} onClose={() => setBulk(false)} onSaved={() => { setBulk(false); setSelected([]); void page.refresh(); onChanged?.(); }} />}
    {saving && <ViewDialog project={project} view={saving === "save" ? undefined : view} duplicate={saving === "copy"} initial={settings} projects={projects} members={members} issues={issues} sprints={sprints} onClose={() => setSaving(null)} onSaved={(saved) => { setSaving(null); onViewSaved?.(saved); }} />}
    <AlertDialog open={deleting} onOpenChange={(open) => !open && !mutation.busy && setDeleting(false)}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Delete {view?.name}?</AlertDialogTitle><AlertDialogDescription>This removes the saved view. Issues and their history stay in their projects.</AlertDialogDescription></AlertDialogHeader>
      {mutation.error && <Alert variant="destructive" role="alert"><AlertDescription>{mutation.error}</AlertDescription></Alert>}
      <AlertDialogFooter><Button variant="outline" disabled={Boolean(mutation.busy)} onClick={() => setDeleting(false)}>Cancel</Button><Button variant="destructive" disabled={Boolean(mutation.busy)} onClick={() => void (async () => {
        setMutation({ busy: "view", error: "" });
        try { await api(`/api/pm/views/${view!.id}`, { method: "DELETE" }); setDeleting(false); setMutation({ busy: "", error: "" }); onViewDeleted?.(); }
        catch (cause) { setMutation({ busy: "", error: pmError(cause) }); }
      })()}>Delete view</Button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}

function QuickEditDialog({ issue, members, onClose, onSaved }: { issue: PmIssue; members: PmMember[]; onClose: () => void; onSaved: () => void }) {
  const config = useWorkspace();
  const [form, setForm] = useState({ workflow_state: issue.workflow_state ?? issue.status, assignee_id: issue.assignee_id ?? "", priority: issue.priority, story_points: issue.story_points?.toString() ?? "", due_date: issue.due_date ?? "" });
  const [state, setState] = useState({ busy: false, error: "" });
  const original = config.states.find((item) => item.key === (issue.workflow_state ?? issue.status));
  async function save(event: React.FormEvent) {
    event.preventDefault(); setState({ busy: true, error: "" });
    try { await api(`/api/pm/issues/${issue.id}`, { method: "PATCH", body: { ...form, assignee_id: form.assignee_id || null, story_points: form.story_points ? Number(form.story_points) : null, due_date: form.due_date || null } }); onSaved(); }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>Quick edit {issue.key}</DialogTitle><DialogDescription>{issue.summary}</DialogDescription></DialogHeader>
    <form id="pm-quick-edit" onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      <FieldGroup className="grid gap-3 sm:grid-cols-2">
        <FilterSelect id="pm-quick-state" label="Workflow state" value={form.workflow_state} options={config.states.filter((item) => !original?.allowed_next || item.key === original.key || original.allowed_next.includes(item.key)).map((item) => ({ value: item.key, label: item.name }))} onChange={(value) => setForm({ ...form, workflow_state: value })} />
        <FilterSelect id="pm-quick-person" label="Assignee" value={form.assignee_id} options={[{ value: "", label: "Unassigned" }, ...members.filter((member) => member.role !== "viewer").map((member) => ({ value: member.user_id, label: member.name }))]} onChange={(value) => setForm({ ...form, assignee_id: value })} />
        <FilterSelect id="pm-quick-priority" label="Priority" value={form.priority} options={ISSUE_PRIORITIES} onChange={(value) => setForm({ ...form, priority: value as typeof form.priority })} />
        <Field><FieldLabel htmlFor="pm-quick-points">Story points</FieldLabel><Input id="pm-quick-points" type="number" min={0} max={1000} step={0.5} value={form.story_points} onChange={(event) => setForm({ ...form, story_points: event.target.value })} /></Field>
        <Field><FieldLabel htmlFor="pm-quick-due">Due date</FieldLabel><Input id="pm-quick-due" type="date" min={issue.start_date ?? undefined} value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></Field>
      </FieldGroup>
    </form>
    <DialogFooter><Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button><Button type="submit" form="pm-quick-edit" disabled={state.busy}>Save changes</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function BulkDialog({ ids, members, sprints, onClose, onSaved }: { ids: string[]; members: PmMember[]; sprints: PmSprint[]; onClose: () => void; onSaved: () => void }) {
  const config = useWorkspace();
  const [form, setForm] = useState({ field: "workflow_state", value: "todo" });
  const [state, setState] = useState({ busy: false, error: "" });
  const options = form.field === "workflow_state" ? config.states.map((item) => ({ value: item.key, label: item.name })) :
    form.field === "priority" ? ISSUE_PRIORITIES :
    form.field === "assignee_id" ? [{ value: "", label: "Unassigned" }, ...members.filter((item) => item.role !== "viewer").map((item) => ({ value: item.user_id, label: item.name }))] :
    form.field === "component" ? [{ value: "", label: "None" }, ...config.components.map((item) => ({ value: item.key, label: item.name }))] :
    [{ value: "", label: "Backlog" }, ...sprints.map((item) => ({ value: item.id, label: item.name }))];
  async function save() {
    setState({ busy: true, error: "" });
    try { await api("/api/pm/issues/bulk", { method: "POST", body: { issue_ids: ids, changes: { [form.field]: form.field === "story_points" ? (form.value ? Number(form.value) : null) : form.value || null } } }); onSaved(); }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>Update {ids.length} issues</DialogTitle><DialogDescription>Every selected issue is validated before the changes are committed together.</DialogDescription></DialogHeader>
    {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
    <FieldGroup><FilterSelect id="pm-bulk-field" label="Change field" value={form.field} options={[{ value: "workflow_state", label: "Workflow state" }, { value: "priority", label: "Priority" }, { value: "assignee_id", label: "Assignee" }, { value: "story_points", label: "Story points" }, ...(sprints.length ? [{ value: "sprint_id", label: "Sprint" }] : []), ...(config.components.length ? [{ value: "component", label: "Component" }] : [])]} onChange={(value) => setForm({ field: value, value: value === "workflow_state" ? "todo" : value === "priority" ? "medium" : "" })} />
      {form.field === "story_points" ? <Field><FieldLabel htmlFor="pm-bulk-points">Story points</FieldLabel><Input id="pm-bulk-points" type="number" min={0} max={1000} value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></Field> : <FilterSelect id="pm-bulk-value" label="New value" value={form.value} options={options} onChange={(value) => setForm({ ...form, value })} />}</FieldGroup>
    <DialogFooter><Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button><Button onClick={() => void save()} disabled={state.busy}>Apply changes</Button></DialogFooter>
  </DialogContent></Dialog>;
}
