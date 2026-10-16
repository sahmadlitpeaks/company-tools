import { useState } from "react";
import { FileText, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { canEdit, type PmMember, type PmProject } from "@/api/pm";
import { REQUIREMENT_STATUSES, requirementHref, requirementLabel, type RequirementPage } from "@/api/pm-requirements";
import { FilterSelect, ListPagination } from "@/components/ListControls";
import { Empty, ErrorState, Loading } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { useFetch } from "@/hooks/useApi";
import { RequirementForm } from "./RequirementForm";
import { CreateProject } from "./CreateProject";
import { useAuth } from "@/auth/AuthContext";

export function RequirementRegister({ project, refreshKey = 0 }: { project?: PmProject; refreshKey?: number }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [newProject, setNewProject] = useState(false);
  const [filters, setFilters] = useState({ q: "", status: "", offset: 0, limit: 25 });
  const [creating, setCreating] = useState(false);
  const [chosenProject, setSelectedProject] = useState<PmProject>();
  const selectedProject = project ?? chosenProject;
  const projects = useFetch<PmProject[]>(!project ? "/api/pm/projects?status=active" : null);
  const members = useFetch<PmMember[]>(creating && selectedProject ? `/api/pm/projects/${selectedProject.id}/members` : null);
  const query = new URLSearchParams({ q: filters.q, offset: String(filters.offset), limit: String(filters.limit), v: String(refreshKey) });
  if (filters.status) query.set("status", filters.status);
  if (project) query.set("project_id", project.id);
  const list = useFetch<RequirementPage>(`/api/pm/requirements?${query}`, true);
  const editable = project ? canEdit(project.my_role) && project.status === "active" : Boolean(user?.is_admin || projects.data?.some((p) => canEdit(p.my_role)));
  const choices = projects.data?.filter((p) => canEdit(p.my_role)) ?? [];
  const hasFilters = Boolean(filters.q || filters.status);
  return <section aria-label="Requirement register" className="flex flex-col gap-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div>
      {project && <h2 className="text-lg font-semibold">Requirements</h2>}
      <p className="max-w-2xl text-sm text-muted-foreground">Start with the complete request. Track its implementation tasks and the decisions made along the way.</p>
    </div>{editable && <Button onClick={() => { if (!project) setSelectedProject(undefined); setCreating(true); }}><Plus data-icon="inline-start" />Create requirement</Button>}</div>
    <FieldGroup className="grid gap-3 sm:grid-cols-[1fr_12rem]">
      <Field><FieldLabel htmlFor="requirement-search">Search requirements</FieldLabel><Input id="requirement-search" type="search" placeholder="Key, title or original request" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value, offset: 0 })} /></Field>
      <FilterSelect id="requirement-filter-status" label="Status" value={filters.status} options={[{ value: "", label: "Active requirements" }, ...REQUIREMENT_STATUSES]} onChange={(status) => setFilters({ ...filters, status, offset: 0 })} />
    </FieldGroup>
    {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : !list.data.items.length ? <Card><CardContent className="py-10"><Empty icon={<FileText />} message={hasFilters ? "No matching requirements" : "Document the request first"} hint={hasFilters ? "Try another search or status." : "Capture the context, scope and expected outcome, then create tasks and record supporting decisions."} />{hasFilters && <div className="mt-4 text-center"><Button variant="outline" onClick={() => setFilters({ ...filters, q: "", status: "", offset: 0 })}>Clear filters</Button></div>}</CardContent></Card> : <>
      <div className="flex flex-col gap-3 md:hidden">{list.data.items.map((row) => <Card key={row.id}><CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{row.key}</span><Badge variant="secondary">{requirementLabel(row.status)}</Badge></div>
        <Link className="break-words font-medium underline-offset-4 hover:underline" to={requirementHref(row)}>{row.title}</Link>
        {!project && <p className="text-sm text-muted-foreground">{row.project_name}</p>}
        <p className="text-sm text-muted-foreground">{row.owner_name ?? "Unassigned"} · {row.task_done}/{row.task_count} tasks done · {row.decision_count} {row.decision_count === 1 ? "decision" : "decisions"}</p>
        <Progress value={row.task_count ? row.task_done / row.task_count * 100 : 0} aria-label={`${row.task_done} of ${row.task_count} tasks done`} />
      </CardContent></Card>)}</div>
      <TableSurface className="hidden md:block"><Table><TableHeader><TableRow><TableHead>Requirement</TableHead><TableHead>Status / owner</TableHead><TableHead>Implementation</TableHead><TableHead>Decisions</TableHead></TableRow></TableHeader><TableBody>{list.data.items.map((row) => <TableRow key={row.id}>
        <TableCell className="max-w-sm whitespace-normal"><Link className="block break-words font-medium underline-offset-4 hover:underline" to={requirementHref(row)}>{row.title}</Link><p className="mt-1 text-xs text-muted-foreground">{row.key}{!project && ` · ${row.project_name}`}</p></TableCell>
        <TableCell><Badge variant="secondary">{requirementLabel(row.status)}</Badge><p className="mt-1 text-xs text-muted-foreground">{row.owner_name ?? "Unassigned"}</p></TableCell>
        <TableCell><p className="mb-2 text-xs">{row.task_done} of {row.task_count} tasks done</p><Progress className="max-w-36" value={row.task_count ? row.task_done / row.task_count * 100 : 0} aria-label={`${row.task_done} of ${row.task_count} tasks done`} /></TableCell>
        <TableCell>{row.decision_count}</TableCell>
      </TableRow>)}</TableBody></Table></TableSurface>
    </>}
    {list.data && list.data.total > 0 && <ListPagination id="requirements" total={list.data.total} offset={filters.offset} limit={filters.limit} loading={list.loading} onPage={(offset) => setFilters({ ...filters, offset })} onPageSize={(limit) => setFilters({ ...filters, limit, offset: 0 })} />}
    {creating && !selectedProject && !newProject && <Dialog open onOpenChange={(open) => !open && setCreating(false)}><DialogContent><DialogHeader><DialogTitle>Choose a project</DialogTitle><DialogDescription>The requirement and its tasks will belong to this project.</DialogDescription></DialogHeader>
      {projects.error ? <ErrorState message={projects.error} onRetry={projects.reload} /> : !projects.data ? <Loading /> : choices.length ? <FilterSelect id="requirement-project" label="Project" value="" options={[{ value: "", label: "Choose a project" }, ...choices.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))]} onChange={(id) => setSelectedProject(choices.find((p) => p.id === id))} /> : <p className="text-sm text-muted-foreground">{user?.is_admin ? "Create a project for this request to get started." : "You need member access to an active project to create a requirement."}</p>}
      {user?.is_admin && <Button variant="outline" onClick={() => setNewProject(true)}><Plus data-icon="inline-start" />New project for this request</Button>}
    </DialogContent></Dialog>}
    {creating && newProject && <CreateProject onClose={() => setNewProject(false)} onCreated={(created) => { setSelectedProject(created); setNewProject(false); void projects.refresh(); }} />}
    {creating && selectedProject && (members.error || !members.data) && <Dialog open onOpenChange={(open) => !open && setCreating(false)}><DialogContent><DialogHeader><DialogTitle>Create requirement</DialogTitle><DialogDescription>Loading {selectedProject.name}</DialogDescription></DialogHeader>{members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : <Loading />}</DialogContent></Dialog>}
    {creating && selectedProject && members.data && <RequirementForm project={selectedProject} members={members.data} onClose={() => setCreating(false)} onSaved={(row) => { setCreating(false); void list.refresh(); navigate(requirementHref(row)); }} />}
  </section>;
}
