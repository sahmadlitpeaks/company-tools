import { useState, type FormEvent } from "react";
import { Bot, FolderKanban, Plus } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { labelOf, pmError, PROJECT_ROLES, type PmPerson, type PmProject } from "@/api/pm";
import { dateLabel } from "@/api/tasks";
import { useAuth } from "@/auth/AuthContext";
import { HealthBadge, ProjectsTimeline } from "@/components/pm/ProjectsTimeline";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { Empty, ErrorState, Loading, PageHead } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFetch } from "@/hooks/useApi";
import { IssueExplorer } from "@/components/pm/IssueExplorer";
import { FilterSelect } from "@/components/ListControls";
import { type PmView } from "@/api/pm-workspace";

export default function ProjectsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const projects = useFetch<PmProject[]>(`/api/pm/projects?status=${status}`, true);
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  const view = params.get("layout") ?? "cards";
  function setView(value: string) { setParams((old) => { const next = new URLSearchParams(old); next.set("layout", value); return next; }); }
  const views = useFetch<PmView[]>("/api/pm/views");
  const savedView = views.data?.find((item) => item.id === params.get("view"));
  const navigate = useNavigate();

  return <div className="flex flex-col gap-5">
    <PageHead
      headingLevel={1}
      title="Projects"
      subtitle="Epics, stories, tasks and bugs for each project, visible to the people on it."
      action={<div className="flex gap-2">
        <Button variant="outline" nativeButton={false} render={<Link to="/ai-access" />}><Bot data-icon="inline-start" />AI access</Button>
        {user?.is_admin && <Button onClick={() => setCreating(true)}><Plus data-icon="inline-start" />New project</Button>}
      </div>}
    />
    <div className="flex flex-wrap gap-3">
      <ToggleGroup value={[status]} onValueChange={(values) => values[0] && setStatus(values[0] as typeof status)} aria-label="Project status">
        <ToggleGroupItem value="active">Active</ToggleGroupItem>
        <ToggleGroupItem value="archived">Archived</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup value={[view]} onValueChange={(values) => values[0] && setView(values[0] as typeof view)} aria-label="Project view">
        <ToggleGroupItem value="cards">Cards</ToggleGroupItem>
        <ToggleGroupItem value="timeline">Timeline</ToggleGroupItem>
        <ToggleGroupItem value="issues">All issues</ToggleGroupItem>
      </ToggleGroup>
    </div>
    {view === "issues" ? <div className="flex flex-col gap-4">
      {views.error ? <ErrorState message={views.error} onRetry={views.reload} /> : !views.data ? <Loading /> : <>
        <div className="sm:w-72"><FilterSelect id="pm-global-view" label="Saved personal view" value={savedView?.id ?? ""} options={[{ value: "", label: "All accessible issues" }, ...views.data.map((item) => ({ value: item.id, label: item.name }))]} onChange={(id) => setParams((old) => { const next = new URLSearchParams(old); next.set("view", id); for (const key of Array.from(next.keys())) if (key.startsWith("f_") || key.startsWith("issue_") || key === "month") next.delete(key); next.delete("offset"); return next; })} /></div>
        <IssueExplorer key={savedView?.id ?? "all"} view={savedView} projects={projects.data ?? []} onViewDeleted={() => { void views.refresh(); setParams((old) => { const next = new URLSearchParams(old); next.delete("view"); return next; }); }} onViewSaved={(saved) => { void views.refresh(); setParams((old) => { const next = new URLSearchParams(old); next.set("view", saved.id); return next; }); }} />
      </>}
    </div> : projects.error ? <ErrorState message={projects.error} onRetry={projects.reload} /> :
      projects.loading && !projects.data ? <Loading /> :
      !projects.data?.length ? <Empty
        message={status === "archived" ? "No archived projects" : "No projects yet"}
        hint={status === "archived" ? "Archived projects you can see will appear here." : user?.is_admin ? "Create a project and add its team." : "Ask a project administrator to add you to a project."}
      /> :
      view === "timeline" ? <ProjectsTimeline projects={projects.data} /> :
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.data.map((project) => <ProjectCard key={project.id} project={project} />)}
      </div>}
    {creating && <CreateProject onClose={() => setCreating(false)} onCreated={(project) => navigate(`/projects/${project.key}`)} />}
  </div>;
}

function ProjectCard({ project }: { project: PmProject }) {
  const percent = project.issue_count ? Math.round(project.done_count / project.issue_count * 100) : 0;
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <FolderKanban className="size-4 text-muted-foreground" aria-hidden="true" />
        <Link to={`/projects/${project.key}`} className="min-w-0 truncate underline-offset-4 hover:underline">{project.name}</Link>
      </CardTitle>
      <CardDescription>{project.key} · Lead: {project.lead_name ?? "Not set"}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {project.description && <p className="line-clamp-2 text-sm text-muted-foreground">{project.description}</p>}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs text-muted-foreground"><span>{project.done_count} of {project.issue_count} issues done</span><span>{percent}%</span></div>
        <Progress value={percent} aria-label={`${project.name} progress`} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <HealthBadge project={project} />
        {project.my_role && <Badge variant="outline">{labelOf(PROJECT_ROLES, project.my_role)}</Badge>}
        <span>{project.member_count} {project.member_count === 1 ? "person" : "people"}</span>
        {project.target_date && <span>· Target {dateLabel(project.target_date)}</span>}
      </div>
    </CardContent>
  </Card>;
}

function CreateProject({ onClose, onCreated }: { onClose: () => void; onCreated: (project: PmProject) => void }) {
  const { user } = useAuth();
  const people = useFetch<PmPerson[]>("/api/pm/people");
  const [form, setForm] = useState({ key: "", name: "", description: "", lead: user?.id ?? "", start: "", target: "", mode: "scrum" });
  const [state, setState] = useState({ busy: false, error: "" });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      const project = await api<PmProject>("/api/pm/projects", { method: "POST", body: {
        key: form.key.trim().toUpperCase(), name: form.name.trim(), description: form.description.trim() || null,
        lead_id: form.lead || null, start_date: form.start || null, target_date: form.target || null,
        sprints_enabled: form.mode === "scrum",
      } });
      onCreated(project);
    } catch (cause) {
      setState({ busy: false, error: pmError(cause) });
    }
  }

  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>The lead becomes the project administrator and can add the team.</DialogDescription>
      </DialogHeader>
      <form id="pm-project-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
        <FieldGroup className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field>
            <FieldLabel htmlFor="pm-project-key">Key</FieldLabel>
            <Input id="pm-project-key" value={form.key} required maxLength={10} pattern="[A-Za-z][A-Za-z0-9]{1,9}" placeholder="LIMS"
              onChange={(event) => set("key", event.target.value.toUpperCase())} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pm-project-name">Name</FieldLabel>
            <Input id="pm-project-name" value={form.name} required maxLength={255} onChange={(event) => set("name", event.target.value)} />
          </Field>
          <FieldDescription className="sm:col-span-2">The key prefixes every issue, for example {(form.key || "LIMS")}-12. It can't be changed later.</FieldDescription>
          <div className="sm:col-span-2"><TaskChoice id="pm-project-mode" label="Starting board" value={form.mode} items={[{ value: "scrum", label: "Scrum · sprints and backlog" }, { value: "kanban", label: "Kanban · continuous flow" }]} onChange={(value) => set("mode", value)} /></div>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="pm-project-description">Description</FieldLabel>
            <Textarea id="pm-project-description" rows={3} value={form.description} onChange={(event) => set("description", event.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            {people.error ? <ErrorState message={people.error} onRetry={people.reload} /> :
              <TaskChoice id="pm-project-lead" label="Project lead" value={form.lead} disabled={people.loading}
                items={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} onChange={(value) => set("lead", value)} />}
          </div>
          <Field>
            <FieldLabel htmlFor="pm-project-start">Start date</FieldLabel>
            <Input id="pm-project-start" type="date" value={form.start} onChange={(event) => set("start", event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pm-project-target">Target date</FieldLabel>
            <Input id="pm-project-target" type="date" value={form.target} onChange={(event) => set("target", event.target.value)} />
          </Field>
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
        <Button type="submit" form="pm-project-form" disabled={state.busy}>{state.busy && <Spinner data-icon="inline-start" />}Create project</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
