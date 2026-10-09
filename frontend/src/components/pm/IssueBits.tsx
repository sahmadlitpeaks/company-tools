import { Bookmark, Bug, CheckSquare, GitCommitVertical, Zap, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ISSUE_STATUSES, ISSUE_TYPES, labelOf, statusVariant, type IssueStatus, type IssueType } from "@/api/pm";

const TYPE_ICON: Record<IssueType, { icon: LucideIcon; className: string }> = {
  epic: { icon: Zap, className: "text-primary" },
  story: { icon: Bookmark, className: "text-success" },
  task: { icon: CheckSquare, className: "text-info" },
  bug: { icon: Bug, className: "text-destructive" },
  subtask: { icon: GitCommitVertical, className: "text-muted-foreground" },
};

/** The Jira-style type glyph, with its name for screen readers. */
export function IssueTypeIcon({ type, className }: { type: IssueType; className?: string }) {
  const entry = TYPE_ICON[type];
  const Icon = entry.icon;
  return <span className={cn("inline-flex shrink-0", entry.className, className)} title={labelOf(ISSUE_TYPES, type)}>
    <Icon className="size-4" aria-hidden="true" />
    <span className="sr-only">{labelOf(ISSUE_TYPES, type)}</span>
  </span>;
}

export function StatusBadge({ status, label }: { status: IssueStatus; label?: string | null }) {
  return <Badge variant={statusVariant(status)}>{label || labelOf(ISSUE_STATUSES, status)}</Badge>;
}

export function pointsLabel(points: number | null) {
  return points === null || points === undefined ? "–" : Number.isInteger(points) ? String(points) : points.toFixed(1);
}
