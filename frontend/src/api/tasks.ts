import type { Task } from "./types";

export type TaskPerson = { id: string; name: string; department_id: string | null; in_team: boolean };
export type TaskOptions = { users: TaskPerson[]; departments: Array<{ id: string; name: string }> };
export type BoardTask = Task & {
  source?: "compliance";
  access_state?: string;
  access_message?: string | null;
  document_id?: string;
  document_name?: string;
  document_url?: string;
  document_expiry_date?: string | null;
  reference_number?: string | null;
  document_type?: string;
  company?: string | null;
  basis?: string;
  owner_department_id?: string | null;
  can_assign?: boolean;
  can_change_status?: boolean;
  can_delete?: boolean;
};
export type ComplianceWork = { tasks: BoardTask[]; available: boolean; message: string | null };
export const TASK_STATUSES = [
  { value: "todo", label: "To do" }, { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" }, { value: "done", label: "Done" },
];
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];
export function dateLabel(value?: string | null) {
  if (!value) return "No due date";
  const parsed = new Date(value + "T12:00:00");
  return Number.isNaN(parsed.getTime()) ? "Date needs review" :
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}
export function daysUntil(value?: string | null) {
  if (!value) return null;
  const today = new Date();
  return Math.round((Date.UTC(...[today.getFullYear(), today.getMonth(), today.getDate()] as [number, number, number]) -
    Date.parse(value + "T00:00:00Z")) / -86400000);
}
export function taskError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "The task could not be saved. Try again.";
  return ({
    reviewer_required: "Only the responsible department manager or an administrator can reassign this task.",
    task_owner_required: "Only the owner or responsible manager can change this task.",
    owner_outside_department: "Choose a member of the selected department.",
    department_required: "Choose a department.",
    department_has_no_active_member: "This department needs an active member before it can own work.",
    owner_unchanged: "Choose a different owner or department.",
    task_not_active: "This task is no longer active. Refresh the page.",
    document_changed_sync_required: "The SharePoint document changed. Wait for it to finish processing, then try again.",
    microsoft_connection_required: "Connect Microsoft in Compliance before opening this document task.",
  } as Record<string, string>)[message] ?? message;
}
