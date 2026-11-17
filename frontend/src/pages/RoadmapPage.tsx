import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ArrowDown, ArrowUp, Archive, GripVertical, Layers, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { hasProjectPermission, pmError, type PmProject } from "@/api/pm";
import {
  HORIZONS, PRIORITIES, ROADMAP_STATUSES, priorityVariant, roadmapStatusVariant,
  type Roadmap, type RoadmapFeature, type RoadmapHorizon, type RoadmapProject,
} from "@/api/pm-roadmap";
import { FilterSelect } from "@/components/ListControls";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ConfirmDialog, Empty, ErrorState, Loading, MetricStrip, Modal, PageHead, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFetch } from "@/hooks/useApi";

const ALL = "";
const label = (items: Array<{ value: string; label: string }>, value: string | null) =>
  items.find((item) => item.value === value)?.label ?? "—";

/** One view of every planned feature across products (BRD 9A, RMP-03/04). */
export default function RoadmapPage() {
  const [filters, setFilters] = useState({ project_id: ALL, module_id: ALL, priority: ALL, horizon: ALL, status: ALL });
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  const roadmap = useFetch<Roadmap>(`/api/pm/roadmap${query ? `?${query}` : ""}`);
  const [editing, setEditing] = useState<RoadmapFeature | null>(null);
  const [starting, setStarting] = useState<RoadmapFeature | null>(null);
  const [modules, setModules] = useState<RoadmapProject | null>(null);
  const projects = roadmap.data?.projects ?? [];
  const features = roadmap.data?.features ?? [];
  const chosenProject = projects.find((p) => p.id === filters.project_id);
  const set = (key: keyof typeof filters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value, ...(key === "project_id" ? { module_id: ALL } : {}) }));

  return <div className="flex flex-col gap-6">
    <PageHead headingLevel={1} title="Roadmap"
      subtitle="Every planned feature across products, grouped by module. Approve features here, then start them as epics on the team board."
      action={<Button variant="outline" nativeButton={false} render={<Link to="/requirements" />}>All requirements</Button>} />
    <Card>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-5">
        <FilterSelect id="rm-project" label="Product" value={filters.project_id} onChange={(v) => set("project_id", v)}
          options={[{ value: ALL, label: "All products" }, ...projects.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))]} />
        <FilterSelect id="rm-module" label="Module" value={filters.module_id} onChange={(v) => set("module_id", v)} disabled={!chosenProject}
          options={[{ value: ALL, label: chosenProject ? "All modules" : "Choose a product first" }, ...(chosenProject?.modules ?? []).map((m) => ({ value: m.id, label: m.name }))]} />
        <FilterSelect id="rm-priority" label="Priority" value={filters.priority} onChange={(v) => set("priority", v)}
          options={[{ value: ALL, label: "Any priority" }, ...PRIORITIES]} />
        <FilterSelect id="rm-horizon" label="Horizon" value={filters.horizon} onChange={(v) => set("horizon", v)}
          options={[{ value: ALL, label: "Any horizon" }, ...HORIZONS, { value: "none", label: "Not planned" }]} />
        <FilterSelect id="rm-status" label="Status" value={filters.status} onChange={(v) => set("status", v)}
          options={[{ value: ALL, label: "Any status" }, ...ROADMAP_STATUSES]} />
      </CardContent>
    </Card>
    {roadmap.error ? <ErrorState message={roadmap.error} onRetry={roadmap.reload} /> : !roadmap.data ? <Loading /> : <>
      <MetricStrip items={[
        ...HORIZONS.map((h) => ({ label: h.label, value: features.filter((f) => f.horizon === h.value).length })),
        { label: "In progress", value: features.filter((f) => f.status === "in_progress").length },
        { label: "Done", value: features.filter((f) => f.status === "done").length },
      ]} />
      {!projects.length ? <Empty message="No roadmap to show" hint="Ask a project lead to give you roadmap access." /> :
        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">By module</TabsTrigger>
            <TabsTrigger value="board">Meeting board</TabsTrigger>
          </TabsList>
          <TabsContent value="list" className="flex flex-col gap-6 pt-4">
            {projects.map((project) => <ProjectSection key={project.id} project={project}
              features={features.filter((f) => f.project_id === project.id)}
              onEdit={setEditing} onStart={setStarting} onModules={() => setModules(project)} />)}
          </TabsContent>
          <TabsContent value="board" className="pt-4">
            <MeetingBoard features={features} onChanged={roadmap.refresh} onEdit={setEditing} />
          </TabsContent>
        </Tabs>}
    </>}
    {editing && <FeatureDialog feature={editing} project={projects.find((p) => p.id === editing.project_id)}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void roadmap.refresh(); }} />}
    {starting && <StartDialog feature={starting} onClose={() => setStarting(null)}
      onStarted={() => { setStarting(null); void roadmap.refresh(); }} />}
    {modules && <ModulesDialog project={modules} onClose={() => setModules(null)} onChanged={() => void roadmap.refresh()} />}
  </div>;
}

function FeatureBadges({ feature }: { feature: RoadmapFeature }) {
  return <>
    {feature.priority && <Badge variant={priorityVariant(feature.priority)}>{label(PRIORITIES, feature.priority)}</Badge>}
    <Badge variant="outline">{feature.horizon ? label(HORIZONS, feature.horizon) : "Not planned"}</Badge>
    <Badge variant={roadmapStatusVariant(feature.status)}>{label(ROADMAP_STATUSES, feature.status)}</Badge>
  </>;
}

function EpicLinks({ feature }: { feature: RoadmapFeature }) {
  if (!feature.epics.length) return <span className="text-muted-foreground">No epic yet</span>;
  return <span className="flex flex-wrap gap-2">{feature.epics.map((epic) =>
    <Link key={epic.id} to={`/projects/${epic.project_key}?issue=${epic.key}`} className="font-medium underline-offset-4 hover:underline">{epic.key}</Link>)}</span>;
}

function FeatureProgress({ feature }: { feature: RoadmapFeature }) {
  return <div className="flex min-w-24 items-center gap-2">
    <Progress value={feature.progress.percent} className="flex-1" aria-label={`${feature.title} progress`} />
    <span className="text-xs text-muted-foreground">{feature.progress.percent}%</span>
  </div>;
}

function FeatureActions({ feature, onEdit, onStart }: { feature: RoadmapFeature; onEdit: (f: RoadmapFeature) => void; onStart: (f: RoadmapFeature) => void }) {
  return <div className="flex justify-end gap-1">
    {(feature.can_edit || feature.can_decide) && <Button variant="ghost" size="icon" aria-label={`Edit ${feature.title}`} onClick={() => onEdit(feature)}><Pencil /></Button>}
    {feature.can_decide && feature.status === "approved" && <Button variant="outline" size="sm" onClick={() => onStart(feature)}><Play data-icon="inline-start" />Start</Button>}
  </div>;
}

function ProjectSection({ project, features, onEdit, onStart, onModules }: {
  project: RoadmapProject; features: RoadmapFeature[];
  onEdit: (f: RoadmapFeature) => void; onStart: (f: RoadmapFeature) => void; onModules: () => void;
}) {
  const groups = [...project.modules.filter((m) => !m.archived || features.some((f) => f.module_id === m.id)).map((m) => ({ id: m.id, name: m.name })),
    { id: null as string | null, name: "No module" }]
    .map((group) => ({ ...group, items: features.filter((f) => f.module_id === group.id) }))
    .filter((group) => group.items.length || group.id);
  return <Card>
    <CardHeader>
      <CardTitle>{project.name}</CardTitle>
      <CardDescription>{project.key} · {features.length} feature{features.length === 1 ? "" : "s"}</CardDescription>
      {project.can_edit && <CardAction><Button variant="outline" onClick={onModules}><Layers data-icon="inline-start" />Modules</Button></CardAction>}
    </CardHeader>
    <CardContent className="flex flex-col gap-5">
      {!features.length && <p className="text-sm text-muted-foreground">No features match these filters.</p>}
      {groups.map((group) => <section key={group.id ?? "none"} aria-label={`${project.key} ${group.name}`} className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{group.name} <span className="font-normal text-muted-foreground">· {group.items.length}</span></h3>
        {!group.items.length ? <p className="text-sm text-muted-foreground">No features in this module.</p> : <>
          <ul className="flex flex-col divide-y divide-border border-y border-border md:hidden">
            {group.items.map((f) => <li key={f.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium"><span className="block text-xs text-muted-foreground">{f.key}</span>{f.title}</p>
                <FeatureActions feature={f} onEdit={onEdit} onStart={onStart} />
              </div>
              <div className="flex flex-wrap gap-2"><FeatureBadges feature={f} /></div>
              <FeatureProgress feature={f} />
              <p className="text-xs text-muted-foreground">{f.owner_name ?? "No owner"}{f.target_quarter ? ` · ${f.target_quarter}` : ""} · <EpicLinks feature={f} /></p>
            </li>)}
          </ul>
          <TableSurface className="hidden md:block">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Feature</TableHead><TableHead>Priority</TableHead><TableHead>Horizon</TableHead><TableHead>Status</TableHead>
                <TableHead>Owner</TableHead><TableHead>Progress</TableHead><TableHead>Epic</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow></TableHeader>
              <TableBody>{group.items.map((f) => <TableRow key={f.id}>
                <TableCell className="max-w-xs whitespace-normal"><span className="block text-xs text-muted-foreground">{f.key}{f.target_quarter ? ` · ${f.target_quarter}` : ""}</span><span className="font-medium">{f.title}</span></TableCell>
                <TableCell>{f.priority ? <Badge variant={priorityVariant(f.priority)}>{label(PRIORITIES, f.priority)}</Badge> : "—"}</TableCell>
                <TableCell>{f.horizon ? label(HORIZONS, f.horizon) : "Not planned"}</TableCell>
                <TableCell><Badge variant={roadmapStatusVariant(f.status)}>{label(ROADMAP_STATUSES, f.status)}</Badge></TableCell>
                <TableCell>{f.owner_name ?? "—"}</TableCell>
                <TableCell><FeatureProgress feature={f} /></TableCell>
                <TableCell><EpicLinks feature={f} /></TableCell>
                <TableCell><FeatureActions feature={f} onEdit={onEdit} onStart={onStart} /></TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </TableSurface>
        </>}
      </section>)}
    </CardContent>
  </Card>;
}

const COLUMNS: Array<{ value: RoadmapHorizon | "none"; label: string }> = [...HORIZONS, { value: "none", label: "Not planned" }];

/** Now / Next / Later / Future columns for planning meetings; drag or pick to change horizon (RMP-04). */
function MeetingBoard({ features, onChanged, onEdit }: { features: RoadmapFeature[]; onChanged: () => void; onEdit: (f: RoadmapFeature) => void }) {
  const { notify } = useToast();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));

  async function save(feature: RoadmapFeature, body: Record<string, string | null>, message: string) {
    setBusy(feature.id);
    setError("");
    try { await api(`/api/pm/requirements/${feature.id}/roadmap`, { method: "PATCH", body }); notify(message); onChanged(); }
    catch (cause) { setError(pmError(cause)); }
    finally { setBusy(""); }
  }
  function drop(event: DragEndEvent) {
    const feature = features.find((f) => f.id === event.active.id);
    const column = event.over?.id as RoadmapHorizon | "none" | undefined;
    if (!feature || !column || (feature.horizon ?? "none") === column) return;
    void save(feature, { horizon: column === "none" ? null : column }, `${feature.title} moved to ${label(COLUMNS, column)}.`);
  }

  return <div className="flex flex-col gap-3">
    <p className="text-sm text-muted-foreground">Drag a feature by its handle to change when it will be done, or use its Horizon and Priority menus. Keyboard: Space on the handle to pick up, arrows to move, Space to drop.</p>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <DndContext sensors={sensors} onDragEnd={drop}>
      <div className="grid items-start gap-3 md:grid-cols-5">
        {COLUMNS.map((column) => <BoardColumn key={column.value} id={column.value} label={column.label}
          count={features.filter((f) => (f.horizon ?? "none") === column.value).length}>
          {features.filter((f) => (f.horizon ?? "none") === column.value).map((f) =>
            <BoardCard key={f.id} feature={f} busy={busy === f.id} onEdit={onEdit}
              onHorizon={(value) => void save(f, { horizon: value === "none" ? null : value }, `${f.title} moved to ${label(COLUMNS, value)}.`)}
              onPriority={(value) => void save(f, { priority: value || null }, `${f.title} priority updated.`)} />)}
        </BoardColumn>)}
      </div>
    </DndContext>
  </div>;
}

function BoardColumn({ id, label: name, count, children }: { id: string; label: string; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <section ref={setNodeRef} aria-label={`${name} column`}
    className={`flex min-h-32 flex-col gap-2 border border-border p-2 ${isOver ? "bg-accent ring-2 ring-ring" : "bg-muted/30"}`}>
    <div className="flex items-center justify-between px-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{name}</h3>
      <Badge variant="outline">{count}</Badge>
    </div>
    {children}
  </section>;
}

function BoardCard({ feature, busy, onHorizon, onPriority, onEdit }: {
  feature: RoadmapFeature; busy: boolean; onHorizon: (value: string) => void; onPriority: (value: string) => void; onEdit: (f: RoadmapFeature) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: feature.id, disabled: !feature.can_decide || busy });
  const { onKeyDown, ...pointer } = listeners ?? {};
  return <article ref={setNodeRef} aria-label={`${feature.key} ${feature.title}`}
    className={`flex flex-col gap-2 border border-border bg-card p-3 text-sm ${isDragging ? "opacity-40" : ""} ${busy ? "opacity-60" : ""}`}>
    <div className="flex items-start gap-2">
      <p className="min-w-0 flex-1 break-words"><span className="block text-xs text-muted-foreground">{feature.key}{feature.module_name ? ` · ${feature.module_name}` : ""}</span><span className="font-medium">{feature.title}</span></p>
      {feature.can_decide && <Button ref={setActivatorNodeRef} variant="ghost" size="icon-sm" className="-m-1 shrink-0 touch-none" {...attributes} {...pointer}
        onKeyDownCapture={(event) => onKeyDown?.(event)} aria-label={`Move feature: ${feature.title}`}><GripVertical /></Button>}
    </div>
    <div className="flex flex-wrap gap-1"><Badge variant={roadmapStatusVariant(feature.status)}>{label(ROADMAP_STATUSES, feature.status)}</Badge></div>
    <FeatureProgress feature={feature} />
    {feature.can_decide && <FilterSelect id={`rm-h-${feature.id}`} label="Horizon" labelClassName="sr-only" value={feature.horizon ?? "none"}
      disabled={busy} options={COLUMNS} onChange={onHorizon} />}
    {feature.can_edit
      ? <FilterSelect id={`rm-p-${feature.id}`} label="Priority" labelClassName="sr-only" value={feature.priority ?? ""} disabled={busy}
        options={[{ value: "", label: "No priority" }, ...PRIORITIES]} onChange={onPriority} />
      : feature.priority && <Badge variant={priorityVariant(feature.priority)}>{label(PRIORITIES, feature.priority)}</Badge>}
    {(feature.can_edit || feature.can_decide) && <Button variant="ghost" size="sm" onClick={() => onEdit(feature)}><Pencil data-icon="inline-start" />Details</Button>}
  </article>;
}

function FeatureDialog({ feature, project, onClose, onSaved }: {
  feature: RoadmapFeature; project?: RoadmapProject; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    module_id: feature.module_id ?? "", priority: feature.priority ?? "", target_quarter: feature.target_quarter ?? "",
    horizon: feature.horizon ?? "", status: feature.status as string,
  });
  const [state, setState] = useState({ busy: false, error: "" });
  const quarterInvalid = Boolean(form.target_quarter) && !/^\d{4}-Q[1-4]$/.test(form.target_quarter);
  const statuses = ROADMAP_STATUSES.filter((s) => s.value !== "in_progress" || feature.status === "in_progress");

  async function save(event: FormEvent) {
    event.preventDefault();
    const body: Record<string, string | null> = {};
    if (feature.can_edit) Object.assign(body, { module_id: form.module_id || null, priority: form.priority || null, target_quarter: form.target_quarter || null });
    if (feature.can_decide) Object.assign(body, { horizon: form.horizon || null, ...(form.status !== feature.status ? { status: form.status } : {}) });
    setState({ busy: true, error: "" });
    try { await api(`/api/pm/requirements/${feature.id}/roadmap`, { method: "PATCH", body }); onSaved(); }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }

  return <Modal title={feature.title} description={`${feature.key}. Priority says how important it is; horizon says when it will be done.`} onClose={onClose} maxWidth={560}
    footer={<>
      <Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
      <Button type="submit" form="rm-feature-form" disabled={state.busy || quarterInvalid}>{state.busy && <Spinner data-icon="inline-start" />}Save</Button>
    </>}>
    <form id="rm-feature-form" onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <TaskChoice id="rm-f-module" label="Module" value={form.module_id} disabled={!feature.can_edit}
          items={[{ value: "", label: "No module" }, ...(project?.modules ?? []).filter((m) => !m.archived || m.id === feature.module_id).map((m) => ({ value: m.id, label: m.name }))]}
          onChange={(value) => setForm((c) => ({ ...c, module_id: value }))} />
        <TaskChoice id="rm-f-priority" label="Priority" value={form.priority} disabled={!feature.can_edit}
          items={[{ value: "", label: "No priority" }, ...PRIORITIES]} onChange={(value) => setForm((c) => ({ ...c, priority: value }))} />
        <TaskChoice id="rm-f-horizon" label="Horizon" value={form.horizon} disabled={!feature.can_decide}
          items={[{ value: "", label: "Not planned" }, ...HORIZONS]} onChange={(value) => setForm((c) => ({ ...c, horizon: value }))} />
        <TaskChoice id="rm-f-status" label="Status" value={form.status} disabled={!feature.can_decide}
          items={statuses} onChange={(value) => setForm((c) => ({ ...c, status: value }))} />
        <Field data-invalid={quarterInvalid || undefined}>
          <FieldLabel htmlFor="rm-f-quarter">Target quarter</FieldLabel>
          <Input id="rm-f-quarter" value={form.target_quarter} placeholder="2027-Q1" disabled={!feature.can_edit} aria-invalid={quarterInvalid || undefined}
            onChange={(event) => setForm((c) => ({ ...c, target_quarter: event.target.value.toUpperCase() }))} />
          <FieldDescription>Optional, as year and quarter: 2027-Q1.</FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  </Modal>;
}

function StartDialog({ feature, onClose, onStarted }: { feature: RoadmapFeature; onClose: () => void; onStarted: () => void }) {
  const { notify } = useToast();
  const projects = useFetch<PmProject[]>("/api/pm/projects");
  const choices = (projects.data ?? []).filter((p) => hasProjectPermission(p, "issue.create"));
  const [target, setTarget] = useState(feature.project_id);
  const [state, setState] = useState({ busy: false, error: "" });

  async function start() {
    setState({ busy: true, error: "" });
    try {
      const result = await api<{ epic: { key: string } }>(`/api/pm/requirements/${feature.id}/start`, { method: "POST", body: { project_id: target } });
      notify(`Started as epic ${result.epic.key}.`);
      onStarted();
    } catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }

  return <Modal title={`Start ${feature.title}`} onClose={onClose} maxWidth={520}
    description="Creates an epic with the feature's title, scope and acceptance criteria on the chosen team board, linked both ways. The feature moves to In progress."
    footer={<>
      <Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
      <Button onClick={() => void start()} disabled={state.busy || !choices.some((p) => p.id === target)}>{state.busy && <Spinner data-icon="inline-start" />}Create epic</Button>
    </>}>
    <div className="flex flex-col gap-4">
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      {projects.error ? <ErrorState message={projects.error} onRetry={projects.reload} /> : projects.loading ? <Loading /> :
        !choices.length ? <Alert><AlertDescription>You can't create issues in any project.</AlertDescription></Alert> :
          <TaskChoice id="rm-start-project" label="Team board" value={target}
            items={choices.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))} onChange={setTarget} />}
    </div>
  </Modal>;
}

type ModuleRow = { id: string; name: string; description: string | null; position: number; archived: boolean; feature_count: number };

function ModulesDialog({ project, onClose, onChanged }: { project: RoadmapProject; onClose: () => void; onChanged: () => void }) {
  const { notify } = useToast();
  const modules = useFetch<ModuleRow[]>(`/api/pm/projects/${project.id}/modules`);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<ModuleRow | null>(null);
  const [state, setState] = useState({ busy: false, error: "" });
  const rows = useMemo(() => modules.data ?? [], [modules.data]);

  async function run(action: () => Promise<unknown>, message: string) {
    setState({ busy: true, error: "" });
    try { await action(); setState({ busy: false, error: "" }); notify(message); void modules.refresh(); onChanged(); return true; }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); return false; }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    if (await run(() => api(`/api/pm/projects/${project.id}/modules`, { method: "POST", body: { name } }), "Module added.")) setName("");
  }
  async function rename(id: string, value: string) {
    if (await run(() => api(`/api/pm/modules/${id}`, { method: "PATCH", body: { name: value } }), "Module renamed.")) setRenaming(null);
  }
  async function remove(module: ModuleRow) {
    await run(() => api(`/api/pm/modules/${module.id}`, { method: "DELETE" }), "Module deleted.");
    setDeleting(null);
  }
  const active = rows.filter((m) => !m.archived);
  function swap(index: number, direction: number) {
    const a = active[index], b = active[index + direction];
    if (!a || !b) return;
    void run(async () => {
      await api(`/api/pm/modules/${a.id}`, { method: "PATCH", body: { position: b.position } });
      await api(`/api/pm/modules/${b.id}`, { method: "PATCH", body: { position: a.position } });
    }, "Order updated.");
  }

  return <Modal title={`${project.key} modules`} description="Feature areas of this product. A module with features can be archived but not deleted." onClose={onClose} maxWidth={620}>
    <div className="flex flex-col gap-4">
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      <form onSubmit={(event) => void add(event)} className="flex items-end gap-2">
        <Field className="flex-1"><FieldLabel htmlFor="rm-module-name">New module</FieldLabel>
          <Input id="rm-module-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Booking" /></Field>
        <Button type="submit" disabled={state.busy || !name.trim()}><Plus data-icon="inline-start" />Add</Button>
      </form>
      {modules.error ? <ErrorState message={modules.error} onRetry={modules.reload} /> : modules.loading ? <Loading /> : !rows.length
        ? <Empty message="No modules yet" hint="Add the product's feature areas, such as Booking or CRM." />
        : <ul className="flex flex-col divide-y divide-border border-y border-border">
          {rows.map((module) => {
            const index = active.findIndex((m) => m.id === module.id);
            return <li key={module.id} className="flex flex-wrap items-center gap-2 py-2">
              {renaming?.id === module.id
                ? <form className="flex flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); void rename(module.id, renaming.name); }}>
                  <Input aria-label={`New name for ${module.name}`} value={renaming.name} onChange={(event) => setRenaming({ id: module.id, name: event.target.value })} />
                  <Button type="submit" size="sm" disabled={state.busy}>Save</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                </form>
                : <p className="min-w-0 flex-1 truncate font-medium">{module.name} <span className="font-normal text-muted-foreground">· {module.feature_count} feature{module.feature_count === 1 ? "" : "s"}</span> {module.archived && <Badge variant="secondary">Archived</Badge>}</p>}
              {!module.archived && <>
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${module.name} up`} disabled={state.busy || index <= 0} onClick={() => swap(index, -1)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${module.name} down`} disabled={state.busy || index >= active.length - 1} onClick={() => swap(index, 1)}><ArrowDown /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Rename ${module.name}`} disabled={state.busy} onClick={() => setRenaming({ id: module.id, name: module.name })}><Pencil /></Button>
              </>}
              <Button variant="ghost" size="icon-sm" aria-label={`${module.archived ? "Restore" : "Archive"} ${module.name}`} disabled={state.busy}
                onClick={() => void run(() => api(`/api/pm/modules/${module.id}`, { method: "PATCH", body: { archived: !module.archived } }), module.archived ? "Module restored." : "Module archived.")}><Archive /></Button>
              {module.feature_count === 0 && <Button variant="ghost" size="icon-sm" aria-label={`Delete ${module.name}`} disabled={state.busy} onClick={() => setDeleting(module)}><Trash2 /></Button>}
            </li>;
          })}
        </ul>}
    </div>
    {deleting && <ConfirmDialog title={`Delete ${deleting.name}?`} danger confirmLabel="Delete module" message="The module has no features. It is removed for good."
      onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
  </Modal>;
}
