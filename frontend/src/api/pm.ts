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
  sprints_enabled: boolean;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  my_role: ProjectRole | null;
  issue_count: number;
  done_count: number;
  member_count: number;
  overdue_count: number;
  health: "on_track" | "at_risk" | "late";
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
  workflow_state?: string | null;
  workflow_name?: string | null;
  component?: string | null;
  custom_fields?: Record<string, string | number | boolean | null> | null;
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
  sprint_id: string | null;
  sprint_name: string | null;
  start_date: string | null;
  due_date: string | null;
  resolved_at: string | null;
  rank: number;
  external_key: string | null;
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

export interface PmSprint {
  id: string;
  project_id: string;
  name: string;
  goal: string | null;
  status: "future" | "active" | "closed";
  start_date: string | null;
  end_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  committed_points: number | null;
  completed_points: number | null;
  issue_count: number;
  done_count: number;
  points: number;
  done_points: number;
}

/** Issue types that sit in sprints and on the board; epics span sprints and sub-tasks follow their parent. */
export const BOARD_TYPES: IssueType[] = ["story", "task", "bug"];

export interface PmLinkRow {
  id: string;
  source_id: string;
  target_id: string;
  link_type: "blocks" | "relates";
}

export interface BurndownReport {
  sprint: { id: string; name: string; status: string; start_date: string; end_date: string } | null;
  total_points: number;
  days: Array<{ date: string; ideal: number; remaining: number | null }>;
}

export interface VelocityReport {
  sprints: Array<{ id: string; name: string; committed: number; completed: number }>;
  average_completed: number;
}

export interface WorkloadReport {
  weeks: string[];
  people: Array<{ user_id: string; name: string; points: number[]; issues: number[]; unscheduled: number }>;
}

export interface ActivityReport {
  weeks: string[];
  people: Array<{ user_id: string; name: string; counts: number[] }>;
  totals: number[];
}

export interface JiraPreview {
  total: number;
  already_imported: number;
  types: Array<{ name: string; count: number; imported_as: IssueType }>;
  statuses: Array<{ name: string; count: number; suggested: IssueStatus }>;
  people: Array<{ name: string; count: number; suggested_user_id: string | null; suggested_name: string | null }>;
  sprints: string[];
  comments: number;
  links: number;
  attachments: number;
  warnings: string[];
  sample: Array<{ key: string; type: IssueType; summary: string; status: string }>;
}

export interface JiraImportResult {
  created: number;
  skipped: number;
  comments: number;
  links: number;
  sprints_created: number;
  members_added: number;
  warnings: string[];
  first_key: string | null;
}

export type ShareView = "board" | "timeline" | "progress";

export interface PmShareLink {
  id: string;
  view: ShareView;
  label: string | null;
  state: "active" | "expired" | "revoked";
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by_name: string | null;
  view_count: number;
  last_viewed_at: string | null;
  /** Only present in the response that created the link. */
  token?: string;
  path?: string;
}

/** The deliberately small issue shape a public share link exposes. */
export type SharedIssue = Pick<PmIssue, "id" | "key" | "number" | "issue_type" | "summary" | "status" | "priority" | "story_points"
  | "assignee_name" | "parent_id" | "parent" | "sprint_id" | "start_date" | "due_date" | "resolved_at" | "rank" | "child_count" | "child_done">;

export interface PublicShare {
  view: ShareView;
  label: string | null;
  expires_at: string | null;
  generated_at: string;
  project: Pick<PmProject, "key" | "name" | "status" | "sprints_enabled" | "start_date" | "target_date" | "issue_count" | "done_count" | "overdue_count" | "health">;
  board?: { sprint: Pick<PmSprint, "id" | "name" | "goal" | "status" | "start_date" | "end_date"> | null; issues: SharedIssue[] };
  timeline?: { issues: SharedIssue[]; links: PmLinkRow[]; sprints: Array<Pick<PmSprint, "id" | "name" | "goal" | "status" | "start_date" | "end_date">> };
  progress?: {
    counts: Record<IssueStatus, number>;
    epics: Array<{ key: string; summary: string; status: IssueStatus; issue_count: number; done_count: number; due_date: string | null }>;
    burndown: BurndownReport | null;
    velocity: VelocityReport | null;
  };
}

export const SHARE_VIEWS: Array<{ value: ShareView; label: string; hint: string }> = [
  { value: "board", label: "Board", hint: "The active sprint's board (or current work on Kanban projects)" },
  { value: "timeline", label: "Timeline", hint: "Epics and issues on the Gantt timeline" },
  { value: "progress", label: "Progress", hint: "Health, status totals, epic progress, burndown and velocity" },
];

/** Fill the fields a shared issue doesn't carry so board and timeline components can draw it. */
export function fromShared(issue: SharedIssue, projectId = ""): PmIssue {
  return {
    ...issue, project_id: projectId, description: null, labels: null, reporter_id: null, reporter_name: null,
    assignee_id: null, sprint_name: null, external_key: null, created_at: "", updated_at: "", comment_count: 0,
  };
}

export const HEALTH: Record<PmProject["health"], { label: string; variant: "success" | "warning" | "destructive" }> = {
  on_track: { label: "On track", variant: "success" },
  at_risk: { label: "At risk", variant: "warning" },
  late: { label: "Late", variant: "destructive" },
};

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

export function issueLink(projectKey: string, issueKey: string, search = "") {
  const params = new URLSearchParams(search);
  params.set("issue", issueKey);
  return `/projects/${encodeURIComponent(projectKey)}?${params}`;
}

/** A rank that places an item between two neighbours (either may be missing). */
export function rankBetween(before?: number, after?: number) {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export function pmError(cause: unknown) {
  return cause instanceof Error ? cause.message : "The change could not be saved. Try again.";
}
