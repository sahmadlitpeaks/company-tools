import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import {
  canEdit, pmError,
  type PmIssue, type PmLinkRow, type PmMember, type PmProject, type PmSprint,
} from "@/api/pm";
import { dateLabel } from "@/api/tasks";
import { Backlog } from "@/components/pm/Backlog";
import { IssueDetail } from "@/components/pm/IssueDetail";
import { IssueForm } from "@/components/pm/IssueForm";
import { JiraImport } from "@/components/pm/JiraImport";
import { ShareLinks } from "@/components/pm/ShareLinks";
import { ProjectMembers } from "@/components/pm/ProjectMembers";
import { Reports } from "@/components/pm/Reports";
import { Timeline } from "@/components/pm/Timeline";
import { CompleteSprintDialog, SprintDialog, StartSprintDialog } from "@/components/pm/SprintDialogs";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ErrorState, Loading, PageHead, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useFetch } from "@/hooks/useApi";
import { DEFAULT_CONFIG, type WorkspaceConfig } from "@/api/pm-workspace";
import { WorkspaceContext } from "@/components/pm/WorkspaceContext";
import { BoardWorkspace } from "@/components/pm/BoardWorkspace";
import { WorkspaceSettings } from "@/components/pm/WorkspaceSettings";
import { IssueExplorer } from "@/components/pm/IssueExplorer";
import { FilterSelect } from "@/components/ListControls";


type SprintAction = { kind: "create" | "edit" | "start" | "complete" | "delete"; sprint?: PmSprint };

export default function ProjectPage() {
  const { projectKey = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { notify } = useToast();
  const project = useFetch<PmProject>(`/api/pm/projects/${encodeURIComponent(projectKey)}`, true);
  const projectId = project.data?.id;
  const workspace = useFetch<WorkspaceConfig>(projectId ? `/api/pm/projects/${projectId}/configuration` : null);
  const usesSprints = Boolean(project.data?.sprints_enabled);
  const members = useFetch<PmMember[]>(projectId ? `/api/pm/projects/${projectId}/members` : null);
  const issues = useFetch<PmIssue[]>(projectId ? `/api/pm/projects/${projectId}/issues` : null);
  const sprints = useFetch<PmSprint[]>(projectId && usesSprints ? `/api/pm/projects/${projectId}/sprints` : null);
  const [creating, setCreating] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<{ workflow_state?: string; sprint_id?: string }>({});
  const [sprintAction, setSprintAction] = useState<SprintAction | null>(null);
  const [mutation, setMutation] = useState<{ busy: string | null; error: string }>({ busy: null, error: "" });
  const openKey = params.get("issue");

  function closeIssue() {
    const next = new URLSearchParams(params);
    next.delete("issue");
    setParams(next, { replace: true });
  }
  function changed() {
    void issues.refresh();
    void project.refresh();
    void workspace.refresh();
    void members.refresh();
    if (usesSprints) void sprints.refresh();
  }
  /** Save an issue change optimistically; the server's answer replaces the guess. */
  async function patchIssue(issue: PmIssue, body: Partial<PmIssue>, guess: Partial<PmIssue>) {
    setMutation({ busy: issue.id, error: "" });
    issues.setData((list) => list?.map((item) => item.id === issue.id ? { ...item, ...guess } : item) ?? null);
    try {
      const saved = await api<PmIssue>(`/api/pm/issues/${issue.id}`, { method: "PATCH", body });
      issues.setData((list) => list?.map((item) => item.id === saved.id ? saved : item) ?? null);
      setMutation({ busy: null, error: "" });
      if (usesSprints) void sprints.refresh();
    } catch (cause) {
      issues.setData((list) => list?.map((item) => item.id === issue.id ? issue : item) ?? null);
      setMutation({ busy: null, error: `${issue.key}: ${pmError(cause)}` });
    }
  }
  function plan(issue: PmIssue, sprintId: string | null, rank: number) {
    const sprintChanged = sprintId !== issue.sprint_id;
    const sprintName = sprints.data?.find((sprint) => sprint.id === sprintId)?.name ?? null;
    void patchIssue(issue, { rank, ...(sprintChanged ? { sprint_id: sprintId } : {}) }, { rank, sprint_id: sprintId, sprint_name: sprintName });
  }
  function sprintDone(message: string) {
    setSprintAction(null);
    notify(message);
    changed();
  }
  async function deleteSprint(sprint: PmSprint) {
    setMutation({ busy: sprint.id, error: "" });
    try {
      await api(`/api/pm/sprints/${sprint.id}`, { method: "DELETE" });
      setMutation({ busy: null, error: "" });
      sprintDone(`${sprint.name} deleted. Its issues are back in the backlog.`);
    } catch (cause) {
      setMutation({ busy: null, error: pmError(cause) });
    }
  }

  if (project.error) return <div className="flex flex-col gap-4">
    <PageHead headingLevel={1} title="Project" />
    <ErrorState message={project.error} onRetry={project.reload} />
    <Button variant="outline" className="self-start" nativeButton={false} render={<Link to="/projects" />}>Back to projects</Button>
  </div>;
  if (!project.data) return <Loading />;
  const current = project.data;
  const editable = canEdit(current.my_role) && current.status === "active" && Boolean(workspace.data);
  const manageSprints = current.my_role === "admin" && current.status === "active";
  const openSprints = sprints.data ?? [];
  const activeSprint = openSprints.find((sprint) => sprint.status === "active") ?? null;
  const ready = issues.data && workspace.data && members.data && (!usesSprints || sprints.data);
  const dataError = issues.error || workspace.error || members.error || (usesSprints && sprints.error);
  const tab = params.get("tab") ?? "board";
  function setTab(value: string) {
    setParams((old) => { const next = new URLSearchParams(old); next.set("tab", value); return next; });
  }
  const tabs = [{ value: "board", label: "Boards & views" }, ...(usesSprints ? [{ value: "backlog", label: "Backlog" }] : []),
    { value: "timeline", label: "Timeline" }, { value: "issues", label: "Issues" }, { value: "reports", label: "Reports" },
    { value: "people", label: "People" }, ...(current.my_role === "admin" ? [{ value: "settings", label: "Settings" }] : [])];

  return <WorkspaceContext value={workspace.data ?? DEFAULT_CONFIG}><div className="flex flex-col gap-5">
    <PageHead
      headingLevel={1}
      title={current.name}
      subtitle={`${current.key} · Lead: ${current.lead_name ?? "Not set"}${current.target_date ? ` · Target ${dateLabel(current.target_date)}` : ""}`}
      action={editable ? <Button onClick={() => { setCreateDefaults({}); setCreating(true); }} disabled={!members.data || !issues.data}><Plus data-icon="inline-start" />Create issue</Button> : undefined}
    />
    {current.status === "archived" && <Alert><AlertDescription>This project is archived. Its issues are read-only.</AlertDescription></Alert>}
    {ready && !issues.data!.length && current.status === "active" && <Card>
      <CardHeader><CardTitle>Set up your project</CardTitle><CardDescription>Start with the team and a few issues, then choose the views that suit your work.</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {editable && <Button variant="outline" onClick={() => { setCreateDefaults({}); setCreating(true); }}>Create the first issue</Button>}
        {current.my_role === "admin" && <><Button variant="outline" onClick={() => setTab("people")}>Add the team</Button><Button variant="outline" onClick={() => setTab("settings")}>Configure workflow or import Jira</Button></>}
        {usesSprints && <Button variant="outline" onClick={() => setTab("backlog")}>Plan the first sprint</Button>}
      </CardContent>
    </Card>}
    {mutation.error && <Alert variant="destructive" role="alert"><AlertDescription>{mutation.error}</AlertDescription></Alert>}
    <Tabs value={tabs.some((item) => item.value === tab) ? tab : "board"} onValueChange={setTab}>
      <div className="sm:hidden"><FilterSelect id="pm-project-view" label="Project view" value={tab} options={tabs} onChange={setTab} /></div>
      <TabsList className="hidden h-auto max-w-full flex-wrap justify-start sm:flex">
        <TabsTrigger value="board">Board</TabsTrigger>
        {usesSprints && <TabsTrigger value="backlog">Backlog</TabsTrigger>}
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="issues">Issues</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
        <TabsTrigger value="people">People</TabsTrigger>
        {current.my_role === "admin" && <TabsTrigger value="settings">Settings</TabsTrigger>}
      </TabsList>
      <TabsContent value="board" className="pt-4">
        {dataError ? <ErrorState message={String(dataError)} onRetry={changed} /> : !ready ? <Loading /> :
          <BoardWorkspace project={current} issues={issues.data!} members={members.data ?? []} sprints={openSprints} activeSprint={activeSprint}
            editable={editable} busy={mutation.busy} onPatch={(issue, body, guess) => void patchIssue(issue, body, guess)}
            onCreate={(defaults) => { setCreateDefaults(defaults); setCreating(true); }} onBacklog={() => setTab("backlog")} onChanged={changed}
            onComplete={(sprint) => setSprintAction({ kind: "complete", sprint })} />}
      </TabsContent>
      {usesSprints && <TabsContent value="backlog" className="pt-4">
        {dataError ? <ErrorState message={String(dataError)} onRetry={changed} /> : !ready ? <Loading /> :
          <Backlog project={current} issues={issues.data!} sprints={openSprints} canPlan={editable} canManageSprints={manageSprints} busy={mutation.busy}
            onPlan={plan}
            onCreateSprint={() => setSprintAction({ kind: "create" })}
            onEditSprint={(sprint) => setSprintAction({ kind: "edit", sprint })}
            onDeleteSprint={(sprint) => setSprintAction({ kind: "delete", sprint })}
            onStartSprint={(sprint) => setSprintAction({ kind: "start", sprint })}
            onCompleteSprint={(sprint) => setSprintAction({ kind: "complete", sprint })} />}
      </TabsContent>}
      <TabsContent value="timeline" className="pt-4">
        {issues.error ? <ErrorState message={issues.error} onRetry={issues.reload} /> : !issues.data ? <Loading /> :
          <TimelineTab project={current} issues={issues.data} editable={editable}
            onOpen={(key) => setParams((p) => { const next = new URLSearchParams(p); next.set("issue", key); return next; })}
            onReschedule={(issue, start, due) => void patchIssue(issue, { start_date: start, due_date: due }, { start_date: start, due_date: due })} />}
      </TabsContent>
      <TabsContent value="reports" className="pt-4"><Reports project={current} /></TabsContent>
      <TabsContent value="issues" className="pt-4">
        {dataError ? <ErrorState message={String(dataError)} onRetry={changed} /> :
          !ready ? <Loading /> : <IssueExplorer project={current} issues={issues.data!} members={members.data ?? []} sprints={openSprints} onChanged={changed} onViewSaved={(view) => { setParams((old) => { const next = new URLSearchParams(old); next.set("tab", "board"); next.set("view", view.id); return next; }); }} />}
      </TabsContent>
      <TabsContent value="people" className="pt-4">
        {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> :
          !members.data ? <Loading /> : <ProjectMembers project={current} members={members.data} onChanged={() => { void members.refresh(); void project.refresh(); }} />}
      </TabsContent>
      {current.my_role === "admin" && <TabsContent value="settings" className="pt-4">
        <div className="flex flex-col gap-4">
          <ProjectSettings project={current} members={members.data ?? []} onSaved={(saved) => project.setData(saved)} />
          {workspace.data && <WorkspaceSettings key={current.id + workspace.data.states.map((state) => state.key).join(",")} project={current} members={members.data ?? []} config={workspace.data} onSaved={(config) => { workspace.setData(config); changed(); }} />}
          <ShareLinks project={current} />
          {current.status === "active" && <JiraImport project={current} onImported={() => { changed(); void members.refresh(); }} />}
        </div>
      </TabsContent>}
    </Tabs>
    {creating && members.data && issues.data && <IssueForm
      project={current} members={members.data} issues={issues.data} sprints={openSprints} defaults={createDefaults}
      onClose={() => setCreating(false)}
      onSaved={(saved) => { setCreating(false); changed(); setParams((p) => { const next = new URLSearchParams(p); next.set("issue", saved.key); return next; }); }}
    />}
    {openKey && members.data && issues.data && <IssueDetail
      key={openKey} issueKey={openKey} project={current} members={members.data} issues={issues.data} sprints={openSprints}
      onClose={closeIssue} onChanged={changed}
    />}
    {sprintAction?.kind === "create" && <SprintDialog project={current} onClose={() => setSprintAction(null)} onSaved={(sprint) => sprintDone(`${sprint.name} created.`)} />}
    {sprintAction?.kind === "edit" && sprintAction.sprint && <SprintDialog project={current} sprint={sprintAction.sprint} onClose={() => setSprintAction(null)} onSaved={() => sprintDone("Sprint saved.")} />}
    {sprintAction?.kind === "start" && sprintAction.sprint && <StartSprintDialog sprint={sprintAction.sprint} onClose={() => setSprintAction(null)} onStarted={(sprint) => sprintDone(`${sprint.name} started.`)} />}
    {sprintAction?.kind === "complete" && sprintAction.sprint && <CompleteSprintDialog sprint={sprintAction.sprint} futureSprints={openSprints.filter((sprint) => sprint.status === "future")}
      onClose={() => setSprintAction(null)} onCompleted={(sprint) => sprintDone(`${sprint.name} completed.`)} />}
    <AlertDialog open={sprintAction?.kind === "delete"} onOpenChange={(open) => !open && !mutation.busy && setSprintAction(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {sprintAction?.sprint?.name}?</AlertDialogTitle>
          <AlertDialogDescription>The sprint is removed and its issues go back to the backlog. Nothing else changes.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => setSprintAction(null)} disabled={Boolean(mutation.busy)}>Cancel</Button>
          <Button variant="destructive" disabled={Boolean(mutation.busy)} onClick={() => sprintAction?.sprint && void deleteSprint(sprintAction.sprint)}>Delete sprint</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div></WorkspaceContext>;
}

function TimelineTab({ project, issues, editable, onOpen, onReschedule }: {
  project: PmProject; issues: PmIssue[]; editable: boolean;
  onOpen: (key: string) => void; onReschedule: (issue: PmIssue, start: string, due: string) => void;
}) {
  const links = useFetch<PmLinkRow[]>(`/api/pm/projects/${project.id}/links`);
  const sprints = useFetch<PmSprint[]>(project.sprints_enabled ? `/api/pm/projects/${project.id}/sprints?state=all` : null);
  if (links.error) return <ErrorState message={links.error} onRetry={links.reload} />;
  if (!links.data) return <Loading />;
  return <Timeline issues={issues} links={links.data} sprints={sprints.data ?? []} editable={editable} onOpen={onOpen} onReschedule={onReschedule} />;
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
      <CardHeader><CardTitle>Way of working</CardTitle><CardDescription>Scrum projects plan sprints from a backlog; Kanban projects use the board alone.</CardDescription></CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <Switch id="pm-settings-sprints" checked={project.sprints_enabled} disabled={state.busy || archived}
            onCheckedChange={(checked) => void save({ sprints_enabled: checked }, checked ? "Sprints turned on." : "Sprints turned off.")} />
          <FieldContent>
            <FieldLabel htmlFor="pm-settings-sprints">Use sprints</FieldLabel>
            <FieldDescription>Turning sprints off needs the active sprint to be completed first.</FieldDescription>
          </FieldContent>
        </Field>
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
