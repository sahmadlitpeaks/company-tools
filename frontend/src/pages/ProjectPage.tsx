import { useMemo, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, Plus, Search } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import {
  canEdit, ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, issueLink, labelOf, pmError,
  type PmIssue, type PmMember, type PmProject,
} from "@/api/pm";
import { dateLabel } from "@/api/tasks";
import { IssueTypeIcon, pointsLabel, StatusBadge } from "@/components/pm/IssueBits";
import { IssueDetail } from "@/components/pm/IssueDetail";
import { IssueForm } from "@/components/pm/IssueForm";
import { ProjectMembers } from "@/components/pm/ProjectMembers";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { Empty, ErrorState, Loading, PageHead, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFetch } from "@/hooks/useApi";

const FILTERS = { q: "", type: "all", status: "all", assignee: "all" };

export default function ProjectPage() {
  const { projectKey = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useFetch<PmProject>(`/api/pm/projects/${encodeURIComponent(projectKey)}`, true);
  const projectId = project.data?.id;
  const members = useFetch<PmMember[]>(projectId ? `/api/pm/projects/${projectId}/members` : null);
  const issues = useFetch<PmIssue[]>(projectId ? `/api/pm/projects/${projectId}/issues` : null);
  const [creating, setCreating] = useState(false);
  const openKey = params.get("issue");

  function closeIssue() {
    const next = new URLSearchParams(params);
    next.delete("issue");
    setParams(next, { replace: true });
  }
  function changed() {
    void issues.refresh();
    void project.refresh();
  }

  if (project.error) return <div className="flex flex-col gap-4">
    <PageHead headingLevel={1} title="Project" />
    <ErrorState message={project.error} onRetry={project.reload} />
    <Button variant="outline" className="self-start" nativeButton={false} render={<Link to="/projects" />}>Back to projects</Button>
  </div>;
  if (!project.data) return <Loading />;
  const current = project.data;
  const editable = canEdit(current.my_role) && current.status === "active";

  return <div className="flex flex-col gap-5">
    <PageHead
      headingLevel={1}
      title={current.name}
      subtitle={`${current.key} · Lead: ${current.lead_name ?? "Not set"}${current.target_date ? ` · Target ${dateLabel(current.target_date)}` : ""}`}
      action={editable ? <Button onClick={() => setCreating(true)} disabled={!members.data || !issues.data}><Plus data-icon="inline-start" />Create issue</Button> : undefined}
    />
    {current.status === "archived" && <Alert><AlertDescription>This project is archived. Its issues are read-only.</AlertDescription></Alert>}
    <Tabs defaultValue="issues">
      <TabsList>
        <TabsTrigger value="issues">Issues</TabsTrigger>
        <TabsTrigger value="people">People</TabsTrigger>
        {current.my_role === "admin" && <TabsTrigger value="settings">Settings</TabsTrigger>}
      </TabsList>
      <TabsContent value="issues" className="pt-4">
        {issues.error ? <ErrorState message={issues.error} onRetry={issues.reload} /> :
          !issues.data ? <Loading /> : <IssueList project={current} issues={issues.data} members={members.data ?? []} />}
      </TabsContent>
      <TabsContent value="people" className="pt-4">
        {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> :
          !members.data ? <Loading /> : <ProjectMembers project={current} members={members.data} onChanged={() => { void members.refresh(); void project.refresh(); }} />}
      </TabsContent>
      {current.my_role === "admin" && <TabsContent value="settings" className="pt-4">
        <ProjectSettings project={current} members={members.data ?? []} onSaved={(saved) => project.setData(saved)} />
      </TabsContent>}
    </Tabs>
    {creating && members.data && issues.data && <IssueForm
      project={current} members={members.data} issues={issues.data}
      onClose={() => setCreating(false)}
      onSaved={(saved) => { setCreating(false); changed(); setParams((p) => { const next = new URLSearchParams(p); next.set("issue", saved.key); return next; }); }}
    />}
    {openKey && members.data && issues.data && <IssueDetail
      key={openKey} issueKey={openKey} project={current} members={members.data} issues={issues.data}
      onClose={closeIssue} onChanged={changed}
    />}
  </div>;
}

function IssueList({ project, issues, members }: { project: PmProject; issues: PmIssue[]; members: PmMember[] }) {
  const isMobile = useIsMobile();
  const [filters, setFilters] = useState(FILTERS);
  const [grouping, setGrouping] = useState<"epic" | "list">("epic");
  const set = (key: keyof typeof FILTERS, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const filtered = Object.entries(filters).some(([key, value]) => FILTERS[key as keyof typeof FILTERS] !== value);
  const epics = issues.filter((issue) => issue.issue_type === "epic");

  const visible = useMemo(() => {
    const needle = filters.q.trim().toLowerCase();
    return issues.filter((issue) =>
      // Like a Jira backlog, sub-tasks stay inside their parent unless asked for.
      (filters.type === "all" ? issue.issue_type !== "subtask" && (grouping === "list" || issue.issue_type !== "epic") : issue.issue_type === filters.type) &&
      (filters.status === "all" || issue.status === filters.status) &&
      (filters.assignee === "all" || (filters.assignee === "none" ? !issue.assignee_id : issue.assignee_id === filters.assignee)) &&
      (!needle || issue.summary.toLowerCase().includes(needle) || issue.key.toLowerCase() === needle || (issue.labels ?? []).some((label) => label.toLowerCase() === needle)));
  }, [issues, filters, grouping]);

  const groups = grouping === "list" || filters.type === "epic" || filters.type === "subtask"
    ? [{ id: "all", epic: null as PmIssue | null, items: visible }]
    : [
      ...epics.map((epic) => ({ id: epic.id, epic, items: visible.filter((issue) => issue.parent_id === epic.id) })),
      { id: "none", epic: null as PmIssue | null, items: visible.filter((issue) => !issue.parent_id || !epics.some((epic) => epic.id === issue.parent_id)) },
    ].filter((group) => group.items.length > 0 || (group.epic && !filtered));

  return <div className="flex flex-col gap-4">
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field className="w-full min-w-0 sm:max-w-sm sm:flex-1">
            <FieldLabel htmlFor="pm-search">Search issues</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="pm-search" className="pl-9" placeholder={`Summary, label or ${project.key}-1`} value={filters.q} onChange={(event) => set("q", event.target.value)} />
            </div>
          </Field>
          <ToggleGroup value={[grouping]} onValueChange={(values) => values[0] && setGrouping(values[0] as typeof grouping)} aria-label="Group issues">
            <ToggleGroupItem value="epic">By epic</ToggleGroupItem>
            <ToggleGroupItem value="list">List</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <FieldGroup className="grid gap-3 sm:grid-cols-3">
          <TaskChoice id="pm-filter-type" label="Type" value={filters.type} items={[{ value: "all", label: "All issues" }, ...ISSUE_TYPES]} onChange={(value) => set("type", value)} />
          <TaskChoice id="pm-filter-status" label="Status" value={filters.status} items={[{ value: "all", label: "Any status" }, ...ISSUE_STATUSES]} onChange={(value) => set("status", value)} />
          <TaskChoice id="pm-filter-assignee" label="Assignee" value={filters.assignee}
            items={[{ value: "all", label: "Anyone" }, { value: "none", label: "Unassigned" }, ...members.filter((m) => m.role !== "viewer").map((m) => ({ value: m.user_id, label: m.name }))]}
            onChange={(value) => set("assignee", value)} />
        </FieldGroup>
        {filtered && <Button variant="ghost" className="self-start" onClick={() => setFilters(FILTERS)}>Clear filters</Button>}
      </CardContent>
    </Card>
    {issues.length === 0 ? <Empty message="No issues yet" hint={canEdit(project.my_role) ? "Create an epic for each requirement, then add its stories and tasks." : "Issues appear here once the team adds them."} /> :
      groups.every((group) => group.items.length === 0) ? <Empty message="No issues match these filters" hint="Clear the filters to see every issue." /> :
      groups.map((group) => <section key={group.id} className="flex flex-col gap-2" aria-label={group.epic ? `Epic ${group.epic.key}` : "Issues"}>
        {grouping === "epic" && group.id !== "all" && <EpicHeader project={project} epic={group.epic} count={group.items.length} />}
        {group.items.length === 0 ? <p className="text-sm text-muted-foreground">No issues in this epic yet.</p> :
          isMobile ? <IssueCards project={project} issues={group.items} /> : <IssueTable project={project} issues={group.items} />}
      </section>)}
  </div>;
}

function EpicHeader({ project, epic, count }: { project: PmProject; epic: PmIssue | null; count: number }) {
  if (!epic) return <h2 className="border-b border-border pb-2 font-semibold">Issues without an epic <Badge variant="secondary">{count}</Badge></h2>;
  const percent = epic.child_count ? Math.round(epic.child_done / epic.child_count * 100) : 0;
  return <div className="flex flex-col gap-2 border-b border-border pb-2 sm:flex-row sm:items-center">
    <h2 className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
      <IssueTypeIcon type="epic" />
      <Link to={issueLink(project.key, epic.key)} className="shrink-0 text-muted-foreground underline-offset-4 hover:underline">{epic.key}</Link>
      <span className="truncate">{epic.summary}</span>
      <StatusBadge status={epic.status} />
    </h2>
    <div className="flex items-center gap-2 text-xs text-muted-foreground sm:w-56">
      <Progress value={percent} className="flex-1" aria-label={`${epic.key} progress`} />
      <span className="shrink-0">{epic.child_done}/{epic.child_count} done</span>
    </div>
  </div>;
}

function IssueTable({ project, issues }: { project: PmProject; issues: PmIssue[] }) {
  return <TableSurface>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Key</TableHead>
          <TableHead>Summary</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-40">Assignee</TableHead>
          <TableHead className="w-24">Priority</TableHead>
          <TableHead className="w-16 text-right">Points</TableHead>
          <TableHead className="w-28">Due</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((issue) => <TableRow key={issue.id}>
          <TableCell><span className="flex items-center gap-2"><IssueTypeIcon type={issue.issue_type} /><Link to={issueLink(project.key, issue.key)} className="underline-offset-4 hover:underline">{issue.key}</Link></span></TableCell>
          <TableCell className="max-w-0">
            <Link to={issueLink(project.key, issue.key)} className="block truncate font-medium underline-offset-4 hover:underline">{issue.summary}</Link>
            {(issue.child_count > 0 || issue.labels?.length) ? <span className="flex flex-wrap gap-1 pt-1 text-xs text-muted-foreground">
              {issue.child_count > 0 && <span>{issue.child_done}/{issue.child_count} sub-tasks</span>}
              {issue.labels?.map((label) => <Badge key={label} variant="outline">{label}</Badge>)}
            </span> : null}
          </TableCell>
          <TableCell><StatusBadge status={issue.status} /></TableCell>
          <TableCell className="truncate">{issue.assignee_name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
          <TableCell>{labelOf(ISSUE_PRIORITIES, issue.priority)}</TableCell>
          <TableCell className="text-right">{pointsLabel(issue.story_points)}</TableCell>
          <TableCell>{issue.due_date ? dateLabel(issue.due_date) : "–"}</TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
  </TableSurface>;
}

function IssueCards({ project, issues }: { project: PmProject; issues: PmIssue[] }) {
  return <ul className="flex flex-col gap-2">
    {issues.map((issue) => <li key={issue.id}>
      <Card size="sm">
        <CardContent className="flex flex-col gap-2 pt-3">
          <div className="flex items-center gap-2 text-sm">
            <IssueTypeIcon type={issue.issue_type} />
            <span className="text-muted-foreground">{issue.key}</span>
            <span className="ml-auto"><StatusBadge status={issue.status} /></span>
          </div>
          <Link to={issueLink(project.key, issue.key)} className="break-words font-medium underline-offset-4 hover:underline">{issue.summary}</Link>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{issue.assignee_name ?? "Unassigned"}</span>
            <span>{labelOf(ISSUE_PRIORITIES, issue.priority)}</span>
            {issue.story_points !== null && <span>{pointsLabel(issue.story_points)} pts</span>}
            {issue.due_date && <span>Due {dateLabel(issue.due_date)}</span>}
          </div>
        </CardContent>
      </Card>
    </li>)}
  </ul>;
}

function ProjectSettings({ project, members, onSaved }: { project: PmProject; members: PmMember[]; onSaved: (project: PmProject) => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    name: project.name, description: project.description ?? "", lead: project.lead_id ?? "",
    start: project.start_date ?? "", target: project.target_date ?? "",
  });
  const [state, setState] = useState({ busy: false, error: "" });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function save(body: Record<string, unknown>, message: string) {
    setState({ busy: true, error: "" });
    try { onSaved(await api<PmProject>(`/api/pm/projects/${project.id}`, { method: "PATCH", body })); setState({ busy: false, error: "" }); notify(message); }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save({
      name: form.name.trim(), description: form.description.trim() || null,
      ...(form.lead ? { lead_id: form.lead } : {}), start_date: form.start || null, target_date: form.target || null,
    }, "Project saved.");
  }
  const archived = project.status === "archived";
  return <div className="flex flex-col gap-4">
    {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
    <Card>
      <CardHeader><CardTitle>Details</CardTitle><CardDescription>The key {project.key} is permanent so issue links keep working.</CardDescription></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2"><FieldLabel htmlFor="pm-settings-name">Name</FieldLabel><Input id="pm-settings-name" value={form.name} required maxLength={255} onChange={(event) => set("name", event.target.value)} /></Field>
            <Field className="sm:col-span-2"><FieldLabel htmlFor="pm-settings-description">Description</FieldLabel><Textarea id="pm-settings-description" rows={3} value={form.description} onChange={(event) => set("description", event.target.value)} /></Field>
            <div className="sm:col-span-2"><TaskChoice id="pm-settings-lead" label="Project lead" value={form.lead} items={members.map((m) => ({ value: m.user_id, label: m.name }))} onChange={(value) => set("lead", value)} /></div>
            <Field><FieldLabel htmlFor="pm-settings-start">Start date</FieldLabel><Input id="pm-settings-start" type="date" value={form.start} onChange={(event) => set("start", event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="pm-settings-target">Target date</FieldLabel><Input id="pm-settings-target" type="date" value={form.target} onChange={(event) => set("target", event.target.value)} /></Field>
          </FieldGroup>
          <Button type="submit" className="self-start" disabled={state.busy}>Save project</Button>
        </form>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>{archived ? "Restore project" : "Archive project"}</CardTitle><CardDescription>{archived ? "Make the project editable again." : "Archived projects stay readable but nobody can change their issues."}</CardDescription></CardHeader>
      <CardContent>
        <Button variant="outline" disabled={state.busy} onClick={() => void save({ status: archived ? "active" : "archived" }, archived ? "Project restored." : "Project archived.")}>
          {archived ? <ArchiveRestore data-icon="inline-start" /> : <Archive data-icon="inline-start" />}{archived ? "Restore project" : "Archive project"}
        </Button>
      </CardContent>
    </Card>
  </div>;
}
