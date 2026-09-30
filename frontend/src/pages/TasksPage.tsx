import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, Search } from "lucide-react";
import { api } from "@/api/client";
import type { BoardTask, ComplianceWork, TaskOptions } from "@/api/tasks";
import { daysUntil, TASK_PRIORITIES, TASK_STATUSES, taskError } from "@/api/tasks";
import type { Task } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFetch } from "@/hooks/useApi";
import { Empty, ErrorState, Loading, PageHead, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { TaskDetail } from "@/components/tasks/TaskDetail";
import { TaskForm } from "@/components/tasks/TaskForm";
import SavedViews from "@/components/SavedViews";

const DEFAULT_FILTERS = { scope: "all", search: "", priority: "all", owner: "all", department: "all", due: "all", source: "all" };
const EMPTY_OPTIONS: TaskOptions = { users: [], departments: [] };
export default function TasksPage() {
  const { user, can } = useAuth();
  const { notify } = useToast();
  const [params, setParams] = useSearchParams();
  const ordinary = useFetch<Task[]>("/api/tasks");
  const compliance = useFetch<ComplianceWork>(can("sharepoint_intelligence") ? "/api/tasks/compliance" : null);
  const options = useFetch<TaskOptions>("/api/tasks/options");
  const isMobile = useIsMobile();
  const [showFilters, setShowFilters] = useState(false);
  const oversight = Boolean(user?.is_admin || user?.role === "manager");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [grouping, setGrouping] = useState(oversight ? "member" : "status");
  const [action, setAction] = useState<{ busy: string | null; error: string }>({ busy: null, error: "" });
  const [deleting, setDeleting] = useState<BoardTask | null>(null);
  const [adding, setAdding] = useState(() => params.has("new"));
  const data = useMemo<BoardTask[]>(() => [...(ordinary.data ?? []), ...(compliance.data?.tasks ?? [])], [ordinary.data, compliance.data]);
  const allOptions = options.data ?? EMPTY_OPTIONS;
  const teamPeople = allOptions.users.filter((person) => person.in_team || data.some((task) => task.assignee_id === person.id));
  const visible = useMemo(() => data.filter((task) => {
    const days = daysUntil(task.due_date);
    return (filters.scope !== "mine" || task.assignee_id === user?.id) &&
      (filters.priority === "all" || task.priority === filters.priority) &&
      (filters.owner === "all" || (filters.owner === "unassigned" ? !task.assignee_id : task.assignee_id === filters.owner)) &&
      (filters.department === "all" || task.assignee_department_id === filters.department) &&
      (filters.source === "all" || (task.source === "compliance" ? "compliance" : "ordinary") === filters.source) &&
      (filters.due === "all" || task.status !== "done" && days !== null && (filters.due === "overdue" ? days < 0 : days >= 0 && days <= 7)) &&
      (!filters.search.trim() || [task.title, task.description, task.assignee_name, task.document_name].some((text) => text?.toLowerCase().includes(filters.search.trim().toLowerCase())));
  }).sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.title.localeCompare(b.title)), [data, filters, user?.id]);
  const groups = grouping === "status" ? TASK_STATUSES.map((state) => ({ key: state.value, label: state.label, tasks: visible.filter((task) => task.status === state.value) })) :
    [...new Map(visible.map((task) => [task.assignee_id ?? task.owner_department_id ?? "unassigned", task.assignee_name || "Unassigned"])).entries()].map(([key, label]) => ({
      key, label, tasks: visible.filter((task) => (task.assignee_id ?? task.owner_department_id ?? "unassigned") === key),
    }));
  const selected = data.find((task) => task.id === params.get("task"));
  const qs = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== "all" && value !== "")).toString();
  function setFilter(key: keyof typeof filters, value: string) { setFilters((current) => ({ ...current, [key]: value })); }
  function reload() { ordinary.reload(); compliance.reload(); }
  function close() { const next = new URLSearchParams(params); next.delete("task"); next.delete("new"); setParams(next, { replace: true }); setAdding(false); }
  async function changeStatus(task: BoardTask, state: string) {
    if (state === task.status) return;
    setAction({ busy: task.id, error: "" });
    try {
      if (task.source === "compliance") {
        if (state === "done" || task.status === "done") await api(`/api/sharepoint/compliance/tasks/${task.id}`, { method: "PATCH", body: { status: state === "done" ? "completed" : "active" } });
        if (state !== "done") await api(`/api/sharepoint/compliance/tasks/${task.id}/progress`, { method: "PATCH", body: { status: state } });
      } else await api(`/api/tasks/${task.id}`, { method: "PATCH", body: { status: state } });
      reload(); setAction({ busy: null, error: "" }); notify(state === "done" ? "Task completed." : "Task status updated.");
    } catch (cause) { reload(); const error = taskError(cause); setAction({ busy: null, error }); throw cause; }
  }
  async function remove() {
    if (!deleting) return;
    setAction({ busy: deleting.id, error: "" });
    try { await api(`/api/tasks/${deleting.id}`, { method: "DELETE" }); setDeleting(null); reload(); setAction({ busy: null, error: "" }); notify("Task deleted."); }
    catch (cause) { setAction({ busy: null, error: taskError(cause) }); }
  }
  const metrics = [
    { label: "Open tasks", count: data.filter((task) => task.status !== "done").length },
    { label: "Overdue", count: data.filter((task) => task.status !== "done" && (daysUntil(task.due_date) ?? 1) < 0).length },
    { label: "Due in 7 days", count: data.filter((task) => { const days = daysUntil(task.due_date); return task.status !== "done" && days !== null && days >= 0 && days <= 7; }).length },
    { label: "Completed", count: data.filter((task) => task.status === "done").length },
  ];
  return <div className="flex flex-col gap-5">
    <PageHead headingLevel={1} title="Tasks" subtitle={oversight ? "See your team's work, assign responsibility, and follow each deadline." : "Your assigned work and document actions, together in one place."} action={<div className="flex gap-2"><Button variant="outline" onClick={reload} aria-label="Refresh tasks"><RefreshCw /></Button><Button onClick={() => setAdding(true)} disabled={options.loading || Boolean(options.error)}><Plus data-icon="inline-start" />New task</Button></div>} />
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{metrics.map((metric) => <Card key={metric.label} size="sm"><CardHeader><CardTitle className="text-sm font-normal text-muted-foreground">{metric.label}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{ordinary.loading ? "…" : metric.count}</CardContent></Card>)}</div>
    {action.error && !deleting && <Alert variant="destructive" role="alert"><AlertDescription>{action.error}</AlertDescription></Alert>}
    {ordinary.error && <ErrorState message={ordinary.error} onRetry={ordinary.reload} />}
    {options.error && <ErrorState message={options.error} onRetry={options.reload} />}
    {(compliance.error || compliance.data?.message) && <Alert role="alert"><AlertDescription>Document tasks: {compliance.error ? taskError(new Error(compliance.error)) : compliance.data?.message} <Button variant="link" nativeButton={false} render={<Link to="/sharepoint/compliance" />} className="h-auto p-0">Open Compliance</Button></AlertDescription></Alert>}
    <Card><CardHeader><CardTitle className="text-base">Find work</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Field className="w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-md"><FieldLabel htmlFor="task-search">Search tasks</FieldLabel><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="task-search" className="pl-9" placeholder="Title, owner, or document…" value={filters.search} onChange={(event) => setFilter("search", event.target.value)} /></div></Field>
        <ToggleGroup value={[grouping]} onValueChange={(values) => values[0] && setGrouping(values[0])} aria-label="Group tasks"><ToggleGroupItem value="status">By status</ToggleGroupItem><ToggleGroupItem value="member">By member</ToggleGroupItem></ToggleGroup>
      </div>
      <Collapsible open={!isMobile || showFilters} onOpenChange={setShowFilters}>
        <CollapsibleTrigger render={<Button variant="outline" className="md:hidden" />}>{showFilters ? "Hide filters" : "Show filters"}</CollapsibleTrigger>
        <CollapsibleContent className="pt-3 md:pt-0"><FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TaskChoice id="task-filter-scope" label="View" value={filters.scope} items={[{ value: "all", label: user?.is_admin ? "All tasks" : oversight ? "Team tasks" : "My work" }, { value: "mine", label: "Assigned to me" }]} onChange={(value) => setFilter("scope", value)} />
        <TaskChoice id="task-filter-owner" label="Member" value={filters.owner} items={[{ value: "all", label: "All members" }, { value: "unassigned", label: "Needs assignment" }, ...teamPeople.map((person) => ({ value: person.id, label: person.name }))]} onChange={(value) => setFilter("owner", value)} />
        <TaskChoice id="task-filter-due" label="Deadline" value={filters.due} items={[{ value: "all", label: "Any date" }, { value: "overdue", label: "Overdue" }, { value: "week", label: "Next 7 days" }]} onChange={(value) => setFilter("due", value)} />
        <TaskChoice id="task-filter-source" label="Task source" value={filters.source} items={[{ value: "all", label: "All work" }, { value: "ordinary", label: "Assigned tasks" }, { value: "compliance", label: "Document compliance" }]} onChange={(value) => setFilter("source", value)} />
        <TaskChoice id="task-filter-department" label="Department" value={filters.department} items={[{ value: "all", label: "All accessible departments" }, ...allOptions.departments.map((dept) => ({ value: dept.id, label: dept.name }))]} onChange={(value) => setFilter("department", value)} />
        <TaskChoice id="task-filter-priority" label="Priority" value={filters.priority} items={[{ value: "all", label: "All priorities" }, ...TASK_PRIORITIES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))]} onChange={(value) => setFilter("priority", value)} />
      </FieldGroup></CollapsibleContent></Collapsible>
      <div className="flex flex-wrap items-center justify-between gap-2"><SavedViews surface="tasks" currentParams={qs} onApply={(value) => { const saved = new URLSearchParams(value); setFilters({ ...DEFAULT_FILTERS, ...Object.fromEntries(saved) }); }} /><Button variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</Button></div>
    </CardContent></Card>
    {((ordinary.loading && !ordinary.data) || (compliance.loading && !compliance.data)) ? <Loading /> :
      visible.length === 0 ? ordinary.error ? null : <Empty message={data.length ? "No tasks match these filters." : "No tasks yet."} hint={data.length ? "Clear the filters to see all accessible work." : "Create a task or assign a document action to get started."} /> :
      <div className={grouping === "status" ? "grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-4" : "grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3"}>
        {groups.map((group) => <section key={group.key} aria-label={`Tasks for ${group.label}`} className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2"><h2 className="break-words font-semibold">{group.label}</h2><Badge variant="secondary">{group.tasks.length}</Badge></div>
          {group.tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks in this status.</p>}
          {group.tasks.map((task) => <TaskCard key={task.id} task={task} busy={action.busy === task.id} onOpen={() => { const next = new URLSearchParams(params); next.set("task", task.id); setParams(next); }} onStatus={(value) => void changeStatus(task, value).catch(() => undefined)} onDelete={() => { setAction({ busy: null, error: "" }); setDeleting(task); }} />)}
        </section>)}
      </div>}
    {params.has("task") && !selected && !ordinary.loading && !compliance.loading && <Alert role="alert"><AlertDescription>This task is no longer available or you do not have access to it.<Button variant="link" onClick={close}>Close task link</Button></AlertDescription></Alert>}
    {selected && <TaskDetail key={selected.id} task={selected} options={allOptions} onClose={close} onReload={reload} onStatus={(state) => changeStatus(selected, state)} />}
    {adding && <TaskForm options={allOptions} defaultDepartment={user?.department_id} onClose={close} onSaved={() => { close(); reload(); notify("Task created."); }} />}
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && !action.busy && setDeleting(null)}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Delete task?</AlertDialogTitle><AlertDialogDescription>This removes “{deleting?.title}” and its checklist and comments.</AlertDialogDescription></AlertDialogHeader>
      {action.error && <Alert variant="destructive" role="alert"><AlertDescription>{action.error}</AlertDescription></Alert>}
      <AlertDialogFooter><Button variant="outline" onClick={() => setDeleting(null)} disabled={Boolean(action.busy)}>Cancel</Button><Button variant="destructive" onClick={() => void remove()} disabled={Boolean(action.busy)}>{action.busy ? "Deleting…" : "Delete task"}</Button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>;
}
