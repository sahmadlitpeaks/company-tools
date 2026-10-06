/** Types and vocabulary for the Jira-style project tracker (`/api/pm`). */

export type ProjectRole = "admin" | "member" | "viewer";
export type IssueType = "epic" | "story" | "task" | "bug" | "subtask";
export type IssueStatus = "todo" | "in_progress" | "in_review" | "done";
export type IssuePriority = "highest" | "high" | "medium" | "low" | "lowest";

export interface PmProject {
  id: string;
  key: string;
  name: string;
  description: string | null;
  lead_id: string | null;
  lead_name: string | null;
  status: "active" | "archived";
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  my_role: ProjectRole | null;
  issue_count: number;
  done_count: number;
  member_count: number;
}

export interface PmMember {
  user_id: string;
  name: string;
  email: string | null;
  role: ProjectRole;
}

export interface PmPerson {
  id: string;
  name: string;
  email: string | null;
}

export interface PmIssueRef {
  id: string;
  key: string;
  summary: string;
  issue_type: IssueType;
  status: IssueStatus;
}

export interface PmIssue {
  id: string;
  key: string;
  project_id: string;
  number: number;
  issue_type: IssueType;
  summary: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  story_points: number | null;
  labels: string[] | null;
  reporter_id: string | null;
  reporter_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  parent_id: string | null;
  parent: PmIssueRef | null;
  start_date: string | null;
  due_date: string | null;
  resolved_at: string | null;
  rank: number;
  created_at: string;
  updated_at: string;
  child_count: number;
  child_done: number;
  comment_count: number;
}

export interface PmLink {
  id: string;
  relation: "blocks" | "is_blocked_by" | "relates";
  issue: PmIssueRef;
}

export interface PmIssueDetail extends PmIssue {
  project_key: string;
  project_name: string;
  my_role: ProjectRole | null;
  watching: boolean;
  children: PmIssue[];
  links: PmLink[];
  watchers: Array<{ user_id: string; name: string }>;
}

export interface PmComment {
  id: string;
  issue_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface PmHistory {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export const ISSUE_TYPES: Array<{ value: IssueType; label: string }> = [
  { value: "epic", label: "Epic" },
  { value: "story", label: "Story" },
  { value: "task", label: "Task" },
  { value: "bug", label: "Bug" },
  { value: "subtask", label: "Sub-task" },
];

export const ISSUE_STATUSES: Array<{ value: IssueStatus; label: string }> = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
];

export const ISSUE_PRIORITIES: Array<{ value: IssuePriority; label: string }> = [
  { value: "highest", label: "Highest" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "lowest", label: "Lowest" },
];

export const PROJECT_ROLES: Array<{ value: ProjectRole; label: string; hint: string }> = [
  { value: "admin", label: "Administrator", hint: "Manages the project, its people and every issue" },
  { value: "member", label: "Member", hint: "Creates, edits and moves issues" },
  { value: "viewer", label: "Viewer", hint: "Reads and comments, for requesters and stakeholders" },
];

export const LINK_RELATIONS: Array<{ value: PmLink["relation"]; label: string }> = [
  { value: "blocks", label: "blocks" },
  { value: "is_blocked_by", label: "is blocked by" },
  { value: "relates", label: "relates to" },
];

export function labelOf<T extends string>(items: Array<{ value: T; label: string }>, value: T | null | undefined) {
  return items.find((item) => item.value === value)?.label ?? value ?? "";
}

/** Badge variant for a workflow status. */
export function statusVariant(status: IssueStatus): "outline" | "info" | "warning" | "success" {
  return status === "done" ? "success" : status === "in_review" ? "warning" : status === "in_progress" ? "info" : "outline";
}

export function canEdit(role: ProjectRole | null | undefined) {
  return role === "admin" || role === "member";
}

/** Issues that can parent an issue of `type` (epics hold issues; issues hold sub-tasks). */
export function parentCandidates(issues: PmIssue[], type: IssueType, selfId?: string) {
  if (type === "epic") return [];
  const wanted = type === "subtask" ? ["story", "task", "bug"] : ["epic"];
  return issues.filter((issue) => issue.id !== selfId && wanted.includes(issue.issue_type));
}

export function issueLink(projectKey: string, issueKey: string) {
  return `/projects/${projectKey}?issue=${issueKey}`;
}

export function pmError(cause: unknown) {
  return cause instanceof Error ? cause.message : "The change could not be saved. Try again.";
}
