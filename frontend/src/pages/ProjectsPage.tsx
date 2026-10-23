import { useState } from "react";
import { ArrowRight, Bot, Check, FolderKanban, GanttChart, LayoutGrid, ListTodo, Plus } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { labelOf, PROJECT_ROLES, type PmProject } from "@/api/pm";
import { dateLabel } from "@/api/tasks";
import { useAuth } from "@/auth/AuthContext";
import { HealthBadge, ProjectsTimeline } from "@/components/pm/ProjectsTimeline";
import { Empty, ErrorState, Loading, PageHead } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFetch } from "@/hooks/useApi";
import { CreateProject } from "@/components/pm/CreateProject";
import { IssueExplorer } from "@/components/pm/IssueExplorer";
import { FilterSelect } from "@/components/ListControls";
import { type PmView } from "@/api/pm-workspace";

export default function ProjectsPage() {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  const status = params.get("status") === "archived" ? "archived" : "active";
  const view = ["timeline", "issues"].includes(params.get("layout") ?? "") ? params.get("layout")! : "cards";
  const projects = useFetch<PmProject[]>(`/api/pm/projects?status=${view === "issues" ? "active" : status}`, true);
  function setView(value: string) { setParams((old) => { const next = new URLSearchParams(old); next.set("layout", value); return next; }); }
  function setStatus(value: string) { setParams((old) => { const next = new URLSearchParams(old); next.set("status", value); return next; }); }
  const views = useFetch<PmView[]>("/api/pm/views");
  const savedView = views.data?.find((item) => item.id === params.get("view"));
  const navigate = useNavigate();

  return <div className="flex flex-col gap-5">
    <PageHead
      headingLevel={1}
      title="Projects"
      subtitle="Requirements, implementation tasks and supporting decisions for each project."
      action={<div className="flex flex-wrap gap-2">
        <Button variant="outline" nativeButton={false} render={<Link to="/ai-access" />}><Bot data-icon="inline-start" />AI access</Button>
        {user?.is_admin && <Button onClick={() => setCreating(true)}><Plus data-icon="inline-start" />New project</Button>}
      </div>}
    />
    <Tabs value={view === "issues" ? "issues" : "projects"} onValueChange={(value) => setView(value === "issues" ? "issues" : "cards")} className="gap-5">
      <TabsList variant="line" aria-label="Projects navigation" className="group-data-horizontal/tabs:h-11 w-full justify-start border-b border-border p-0">
        <TabsTrigger value="projects" className="h-full flex-none px-4 text-sm transition-none after:transition-none group-data-horizontal/tabs:after:bottom-[-1px]"><FolderKanban aria-hidden="true" />Projects</TabsTrigger>
        <TabsTrigger value="issues" className="h-full flex-none px-4 text-sm transition-none after:transition-none group-data-horizontal/tabs:after:bottom-[-1px]"><ListTodo aria-hidden="true" />All issues</TabsTrigger>
      </TabsList>
      <TabsContent value="issues" className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Search and filter issues across your accessible projects. Project status and layout apply only to the Projects tab.</p>
      {views.error ? <ErrorState message={views.error} onRetry={views.reload} /> : !views.data ? <Loading /> : <>
        <div className="sm:w-72"><FilterSelect id="pm-global-view" label="Saved personal view" value={savedView?.id ?? ""} options={[{ value: "", label: "All accessible issues" }, ...views.data.map((item) => ({ value: item.id, label: item.name }))]} onChange={(id) => setParams((old) => { const next = new URLSearchParams(old); next.set("view", id); for (const key of Array.from(next.keys())) if (key.startsWith("f_") || key.startsWith("issue_") || key === "month") next.delete(key); next.delete("offset"); return next; })} /></div>
        <IssueExplorer key={savedView?.id ?? "all"} view={savedView} projects={projects.data ?? []} onViewDeleted={() => { void views.refresh(); setParams((old) => { const next = new URLSearchParams(old); next.delete("view"); return next; }); }} onViewSaved={(saved) => { void views.refresh(); setParams((old) => { const next = new URLSearchParams(old); next.set("view", saved.id); return next; }); }} />
      </>}
      </TabsContent>
      <TabsContent value="projects" className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <span id="pm-status-label" className="text-sm font-medium">Project status</span>
            <ToggleGroup value={[status]} onValueChange={(values) => values[0] && setStatus(values[0])} aria-labelledby="pm-status-label" spacing={0} className="border border-border bg-muted p-1">
              {["active", "archived"].map((value) => <ToggleGroupItem key={value} value={value} className="min-h-9 px-3 transition-none aria-pressed:bg-primary aria-pressed:text-primary-foreground">
                <Check data-icon="inline-start" aria-hidden="true" className={status === value ? undefined : "invisible"} />{value === "active" ? "Active" : "Archived"}
              </ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-2">
            <span id="pm-layout-label" className="text-sm font-medium">Project layout</span>
            <ToggleGroup value={[view]} onValueChange={(values) => values[0] && setView(values[0])} aria-labelledby="pm-layout-label" variant="outline" spacing={0}>
              <ToggleGroupItem value="cards" className="min-h-11 px-3 transition-none aria-pressed:border-foreground aria-pressed:bg-muted"><LayoutGrid data-icon="inline-start" aria-hidden="true" />Cards</ToggleGroupItem>
              <ToggleGroupItem value="timeline" className="min-h-11 px-3 transition-none aria-pressed:border-foreground aria-pressed:bg-muted"><GanttChart data-icon="inline-start" aria-hidden="true" />Timeline</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <p role="status" className="text-sm text-muted-foreground">{projects.loading ? "Loading projects…" : projects.error ? "Projects could not be loaded." : `${projects.data?.length ?? 0} ${status} ${(projects.data?.length ?? 0) === 1 ? "project" : "projects"}`}{status === "archived" && " · Read-only projects"}</p>
      {projects.error ? <ErrorState message={projects.error} onRetry={projects.reload} /> :
      projects.loading && !projects.data ? <Loading /> :
      !projects.data?.length ? <Empty
        message={status === "archived" ? "No archived projects" : "No projects yet"}
        hint={status === "archived" ? "Archived projects you can see will appear here." : user?.is_admin ? "Create a project and add its team." : "Ask a project administrator to add you to a project."}
      /> :
      view === "timeline" ? <ProjectsTimeline projects={projects.data} /> :
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.data.map((project) => <ProjectCard key={project.id} project={project} />)}
      </div>}
      </TabsContent>
    </Tabs>
    {creating && <CreateProject onClose={() => setCreating(false)} onCreated={(project) => navigate(`/projects/${project.key}`)} />}
  </div>;
}

function ProjectCard({ project }: { project: PmProject }) {
  const percent = project.issue_count ? Math.round(project.done_count / project.issue_count * 100) : 0;
  return <Card>
    <CardHeader>
      <CardTitle className="flex items-start gap-2">
        <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Link to={`/projects/${project.key}`} className="min-w-0 break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{project.name}</Link>
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
    <CardFooter className="mt-auto">
      <Button role="link" variant="outline" nativeButton={false} render={<Link to={`/projects/${project.key}`} />} aria-label={`Open project ${project.name}`}>
        Open project<ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </CardFooter>
  </Card>;
}
