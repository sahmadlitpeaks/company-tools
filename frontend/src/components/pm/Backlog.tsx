import { useMemo, useState, type ReactNode } from "react";
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical, MoreHorizontal, Play, Plus, Search, SquareCheckBig } from "lucide-react";
import { Link } from "react-router-dom";
import { BOARD_TYPES, issueLink, rankBetween, type PmIssue, type PmProject, type PmSprint } from "@/api/pm";
import { dateLabel } from "@/api/tasks";
import { Empty } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { IssueTypeIcon, pointsLabel, StatusBadge } from "./IssueBits";

const BACKLOG = "backlog";

type Props = {
  project: PmProject;
  issues: PmIssue[];
  sprints: PmSprint[];
  canPlan: boolean;
  canManageSprints: boolean;
  busy: string | null;
  onPlan: (issue: PmIssue, sprintId: string | null, rank: number) => void;
  onCreateSprint: () => void;
  onEditSprint: (sprint: PmSprint) => void;
  onDeleteSprint: (sprint: PmSprint) => void;
  onStartSprint: (sprint: PmSprint) => void;
  onCompleteSprint: (sprint: PmSprint) => void;
};

/** Prefer the row under the pointer (to reorder) over the section around it. */
const preferRows: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args);
  const hits = pointerWithin(args);
  const rows = hits.filter((hit) => String(hit.id).startsWith("row:"));
  return rows.length ? rows : hits;
};

/** Jira-style backlog: open sprints above the backlog; drag to plan and rank. */
export function Backlog(props: Props) {
  const { project, issues, sprints, canPlan, canManageSprints } = props;
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor));
  const hasActive = sprints.some((sprint) => sprint.status === "active");

  const planned = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return issues
      .filter((issue) => BOARD_TYPES.includes(issue.issue_type))
      .filter((issue) => !needle || issue.summary.toLowerCase().includes(needle) || issue.key.toLowerCase() === needle)
      .sort((a, b) => a.rank - b.rank || a.number - b.number);
  }, [issues, query]);
  const sections: Array<{ key: string; sprint: PmSprint | null; items: PmIssue[] }> = [
    ...sprints.map((sprint) => ({ key: sprint.id, sprint, items: planned.filter((issue) => issue.sprint_id === sprint.id) })),
    // Finished work outside a sprint drops out of the backlog.
    { key: BACKLOG, sprint: null, items: planned.filter((issue) => !issue.sprint_id && issue.status !== "done") },
  ];
  const active = issues.find((issue) => issue.id === activeId);

  function place(issue: PmIssue, sectionKey: string, beforeIssue?: PmIssue) {
    const ordered = (sections.find((section) => section.key === sectionKey)?.items ?? []).filter((item) => item.id !== issue.id);
    let rank: number;
    if (beforeIssue) {
      const index = ordered.findIndex((item) => item.id === beforeIssue.id);
      rank = rankBetween(ordered[index - 1]?.rank, beforeIssue.rank);
    } else {
      rank = rankBetween(ordered[ordered.length - 1]?.rank, undefined);
    }
    props.onPlan(issue, sectionKey === BACKLOG ? null : sectionKey, rank);
  }

  function drop(event: DragEndEvent) {
    setActiveId(null);
    const issue = issues.find((item) => item.id === event.active.id);
    const overId = String(event.over?.id ?? "");
    if (!issue || !overId) return;
    if (overId.startsWith("row:")) {
      const target = issues.find((item) => `row:${item.id}` === overId);
      if (!target || target.id === issue.id) return;
      place(issue, target.sprint_id ?? BACKLOG, target);
    } else if (overId.startsWith("section:")) {
      place(issue, overId.slice("section:".length));
    }
  }

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <Field className="w-full min-w-0 sm:max-w-sm">
        <FieldLabel htmlFor="pm-backlog-search">Search backlog</FieldLabel>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="pm-backlog-search" className="pl-9" value={query} placeholder={`Summary or ${project.key}-1`} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </Field>
      {canManageSprints && <Button variant="outline" onClick={props.onCreateSprint}><Plus data-icon="inline-start" />Create sprint</Button>}
    </div>
    {canPlan && <p className="text-sm text-muted-foreground">Drag issues to plan sprints and set priority order, or use each issue's Move menu.</p>}
    <DndContext sensors={sensors} collisionDetection={preferRows} onDragStart={({ active: item }) => setActiveId(String(item.id))} onDragCancel={() => setActiveId(null)} onDragEnd={drop}
      accessibility={{
        screenReaderInstructions: { draggable: "Press Space to pick up an issue, use the arrow keys to move it over another issue or section, then Space to drop. Escape cancels. Each issue also has a Move menu." },
        announcements: {
          onDragStart: () => "Issue picked up.",
          onDragOver: ({ over }) => over ? "Over a drop position." : "Not over a drop position.",
          onDragEnd: ({ over }) => over ? "Issue dropped. Saving." : "Move cancelled.",
          onDragCancel: () => "Move cancelled.",
        },
      }}>
      {sections.map((section) => <Section key={section.key} sectionKey={section.key} title={section.sprint?.name ?? "Backlog"}
        header={section.sprint ? <SprintHeader sprint={section.sprint} canManage={canManageSprints} hasActive={hasActive} {...props} /> : null}
        count={section.items.length} points={section.items.reduce((sum, issue) => sum + (issue.story_points ?? 0), 0)}>
        {section.items.length === 0
          ? <p className="px-3 py-4 text-sm text-muted-foreground">{section.sprint ? "Plan a sprint by dragging issues here." : query ? "No backlog issues match." : "The backlog is empty."}</p>
          : <ul className="flex flex-col divide-y divide-border">
            {section.items.map((issue) => <BacklogRow key={issue.id} project={project} issue={issue} sprints={sprints} canPlan={canPlan} saving={props.busy === issue.id}
              onMove={(target) => place(issue, target)} onTop={() => place(issue, section.key, section.items.find((item) => item.id !== issue.id))} />)}
          </ul>}
      </Section>)}
      <DragOverlay dropAnimation={null}>
        {active && <div className="max-w-sm border border-border bg-card p-3 text-sm font-medium text-card-foreground shadow-lg">{active.key} {active.summary}</div>}
      </DragOverlay>
    </DndContext>
    {issues.filter((issue) => BOARD_TYPES.includes(issue.issue_type)).length === 0 &&
      <Empty message="Nothing to plan yet" hint="Create stories, tasks and bugs; they appear in the backlog ready for a sprint." />}
  </div>;
}

function Section({ sectionKey, title, header, count, points, children }: {
  sectionKey: string; title: string; header: ReactNode; count: number; points: number; children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `section:${sectionKey}` });
  return <section ref={setNodeRef} aria-label={title} className={`border border-border ${isOver ? "bg-accent ring-2 ring-ring" : "bg-card"}`}>
    <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-3 py-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{count} {count === 1 ? "issue" : "issues"} · {pointsLabel(points)} pts</span>
      </div>
      {header}
    </div>
    {children}
  </section>;
}

function SprintHeader({ sprint, canManage, hasActive, onStartSprint, onCompleteSprint, onEditSprint, onDeleteSprint }: Props & {
  sprint: PmSprint; canManage: boolean; hasActive: boolean;
}) {
  return <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    {sprint.status === "active" && <Badge variant="info">Active</Badge>}
    {(sprint.start_date || sprint.end_date) && <span>{sprint.start_date ? dateLabel(sprint.start_date) : "?"} – {sprint.end_date ? dateLabel(sprint.end_date) : "?"}</span>}
    {sprint.goal && <span className="basis-full sm:basis-auto">Goal: {sprint.goal}</span>}
    {canManage && sprint.status === "future" && <Button size="sm" variant="outline" disabled={hasActive} title={hasActive ? "Complete the active sprint first" : undefined} onClick={() => onStartSprint(sprint)}><Play data-icon="inline-start" />Start sprint</Button>}
    {canManage && sprint.status === "active" && <Button size="sm" variant="outline" onClick={() => onCompleteSprint(sprint)}><SquareCheckBig data-icon="inline-start" />Complete sprint</Button>}
    {canManage && <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`More actions for ${sprint.name}`} />}><MoreHorizontal /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onEditSprint(sprint)}>Edit sprint</DropdownMenuItem>
          {sprint.status === "future" && <DropdownMenuItem variant="destructive" onClick={() => onDeleteSprint(sprint)}>Delete sprint</DropdownMenuItem>}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}

function BacklogRow({ project, issue, sprints, canPlan, saving, onMove, onTop }: {
  project: PmProject; issue: PmIssue; sprints: PmSprint[]; canPlan: boolean; saving: boolean;
  onMove: (sectionKey: string) => void; onTop: () => void;
}) {
  const drag = useDraggable({ id: issue.id, disabled: !canPlan || saving });
  const dropTarget = useDroppable({ id: `row:${issue.id}` });
  const { onKeyDown, ...pointerListeners } = drag.listeners ?? {};
  const targets = [...sprints.filter((sprint) => sprint.id !== issue.sprint_id).map((sprint) => ({ key: sprint.id, label: sprint.name })),
    ...(issue.sprint_id ? [{ key: BACKLOG, label: "Backlog" }] : [])];
  return <li ref={(node) => { drag.setNodeRef(node); dropTarget.setNodeRef(node); }}
    className={`flex items-center gap-2 px-2 py-2 text-sm ${drag.isDragging ? "opacity-40" : ""} ${saving ? "opacity-60" : ""} ${dropTarget.isOver && !drag.isDragging ? "border-t-2 border-t-primary" : ""}`}
    onPointerDown={(event) => {
      if (canPlan && event.pointerType === "mouse" && event.target instanceof Element && !event.target.closest("button, a")) pointerListeners.onPointerDown?.(event);
    }}>
    {canPlan && <Button ref={drag.setActivatorNodeRef} variant="ghost" size="icon-sm" className="shrink-0 touch-none"
      {...drag.attributes} {...pointerListeners} onKeyDownCapture={(event) => onKeyDown?.(event)} aria-label={`Drag ${issue.key}`}><GripVertical /></Button>}
    <IssueTypeIcon type={issue.issue_type} />
    <Link to={issueLink(project.key, issue.key)} className="shrink-0 text-muted-foreground underline-offset-4 hover:underline">{issue.key}</Link>
    <Link to={issueLink(project.key, issue.key)} className="min-w-0 flex-1 truncate underline-offset-4 hover:underline">{issue.summary}</Link>
    {issue.parent?.issue_type === "epic" && <Badge variant="secondary" className="hidden max-w-40 truncate md:inline-flex">{issue.parent.summary}</Badge>}
    <span className="hidden sm:inline-flex"><StatusBadge status={issue.status} /></span>
    <span className="hidden w-28 truncate text-xs text-muted-foreground lg:inline">{issue.assignee_name ?? "Unassigned"}</span>
    <Badge variant="outline" className="shrink-0" title="Story points">{pointsLabel(issue.story_points)}</Badge>
    {canPlan && <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Move ${issue.key}`} disabled={saving} />}><MoreHorizontal /></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          {targets.map((target) => <DropdownMenuItem key={target.key} onClick={() => onMove(target.key)}>{target.label}</DropdownMenuItem>)}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onTop}>Top of {issue.sprint_id ? "sprint" : "backlog"}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(issue.sprint_id ?? BACKLOG)}>Bottom of {issue.sprint_id ? "sprint" : "backlog"}</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>}
  </li>;
}
