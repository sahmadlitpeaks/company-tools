import { useState } from "react";
import { closestCenter, pointerWithin, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import type { BoardTask } from "@/api/tasks";
import { TASK_STATUSES } from "@/api/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskCard } from "./TaskCard";

const statusCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.code)) return;
  event.preventDefault();
  const current = context.over && context.droppableRects.get(context.over.id);
  const moving = context.collisionRect;
  if (!current || !moving) return;
  const horizontal = event.code === "ArrowRight" || event.code === "ArrowLeft";
  const positive = event.code === "ArrowRight" || event.code === "ArrowDown";
  const candidates = [...context.droppableRects.values()].filter((rect) => {
    const delta = horizontal ? rect.left - current.left : rect.top - current.top;
    return positive ? delta > 1 : delta < -1;
  }).sort((a, b) => {
    const distance = (rect: typeof a) => horizontal
      ? Math.abs(rect.left - current.left) + Math.abs(rect.top - current.top) * 3
      : Math.abs(rect.top - current.top) + Math.abs(rect.left - current.left) * 3;
    return distance(a) - distance(b);
  });
  const next = candidates[0];
  if (!next) return;
  return { x: currentCoordinates.x + next.left + next.width / 2 - (moving.left + moving.width / 2),
    y: currentCoordinates.y + next.top + next.height / 2 - (moving.top + moving.height / 2) };
};

type Props = {
  onDragging?: (dragging: boolean) => void;
  tasks: BoardTask[]; busy: string | null; onOpen: (task: BoardTask) => void;
  onStatus: (task: BoardTask, status: string) => Promise<void>; onDelete: (task: BoardTask) => void;
};
function DraggableTask({ task, busy, onOpen, onStatus, onDelete }: Omit<Props, "tasks"> & { task: BoardTask }) {
  const disabled = Boolean(busy) || task.can_change_status === false;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: task.id, disabled });
  // Base UI prevents Space during button keydown; activate the keyboard sensor
  // in capture phase before that native-button handling.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  const handle = <Button ref={setActivatorNodeRef} variant="ghost" size="icon" className="touch-none shrink-0" disabled={disabled}
    {...attributes} {...pointerListeners} onKeyDownCapture={(event) => onKeyDown?.(event)} aria-label={`Move task: ${task.title}`}><GripVertical /></Button>;
  return <div ref={setNodeRef} className={isDragging ? "opacity-40" : undefined}>
    <TaskCard task={task} busy={Boolean(busy)} dragHandle={handle} onOpen={() => onOpen(task)}
      onStatus={(status) => void onStatus(task, status).catch(() => undefined)} onDelete={() => onDelete(task)} />
  </div>;
}
function StatusColumn({ status, label, children, count }: { status: string; label: string; children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return <section ref={setNodeRef} aria-label={`Tasks for ${label}`} className={`min-w-0 min-h-32 space-y-3 border border-border p-3 ${isOver ? "bg-accent ring-2 ring-ring" : "bg-muted/30"}`}>
    <div className="flex items-center justify-between gap-2 border-b border-border pb-2"><h2 className="break-words font-semibold">{label}</h2><Badge variant="secondary">{count}</Badge></div>
    {count === 0 && <p className="text-sm text-muted-foreground">Drop a task here.</p>}{children}
  </section>;
}
export function TaskBoard(props: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: statusCoordinates }));
  const active = props.tasks.find((task) => task.id === activeId);
  function drop(event: DragEndEvent) {
    setActiveId(null); props.onDragging?.(false);
    const task = props.tasks.find((item) => item.id === event.active.id);
    const status = TASK_STATUSES.find((item) => item.value === event.over?.id)?.value;
    if (task && status && !props.busy && task.can_change_status !== false) void props.onStatus(task, status).catch(() => undefined);
  }
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Use the handle to move cards, or choose Status. Keyboard: Space to pick up, arrows to move, Space to drop; Escape cancels.</p>
    <DndContext sensors={sensors} collisionDetection={(args) => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)} onDragStart={({ active: item }) => { setActiveId(String(item.id)); props.onDragging?.(true); }} onDragCancel={() => { setActiveId(null); props.onDragging?.(false); }} onDragEnd={drop}
      accessibility={{ screenReaderInstructions: { draggable: "Press Space to pick up a task. Use arrow keys to move to a status column, then Space to drop. Press Escape to cancel." },
        announcements: {
          onDragStart: () => "Task picked up. Move to a status column.",
          onDragOver: ({ over }) => over ? `Over ${TASK_STATUSES.find((item) => item.value === over.id)?.label ?? "a status column"}.` : "Outside a status column.",
          onDragEnd: ({ over }) => over ? "Task dropped. Saving status." : "Move cancelled.",
          onDragCancel: () => "Move cancelled.",
        } }}>
      <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {TASK_STATUSES.map((status) => {
          const tasks = props.tasks.filter((task) => task.status === status.value);
          return <StatusColumn key={status.value} status={status.value} label={status.label} count={tasks.length}>
            {tasks.map((task) => <DraggableTask key={task.id} task={task} busy={props.busy} onOpen={props.onOpen} onStatus={props.onStatus} onDelete={props.onDelete} />)}
          </StatusColumn>;
        })}
      </div>
      <DragOverlay dropAnimation={null}>{active && <div className="max-w-sm border border-border bg-card p-4 font-semibold text-card-foreground">{active.title}</div>}</DragOverlay>
    </DndContext>
  </div>;
}
