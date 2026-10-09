import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { pmError, type PmIssue, type PmMember, type PmProject, type PmSprint } from "@/api/pm";
import { defaultSettings, resolvedColumns, type BoardColumn, type PmView, type ViewSettings } from "@/api/pm-workspace";
import { FilterSelect } from "@/components/ListControls";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceFilters } from "./WorkspaceFilters";
import { useWorkspace } from "./WorkspaceContext";

const PROPERTIES = ["assignee", "priority", "points", "due", "labels", "component"] as const;

const EMPTY_MEMBERS: PmMember[] = [];
const EMPTY_ISSUES: PmIssue[] = [];
const EMPTY_SPRINTS: PmSprint[] = [];
const EMPTY_PROJECTS: PmProject[] = [];

export function ViewDialog({ project, view, initial, duplicate = false, members = EMPTY_MEMBERS, issues = EMPTY_ISSUES, sprints = EMPTY_SPRINTS, projects = EMPTY_PROJECTS, onClose, onSaved }: {
  project?: PmProject; view?: PmView; initial?: ViewSettings; duplicate?: boolean;
  members?: PmMember[]; issues?: PmIssue[]; sprints?: PmSprint[]; projects?: PmProject[];
  onClose: () => void; onSaved: (view: PmView) => void;
}) {
  const config = useWorkspace();
  const [form, setForm] = useState(() => ({
    name: duplicate ? `Copy of ${view?.name ?? "view"}` : view?.name ?? "",
    visibility: (duplicate && project?.my_role !== "admin" ? "private" : view?.visibility ?? (project?.my_role === "admin" ? "team" : "private")) as "team" | "private",
    settings: structuredClone(initial ?? view?.settings ?? { ...defaultSettings(Boolean(project?.sprints_enabled)), ...(!project ? { layout: "table" as const } : {}) }),
  }));
  const [state, setState] = useState({ busy: false, error: "" });
  function set<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) { setForm((current) => ({ ...current, settings: { ...current.settings, [key]: value } })); }
  function columns(next: BoardColumn[]) { set("columns", next); }
  const shown = form.settings.columns.length ? form.settings.columns : resolvedColumns(form.settings, config);
  function moveColumn(index: number, delta: number) {
    const next = [...shown]; const target = index + delta;
    [next[index], next[target]] = [next[target], next[index]]; columns(next);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setState({ busy: true, error: "" });
    try {
      const saved = await api<PmView>(view && !duplicate ? `/api/pm/views/${view.id}` : "/api/pm/views", {
        method: view && !duplicate ? "PATCH" : "POST",
        body: { ...form, ...(!view || duplicate ? { project_id: project?.id ?? null } : {}) },
      });
      onSaved(saved);
    } catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{view && !duplicate ? `Configure ${view.name}` : "Create a board or view"}</DialogTitle>
        <DialogDescription>Choose a perspective on existing issues. Issues and their history stay in their project.</DialogDescription></DialogHeader>
      <form id="pm-view-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="pm-view-name">Name</FieldLabel><Input id="pm-view-name" required maxLength={120} value={form.name} placeholder="Development, QA queue, My work…" onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <FilterSelect id="pm-view-layout" label="Layout" value={form.settings.layout} options={[
            ...(project ? [{ value: "board", label: "Board" }] : []), { value: "list", label: "List" }, { value: "table", label: "Table" }, { value: "calendar", label: "Calendar" },
          ]} onChange={(value) => set("layout", value as ViewSettings["layout"])} />
          <FilterSelect id="pm-view-visibility" label="Access" value={form.visibility} disabled={Boolean(view && !duplicate)} options={[
            { value: "private", label: "Only me" }, ...(project?.my_role === "admin" ? [{ value: "team", label: "Project team" }] : []),
          ]} onChange={(value) => setForm({ ...form, visibility: value as "team" | "private" })} />
          {form.settings.layout === "board" && <FilterSelect id="pm-view-mode" label="Board type" value={form.settings.board_type} options={[
            ...(project?.sprints_enabled ? [{ value: "scrum", label: "Scrum · active sprint" }] : []), { value: "kanban", label: "Kanban · continuous work" },
          ]} onChange={(value) => set("board_type", value as ViewSettings["board_type"])} />}
        </FieldGroup>
        <Tabs defaultValue="filters">
          <TabsList className="flex-wrap"><TabsTrigger value="filters">Filters</TabsTrigger><TabsTrigger value="display">Display</TabsTrigger>{form.settings.layout === "board" && <TabsTrigger value="columns">Columns</TabsTrigger>}</TabsList>
          <TabsContent value="filters" className="pt-4"><WorkspaceFilters filters={form.settings.filters} members={members} issues={issues} sprints={sprints} projects={projects} global={!project} onChange={(next) => set("filters", next)} /></TabsContent>
          <TabsContent value="display" className="flex flex-col gap-4 pt-4">
            <FieldGroup className="grid gap-3 sm:grid-cols-2">
              <FilterSelect id="pm-view-group" label="Swimlanes" value={form.settings.group_by} options={[{ value: "none", label: "None" }, { value: "assignee", label: "Assignee" }, { value: "epic", label: "Epic" }, { value: "priority", label: "Priority" }]} onChange={(value) => set("group_by", value as ViewSettings["group_by"])} />
              <FilterSelect id="pm-view-sort" label="Order issues by" value={form.settings.order_by} options={["rank", "updated", "created", "due", "priority"].map((value) => ({ value, label: value === "rank" ? "Manual order" : value === "updated" ? "Recently updated" : value === "created" ? "Recently created" : value === "due" ? "Due date" : "Priority" }))} onChange={(value) => set("order_by", value as ViewSettings["order_by"])} />
            </FieldGroup>
            <FieldGroup className="grid gap-3 sm:grid-cols-3">{PROPERTIES.map((property) => <Field key={property} orientation="horizontal">
              <Checkbox id={`pm-property-${property}`} checked={form.settings.properties.includes(property)} onCheckedChange={(checked) => set("properties", checked ? [...form.settings.properties, property] : form.settings.properties.filter((item) => item !== property))} />
              <FieldLabel htmlFor={`pm-property-${property}`}>{property === "points" ? "Story points" : property === "due" ? "Due date" : property[0].toUpperCase() + property.slice(1)}</FieldLabel>
            </Field>)}</FieldGroup>
          </TabsContent>
          <TabsContent value="columns" className="flex flex-col gap-3 pt-4">
            <p className="text-sm text-muted-foreground">Map every workflow state once. Column limits highlight excess work; they do not block a move.</p>
            {shown.map((column, index) => <section key={column.key} aria-label={`Column ${index + 1}`} className="flex flex-col gap-3 border border-border p-3">
              <div className="flex items-end gap-2">
                <Field className="min-w-0 flex-1"><FieldLabel htmlFor={`pm-col-${index}`}>Column name</FieldLabel><Input id={`pm-col-${index}`} value={column.name} maxLength={80} required onChange={(event) => columns(shown.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></Field>
                <Field className="w-20"><FieldLabel htmlFor={`pm-limit-${index}`}>WIP limit</FieldLabel><Input id={`pm-limit-${index}`} type="number" min={1} max={1000} value={column.limit ?? ""} onChange={(event) => columns(shown.map((item, i) => i === index ? { ...item, limit: event.target.value ? Number(event.target.value) : null } : item))} /></Field>
                <Button type="button" variant="outline" size="icon" aria-label={`Move ${column.name} earlier`} disabled={index === 0} onClick={() => moveColumn(index, -1)}><ArrowUp /></Button>
                <Button type="button" variant="outline" size="icon" aria-label={`Move ${column.name} later`} disabled={index === shown.length - 1} onClick={() => moveColumn(index, 1)}><ArrowDown /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${column.name} column`} disabled={shown.length < 2} onClick={() => columns(shown.filter((item) => item.key !== column.key))}><Trash2 /></Button>
              </div>
              <FieldGroup className="flex flex-wrap gap-x-4 gap-y-2">{config.states.map((workflow) => <Field key={workflow.key} orientation="horizontal" className="w-auto">
                <Checkbox id={`pm-map-${column.key}-${workflow.key}`} checked={column.states.includes(workflow.key)} onCheckedChange={(checked) => columns(shown.map((item) => ({ ...item, states: item.key === column.key && checked ? [...item.states.filter((key) => key !== workflow.key), workflow.key] : item.states.filter((key) => key !== workflow.key) })))} />
                <FieldLabel htmlFor={`pm-map-${column.key}-${workflow.key}`}>{workflow.name}</FieldLabel>
              </Field>)}</FieldGroup>
            </section>)}
            <Button type="button" variant="outline" className="self-start" onClick={() => columns([...shown, { key: `column_${crypto.randomUUID().replace(/-/g, "")}`, name: "New column", states: [], limit: null }])}><Plus data-icon="inline-start" />Add column</Button>
            <FieldDescription>Unmapped states are kept visible until you assign them. Save after each state belongs to exactly one column.</FieldDescription>
          </TabsContent>
        </Tabs>
      </form>
      <DialogFooter><Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button><Button type="submit" form="pm-view-form" disabled={state.busy}>Save view</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
