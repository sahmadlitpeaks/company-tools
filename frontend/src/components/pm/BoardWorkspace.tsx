import { useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { Copy, Filter, Plus, Settings2, SquareCheckBig, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { BOARD_TYPES, ISSUE_PRIORITIES, pmError, rankBetween, type PmIssue, type PmMember, type PmProject, type PmSprint } from "@/api/pm";
import { defaultSettings, EMPTY_FILTERS, filterIssues, resolvedColumns, stateKey, type PmView, type ViewFilters } from "@/api/pm-workspace";
import { useAuth } from "@/auth/AuthContext";
import { FilterSelect } from "@/components/ListControls";
import { Empty, ErrorState, Loading } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { useFetch } from "@/hooks/useApi";
import { IssueBoard } from "./IssueBoard";
import { IssueExplorer } from "./IssueExplorer";
import { ViewDialog } from "./ViewDialog";
import { useWorkspace } from "./WorkspaceContext";
import { WorkspaceFilters } from "./WorkspaceFilters";

export function BoardWorkspace({ project, issues, members, sprints, activeSprint, editable, busy, onPatch, onCreate, onComplete, onBacklog, onChanged }: {
  project: PmProject; issues: PmIssue[]; members: PmMember[]; sprints: PmSprint[]; activeSprint: PmSprint | null;
  editable: boolean; busy: string | null; onPatch: (issue: PmIssue, body: Partial<PmIssue>, guess: Partial<PmIssue>) => void;
  onCreate: (defaults: { workflow_state?: string; sprint_id?: string }) => void; onComplete: (sprint: PmSprint) => void;
  onBacklog: () => void; onChanged: () => void;
}) {
  const config = useWorkspace(), { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const views = useFetch<PmView[]>(`/api/pm/projects/${project.id}/views`);
  const [dialog, setDialog] = useState<"new" | "edit" | "copy" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mutation, setMutation] = useState({ busy: false, error: "" });
  const selectedId = params.get("view");
  const current = views.data?.find((view) => view.id === selectedId) ?? (!selectedId ? views.data?.[0] : undefined);
  const settings = current?.settings ?? defaultSettings(project.sprints_enabled);
  const filters: ViewFilters = { ...EMPTY_FILTERS, ...settings.filters };
  for (const key of Object.keys(EMPTY_FILTERS)) if (key !== "project_ids" && params.has(`b_${key}`)) Object.assign(filters, { [key]: params.get(`b_${key}`) ?? "" });
  const scrum = project.sprints_enabled && settings.board_type === "scrum";
  const columns = resolvedColumns(settings, config);
  const recent = Date.now() - 14 * 86_400_000;
  const eligible = issues.filter((issue) => BOARD_TYPES.includes(issue.issue_type)).filter((issue) => scrum ? issue.sprint_id === activeSprint?.id : issue.status !== "done" || Boolean(issue.resolved_at && Date.parse(issue.resolved_at) >= recent));
  const cards = filterIssues(eligible, { ...filters, sprint: filters.sprint === "active" ? activeSprint?.id ?? "missing" : filters.sprint }, user?.id).sort((a, b) => settings.order_by === "priority" ? ISSUE_PRIORITIES.findIndex((item) => item.value === a.priority) - ISSUE_PRIORITIES.findIndex((item) => item.value === b.priority) :
    settings.order_by === "due" ? (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") :
    settings.order_by === "updated" || settings.order_by === "created" ? (settings.order_by === "updated" ? b.updated_at.localeCompare(a.updated_at) : b.created_at.localeCompare(a.created_at)) : a.rank - b.rank || a.number - b.number);
  function selectView(id: string) {
    setParams((old) => { const next = new URLSearchParams(old); next.set("view", id);
      for (const key of Array.from(next.keys())) if (key.startsWith("b_") || key.startsWith("f_") || key.startsWith("issue_") || key === "month") next.delete(key);
      next.delete("offset"); return next; });
  }
  function setFilters(next: ViewFilters) {
    setParams((old) => { const copy = new URLSearchParams(old); for (const [key, value] of Object.entries(next)) if (key !== "project_ids") copy.set(`b_${key}`, value as string); return copy; }, { replace: true });
  }
  function saved(view: PmView) { setDialog(null); void views.refresh(); selectView(view.id); }
  function move(issue: PmIssue, state: string) {
    const target = config.states.find((item) => item.key === state)!;
    // Existing canonical destinations keep working for older clients too.
    const body = state === target.category ? { status: target.category } : { workflow_state: state };
    onPatch(issue, body, { workflow_state: state, workflow_name: target.name, status: target.category });
  }
  function sameLane(first: PmIssue, second: PmIssue) {
    return settings.group_by === "assignee" ? first.assignee_id === second.assignee_id : settings.group_by === "epic" ? first.parent_id === second.parent_id : settings.group_by === "priority" ? first.priority === second.priority : true;
  }
  function rank(issue: PmIssue, direction: number) {
    const column = columns.find((item) => item.states.includes(stateKey(issue)));
    const ordered = cards.filter((item) => sameLane(item, issue) && column?.states.includes(stateKey(item))).sort((a, b) => a.rank - b.rank);
    const index = ordered.findIndex((item) => item.id === issue.id), target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const value = direction < 0 ? rankBetween(ordered[target - 1]?.rank, ordered[target].rank) : rankBetween(ordered[target].rank, ordered[target + 1]?.rank);
    onPatch(issue, { rank: value }, { rank: value });
  }
  function place(issue: PmIssue, state: string, before?: PmIssue) {
    const column = columns.find((item) => item.states.includes(state));
    const ordered = cards.filter((item) => sameLane(item, issue) && item.id !== issue.id && column?.states.includes(stateKey(item))).sort((a, b) => a.rank - b.rank);
    const index = before ? ordered.findIndex((item) => item.id === before.id) : ordered.length;
    const value = rankBetween(ordered[index - 1]?.rank, ordered[index]?.rank);
    const target = config.states.find((item) => item.key === state)!;
    const body = stateKey(issue) === state ? { rank: value } : { rank: value, ...(state === target.category ? { status: target.category } : { workflow_state: state }) };
    onPatch(issue, body, { rank: value, workflow_state: state, workflow_name: target.name, status: target.category });
  }
  async function remove() {
    if (!current) return;
    setMutation({ busy: true, error: "" });
    try { await api(`/api/pm/views/${current.id}`, { method: "DELETE" }); setDeleting(false); setParams((old) => { const next = new URLSearchParams(old); next.delete("view"); return next; }); void views.refresh(); setMutation({ busy: false, error: "" }); }
    catch (cause) { setMutation({ busy: false, error: pmError(cause) }); }
  }
  const groups = settings.group_by === "none" || !cards.length ? [{ key: "all", label: "", items: cards }] : [...new Set(cards.map((issue) => settings.group_by === "assignee" ? issue.assignee_id ?? "none" : settings.group_by === "epic" ? issue.parent_id ?? "none" : issue.priority))].map((key) => {
    const sample = cards.find((issue) => (settings.group_by === "assignee" ? issue.assignee_id ?? "none" : settings.group_by === "epic" ? issue.parent_id ?? "none" : issue.priority) === key)!;
    return { key, label: settings.group_by === "assignee" ? sample.assignee_name ?? "Unassigned" : settings.group_by === "epic" ? sample.parent?.summary ?? "Without an epic" : ISSUE_PRIORITIES.find((item) => item.value === key)?.label ?? key,
      items: cards.filter((issue) => (settings.group_by === "assignee" ? issue.assignee_id ?? "none" : settings.group_by === "epic" ? issue.parent_id ?? "none" : issue.priority) === key) };
  });
  const daysLeft = activeSprint?.end_date ? differenceInCalendarDays(parseISO(activeSprint.end_date), new Date()) : null;
  if (views.error) return <ErrorState message={views.error} onRetry={views.reload} />;
  if (!views.data) return <Loading />;
  if (selectedId && !current) return <Empty message="This view is not available" hint="It may have been deleted or your access has changed." />;
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="w-full min-w-0 sm:w-72"><FilterSelect id="pm-current-board" label="Board or saved view" value={current?.id ?? ""} options={views.data.length ? views.data.map((view) => ({ value: view.id, label: view.name })) : [{ value: "", label: "Team board" }]} onChange={selectView} /></div>
      <div className="flex gap-2">
        {project.my_role === "admin" && editable && <Button variant="outline" onClick={() => setDialog("new")}><Plus data-icon="inline-start" />Create board</Button>}
        {current && <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="View actions" />}><Settings2 /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>
          {current.can_manage && project.status === "active" && <DropdownMenuItem onClick={() => setDialog("edit")}><Settings2 />Configure view</DropdownMenuItem>}
          {project.status === "active" && <DropdownMenuItem onClick={() => setDialog("copy")}><Copy />Duplicate view</DropdownMenuItem>}
          {current.can_manage && project.status === "active" && <DropdownMenuItem onClick={() => setDeleting(true)}><Trash2 />Delete view</DropdownMenuItem>}
        </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
      </div>
    </div>
    {mutation.error && <Alert variant="destructive" role="alert"><AlertDescription>{mutation.error}</AlertDescription></Alert>}
    {settings.layout !== "board" ? <IssueExplorer key={current?.id} project={project} members={members} issues={issues} sprints={sprints} view={current} onViewSaved={saved} onChanged={onChanged} /> : scrum && !activeSprint ? <div className="flex flex-col gap-3 border border-border bg-card p-5">
      <h2 className="font-semibold">No active sprint</h2><p className="text-sm text-muted-foreground">{issues.length ? "Your issues are ready to plan. Open the backlog to create and start a sprint." : "Create or import issues, add your team, then plan your first sprint."}</p>
      <Button variant="outline" className="self-start" onClick={onBacklog}>Open backlog</Button>
    </div> : <>
      {scrum && activeSprint && <div className="flex flex-col gap-2 border border-border bg-card p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><p className="font-semibold">{activeSprint.name}</p><p className="text-xs text-muted-foreground">{activeSprint.start_date} – {activeSprint.end_date} · {daysLeft !== null ? `${daysLeft >= 0 ? daysLeft : -daysLeft} days ${daysLeft >= 0 ? "left" : "overdue"} · ` : ""}{activeSprint.done_points} of {activeSprint.points} points done</p>{activeSprint.goal && <p className="text-sm">Goal: {activeSprint.goal}</p>}</div>
        {project.my_role === "admin" && editable && <Button variant="outline" onClick={() => onComplete(activeSprint)}><SquareCheckBig data-icon="inline-start" />Complete sprint</Button>}
      </div>}
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-full min-w-0 sm:max-w-xs"><FieldLabel htmlFor="pm-board-search">Search board</FieldLabel><Input id="pm-board-search" value={filters.q} placeholder="Summary or issue key" onChange={(event) => setFilters({ ...filters, q: event.target.value })} /></Field>
        <Toggle variant="outline" pressed={filters.assignee === "me"} onPressedChange={(checked) => setFilters({ ...filters, assignee: checked ? "me" : "" })}>Only my issues</Toggle>
      </div>
      <Collapsible className="border border-border"><CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start" />}><Filter data-icon="inline-start" />More filters</CollapsibleTrigger><CollapsibleContent className="border-t border-border p-4"><WorkspaceFilters filters={filters} members={members} issues={issues} sprints={sprints} onChange={setFilters} /></CollapsibleContent></Collapsible>
      {!scrum && <p className="text-xs text-muted-foreground">Done shows work finished in the last 14 days.</p>}
      {groups.map((group, index) => <section key={group.key} className="flex min-w-0 flex-col gap-3" aria-label={group.label || "Board"}>{group.label && <h2 className="border-b border-border pb-2 text-sm font-semibold">{group.label} · {group.items.length}</h2>}
        <IssueBoard project={project} issues={group.items} editable={editable} busy={busy} columns={columns} properties={settings.properties} laneLabel={group.label} showInstructions={index === 0}
          wipCounts={Object.fromEntries(columns.map((column) => [column.key, cards.filter((issue) => column.states.includes(stateKey(issue))).length]))}
          onMove={(issue, status) => move(issue, status)} onStateMove={move} onRank={settings.order_by === "rank" ? rank : undefined}
          onPlace={current && settings.order_by === "rank" ? place : undefined}
          onCreate={(state) => onCreate({ workflow_state: state, ...(scrum && activeSprint ? { sprint_id: activeSprint.id } : {}) })} />
      </section>)}
      {!cards.length && <p role="status" className="text-sm text-muted-foreground">No issues match this board's filters.</p>}
    </>}
    {dialog && <ViewDialog project={project} view={dialog === "new" ? undefined : current} duplicate={dialog === "copy"} initial={dialog === "new" ? undefined : { ...settings, filters }} members={members} issues={issues} sprints={sprints} onClose={() => setDialog(null)} onSaved={saved} />}
    <AlertDialog open={deleting} onOpenChange={(open) => !open && !mutation.busy && setDeleting(false)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {current?.name}?</AlertDialogTitle><AlertDialogDescription>Only this saved configuration is deleted. Issues, sprints and history remain available.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" onClick={() => setDeleting(false)} disabled={mutation.busy}>Cancel</Button><Button variant="destructive" disabled={mutation.busy} onClick={() => void remove()}>Delete view</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
