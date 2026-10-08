import { useState, type ReactNode } from "react";
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { ISSUE_PRIORITIES, ISSUE_STATUSES, issueLink, labelOf, type IssueStatus, type PmIssue, type PmProject } from "@/api/pm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IssueTypeIcon, pointsLabel } from "./IssueBits";

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
};

/** Jira-style board: one column per workflow status; drag a card to move it. */
export function IssueBoard({ project, issues, editable, busy, onMove, linkIssues = true }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates }),
  );
  const active = issues.find((issue) => issue.id === activeId);

  function drop(event: DragEndEvent) {
    setActiveId(null);
    const issue = issues.find((item) => item.id === event.active.id);
    const status = ISSUE_STATUSES.find((item) => item.value === event.over?.id)?.value;
    if (issue && status && status !== issue.status) onMove(issue, status);
  }

  return <div className="flex flex-col gap-3">
    {editable && <p className="text-sm text-muted-foreground">
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
          onDragOver: ({ over }) => over ? `Over ${labelOf(ISSUE_STATUSES, over.id as IssueStatus)}.` : "Outside a status column.",
          onDragEnd: ({ over }) => over ? "Issue dropped. Saving status." : "Move cancelled.",
          onDragCancel: () => "Move cancelled.",
        },
      }}
    >
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ISSUE_STATUSES.map((status) => {
          const column = issues.filter((issue) => issue.status === status.value);
          const points = column.reduce((sum, issue) => sum + (issue.story_points ?? 0), 0);
          return <Column key={status.value} status={status.value} label={status.label} count={column.length} points={points}>
            {column.map((issue) => <BoardCard key={issue.id} project={project} issue={issue} disabled={!editable || Boolean(busy)} saving={busy === issue.id} linked={linkIssues} />)}
          </Column>;
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {active && <div className="max-w-xs border border-border bg-card p-3 text-sm font-medium text-card-foreground shadow-lg">{active.key} {active.summary}</div>}
      </DragOverlay>
    </DndContext>
  </div>;
}

function Column({ status, label, count, points, children }: { status: IssueStatus; label: string; count: number; points: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return <section ref={setNodeRef} aria-label={`${label} column`}
    className={`flex min-h-32 min-w-0 flex-col gap-2 border border-border p-2 ${isOver ? "bg-accent ring-2 ring-ring" : "bg-muted/30"}`}>
    <div className="flex items-center justify-between gap-2 px-1 pb-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h2>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Badge variant="outline">{count}</Badge>
        {points > 0 && <span>{pointsLabel(points)} pts</span>}
      </span>
    </div>
    {count === 0 && <p className="px-1 text-sm text-muted-foreground">No issues.</p>}
    {children}
  </section>;
}

function BoardCard({ project, issue, disabled, saving, linked }: { project: Pick<PmProject, "key">; issue: PmIssue; disabled: boolean; saving: boolean; linked: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: issue.id, disabled });
  // Base UI swallows Space on buttons; hand the key to the sensor first.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  return <article ref={setNodeRef} aria-label={`${issue.key} ${issue.summary}`}
    className={`flex flex-col gap-2 border border-border bg-card p-3 text-sm ${isDragging ? "opacity-40" : ""} ${saving ? "opacity-60" : ""} ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
    onPointerDown={(event) => {
      // Mouse drags from anywhere except controls; touch uses the handle so scrolling still works.
      if (!disabled && event.pointerType === "mouse" && event.target instanceof Element && !event.target.closest("button, a")) pointerListeners.onPointerDown?.(event);
    }}>
    <div className="flex items-start gap-2">
      {linked
        ? <Link to={issueLink(project.key, issue.key)} className="min-w-0 flex-1 break-words font-medium underline-offset-4 hover:underline">{issue.summary}</Link>
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
        {issue.priority !== "medium" && <span>{labelOf(ISSUE_PRIORITIES, issue.priority)}</span>}
        {issue.story_points !== null && <Badge variant="outline">{pointsLabel(issue.story_points)}</Badge>}
        <span className="max-w-24 truncate" title={issue.assignee_name ?? "Unassigned"}>{issue.assignee_name ?? "Unassigned"}</span>
      </span>
    </div>
  </article>;
}
