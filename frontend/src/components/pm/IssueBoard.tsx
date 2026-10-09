import { useIssueHref } from "./useIssueHref";
import { useState, type ReactNode } from "react";
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, labelOf, type IssueStatus, type PmIssue, type PmProject } from "@/api/pm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IssueTypeIcon, pointsLabel } from "./IssueBits";
import { stateKey, type BoardColumn, type CardProperty } from "@/api/pm-workspace";
import { Plus, ArrowUp, ArrowDown } from "lucide-react";
import { useWorkspace } from "./WorkspaceContext";

/** Arrow keys jump between status columns instead of nudging pixels. */
const columnCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.code)) return;
  event.preventDefault();
  const current = context.over && context.droppableRects.get(context.over.id);
  const moving = context.collisionRect;
  if (!current || !moving) return;
  const horizontal = event.code === "ArrowRight" || event.code === "ArrowLeft";
  const positive = event.code === "ArrowRight" || event.code === "ArrowDown";
  const next = [...context.droppableRects.values()]
    .filter((rect) => {
      const delta = horizontal ? rect.left - current.left : rect.top - current.top;
      return positive ? delta > 1 : delta < -1;
    })
    .sort((a, b) => {
      const distance = (rect: typeof a) => horizontal
        ? Math.abs(rect.left - current.left) + Math.abs(rect.top - current.top) * 3
        : Math.abs(rect.top - current.top) + Math.abs(rect.left - current.left) * 3;
      return distance(a) - distance(b);
    })[0];
  if (!next) return;
  return {
    x: currentCoordinates.x + next.left + next.width / 2 - (moving.left + moving.width / 2),
    y: currentCoordinates.y + next.top + next.height / 2 - (moving.top + moving.height / 2),
  };
};

type Props = {
  project: Pick<PmProject, "key">;
  issues: PmIssue[];
  editable: boolean;
  busy: string | null;
  onMove: (issue: PmIssue, status: IssueStatus) => void;
  /** False on shared, read-only boards: summaries are plain text, not issue links. */
  linkIssues?: boolean;
  columns?: BoardColumn[];
  properties?: CardProperty[];
  onStateMove?: (issue: PmIssue, state: string) => void;
  onRank?: (issue: PmIssue, direction: number) => void;
  onCreate?: (state: string) => void;
  laneLabel?: string;
  wipCounts?: Record<string, number>;
  onPlace?: (issue: PmIssue, state: string, before?: PmIssue) => void;
  showInstructions?: boolean;
};

/** Jira-style board: one column per workflow status; drag a card to move it. */
export function IssueBoard({ project, issues, editable, busy, onMove, linkIssues = true, columns, properties, onStateMove, onRank, onCreate, laneLabel, wipCounts, onPlace, showInstructions = true }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates }),
  );
  const active = issues.find((issue) => issue.id === activeId);
  const visibleColumns = columns ?? ISSUE_STATUSES.map((state) => ({ key: state.value, name: state.label, states: [state.value], limit: null }));

  function drop(event: DragEndEvent) {
    setActiveId(null);
    const issue = issues.find((item) => item.id === event.active.id);
    const before = issues.find((item) => `position-${item.id}` === event.over?.id);
    const column = visibleColumns.find((item) => item.key === event.over?.id || before && item.states.includes(stateKey(before)));
    if (!issue || !column || before?.id === issue.id) return;
    if (onPlace) { onPlace(issue, column.states.includes(stateKey(issue)) ? stateKey(issue) : column.states[0], before); return; }
    if (column.states.includes(stateKey(issue))) return;
    if (onStateMove) onStateMove(issue, column.states[0]);
    else onMove(issue, column.states[0] as IssueStatus);
  }

  return <div className="flex flex-col gap-3">
    {editable && showInstructions && <p className="text-sm text-muted-foreground">
      Drag a card, or its handle on a phone, to change status. Keyboard: Space to pick up, arrows to choose a column, Space to drop, Escape to cancel.
    </p>}
    <DndContext
      sensors={sensors}
      collisionDetection={(args) => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)}
      onDragStart={({ active: item }) => setActiveId(String(item.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={drop}
      accessibility={{
        screenReaderInstructions: { draggable: "Press Space to pick up an issue. Use the arrow keys to choose a status column, then Space to drop. Press Escape to cancel." },
        announcements: {
          onDragStart: () => "Issue picked up. Move to a status column.",
          onDragOver: ({ over }) => over ? `Over ${visibleColumns.find((column) => column.key === over.id)?.name ?? over.id}.` : "Outside a status column.",
          onDragEnd: ({ over }) => over ? "Issue dropped. Saving status." : "Move cancelled.",
          onDragCancel: () => "Move cancelled.",
        },
      }}
    >
      <div className="min-w-0 overflow-x-auto"><div className="grid items-start gap-3 md:auto-cols-[minmax(14rem,1fr)] md:grid-flow-col md:grid-cols-none">
        {visibleColumns.map((status) => {
          const column = issues.filter((issue) => status.states.includes(stateKey(issue)));
          const points = column.reduce((sum, issue) => sum + (issue.story_points ?? 0), 0);
          return <Column key={status.key} status={status.key} label={status.name} count={column.length} points={points} limit={status.limit} laneLabel={laneLabel} wipCount={wipCounts?.[status.key]}>
            {column.map((issue, index) => <BoardCard key={issue.id} project={project} issue={issue} disabled={!editable || Boolean(busy)} saving={busy === issue.id} linked={linkIssues} properties={properties}
              sortable={Boolean(onPlace)} onRank={onRank ? (direction) => onRank(issue, direction) : undefined} first={index === 0} last={index === column.length - 1} />)}
            {editable && onCreate && <Button variant="ghost" className="w-full justify-start" disabled={Boolean(busy)} aria-label={`Create issue in ${status.name}`} onClick={() => onCreate(status.states[0])}><Plus data-icon="inline-start" />Create issue</Button>}
          </Column>;
        })}
      </div></div>
      <DragOverlay dropAnimation={null}>
        {active && <div className="max-w-xs border border-border bg-card p-3 text-sm font-medium text-card-foreground shadow-lg">{active.key} {active.summary}</div>}
      </DragOverlay>
    </DndContext>
  </div>;
}

function Column({ status, label, count, points, children, limit, laneLabel, wipCount = count }: { status: string; label: string; count: number; points: number; children: ReactNode; limit?: number | null; laneLabel?: string; wipCount?: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return <section ref={setNodeRef} aria-label={`${laneLabel ? `${laneLabel} · ` : ""}${label} column`}
    className={`flex min-h-32 min-w-0 flex-col gap-2 border border-border p-2 ${isOver ? "bg-accent ring-2 ring-ring" : "bg-muted/30"}`}>
    <div className="flex items-center justify-between gap-2 px-1 pb-1">
      <h2 className="min-w-0 break-words text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Badge variant="outline">{count}</Badge>
        {limit && <Badge variant={wipCount > limit ? "warning" : "outline"}>WIP {wipCount} / {limit}</Badge>}
        {points > 0 && <span>{pointsLabel(points)} pts</span>}
      </span>
    </div>
    {count === 0 && <p className="px-1 text-sm text-muted-foreground">No issues.</p>}
    {children}
  </section>;
}

function BoardCard({ project, issue, disabled, saving, linked, properties, onRank, first, last, sortable }: { project: Pick<PmProject, "key">; issue: PmIssue; disabled: boolean; saving: boolean; linked: boolean; properties?: CardProperty[]; onRank?: (direction: number) => void; first?: boolean; last?: boolean; sortable?: boolean }) {
  const issueHref = useIssueHref();
  const config = useWorkspace();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: issue.id, disabled });
  const { setNodeRef: setDropRef } = useDroppable({ id: `position-${issue.id}`, disabled: disabled || !sortable });
  // Base UI swallows Space on buttons; hand the key to the sensor first.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  return <article ref={(node) => { setNodeRef(node); setDropRef(node); }} aria-label={`${issue.key} ${issue.summary}`}
    className={`flex flex-col gap-2 border border-border bg-card p-3 text-sm ${isDragging ? "opacity-40" : ""} ${saving ? "opacity-60" : ""} ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
    onPointerDown={(event) => {
      // Mouse drags from anywhere except controls; touch uses the handle so scrolling still works.
      if (!disabled && event.pointerType === "mouse" && event.target instanceof Element && !event.target.closest("button, a")) pointerListeners.onPointerDown?.(event);
    }}>
    <div className="flex items-start gap-2">
      {linked
        ? <Link to={issueHref(project.key, issue.key)} className="min-w-0 flex-1 break-words font-medium underline-offset-4 hover:underline">{issue.summary}</Link>
        : <span className="min-w-0 flex-1 break-words font-medium">{issue.summary}</span>}
      {!disabled && <Button ref={setActivatorNodeRef} variant="ghost" size="icon-sm" className="-m-1 shrink-0 touch-none"
        {...attributes} {...pointerListeners} onKeyDownCapture={(event) => onKeyDown?.(event)} aria-label={`Move issue: ${issue.key}`}>
        <GripVertical />
      </Button>}
    </div>
    {issue.parent && issue.parent.issue_type === "epic" && <Badge variant="secondary" className="max-w-full truncate">{issue.parent.summary}</Badge>}
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <IssueTypeIcon type={issue.issue_type} />
      <span>{issue.key}</span>
      {issue.child_count > 0 && <span>· {issue.child_done}/{issue.child_count} sub-tasks</span>}
      <span className="ml-auto flex items-center gap-2">
        {(!properties || properties.includes("priority")) && issue.priority !== "medium" && <span>{labelOf(ISSUE_PRIORITIES, issue.priority)}</span>}
        {(!properties || properties.includes("points")) && issue.story_points !== null && <Badge variant="outline">{pointsLabel(issue.story_points)}</Badge>}
        {(!properties || properties.includes("assignee")) && <span className="max-w-24 truncate" title={issue.assignee_name ?? "Unassigned"}>{issue.assignee_name ?? "Unassigned"}</span>}
      </span>
    </div>
    {properties?.includes("due") && issue.due_date && <p className="text-xs text-muted-foreground">Due {issue.due_date}</p>}
    {properties?.includes("labels") && <div className="flex flex-wrap gap-1">{issue.labels?.map((label) => <Badge key={label} variant="outline">{label}</Badge>)}</div>}
    {properties?.includes("component") && issue.component && <p className="text-xs text-muted-foreground">Component: {config.components.find((item) => item.key === issue.component)?.name ?? issue.component}</p>}
    {onRank && !disabled && <div className="flex gap-1"><Button size="icon-sm" variant="ghost" aria-label={`Move ${issue.key} up`} disabled={first} onClick={() => onRank(-1)}><ArrowUp /></Button><Button size="icon-sm" variant="ghost" aria-label={`Move ${issue.key} down`} disabled={last} onClick={() => onRank(1)}><ArrowDown /></Button></div>}
  </article>;
}
