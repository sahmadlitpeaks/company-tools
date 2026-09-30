import type { ReactNode } from "react";
import { CalendarClock, FileText, Mail, MessageSquare, Repeat, Trash2, UserRound } from "lucide-react";
import type { BoardTask } from "@/api/tasks";
import { dateLabel, daysUntil, TASK_STATUSES } from "@/api/tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskChoice } from "./TaskChoice";

const EMAIL_LABELS: Record<string, string> = { pending: "Assignment email queued", sent: "Assignment email sent", failed: "Assignment email failed", cancelled: "Assignment email cancelled" };
export function TaskCard({ task, busy, onOpen, onStatus, onDelete, dragHandle }: {
  dragHandle?: ReactNode;
  task: BoardTask; busy: boolean; onOpen: () => void; onStatus: (state: string) => void; onDelete: () => void;
}) {
  const restricted = Boolean(task.access_state && task.access_state !== "ready");
  const days = daysUntil(task.due_date);
  const overdue = task.status !== "done" && days !== null && days < 0;
  return <Card size="sm" className="min-w-0" aria-label={task.title}>
    <CardHeader><CardTitle className="flex items-start gap-1">{dragHandle}<Button variant="link" className="h-auto w-full justify-start whitespace-normal break-words p-0 text-left text-base" onClick={onOpen} aria-label={`Open task: ${task.title}`}>{task.title}</Button></CardTitle>
      <div className="flex flex-wrap gap-2">
        {task.source === "compliance" && <Badge variant="info"><FileText data-icon="inline-start" />Document compliance</Badge>}
        {task.priority !== "normal" && <Badge variant={task.priority === "urgent" ? "destructive" : task.priority === "high" ? "warning" : "secondary"}>{task.priority[0].toUpperCase() + task.priority.slice(1)}</Badge>}
        {task.owner_department_id && <Badge variant="warning">Needs assignment</Badge>}
      </div>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {restricted && <p className="break-words text-sm text-muted-foreground">{task.access_message}</p>}
      {task.description && <p className="line-clamp-2 break-words text-sm text-muted-foreground">{task.description}</p>}
      <dl className="space-y-2 text-sm">
        <div className="flex items-start gap-2"><UserRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><dt className="sr-only">Owner</dt><dd className="break-words">{task.assignee_name || "Unassigned"}{task.assignee_department_name && <span className="block text-xs text-muted-foreground">{task.assignee_department_name}</span>}</dd></div>
        <div className={`flex items-center gap-2 ${overdue ? "text-destructive" : "text-muted-foreground"}`}><CalendarClock className="size-4 shrink-0" aria-hidden="true" /><dt className="sr-only">Due date</dt><dd>{restricted ? "Deadline available after access is verified" : dateLabel(task.due_date)}{overdue ? " · Overdue" : task.status !== "done" && days === 0 ? " · Today" : ""}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {task.subtasks_total > 0 && <span>{task.subtasks_done}/{task.subtasks_total} checklist items</span>}
        {task.comment_count > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" />{task.comment_count} comments</span>}
        {task.recurrence && <span className="inline-flex items-center gap-1"><Repeat className="size-3" />{task.recurrence}</span>}
      </div>
      {task.assignment_email_status && <p className={`flex items-center gap-1 text-xs ${task.assignment_email_status === "failed" ? "text-destructive" : "text-muted-foreground"}`}><Mail className="size-3" aria-hidden="true" />{EMAIL_LABELS[task.assignment_email_status] ?? "Assignment email pending"}</p>}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1"><TaskChoice id={`status-${task.id}`} label="Status" ariaLabel={`Status for ${task.title}`} value={task.status} items={TASK_STATUSES} onChange={onStatus} disabled={busy || task.can_change_status === false} /></div>
        {task.source !== "compliance" && task.can_delete !== false && <Button variant="ghost" size="icon" onClick={onDelete} disabled={busy} aria-label={`Delete task: ${task.title}`}><Trash2 /></Button>}
      </div>
    </CardContent>
  </Card>;
}
