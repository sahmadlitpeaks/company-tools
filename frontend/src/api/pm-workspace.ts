import { ISSUE_STATUSES, type IssueStatus, type IssueType, type PmIssue } from "./pm";

export interface WorkflowState {
  key: string; name: string; category: IssueStatus; allowed_next: string[] | null;
}
export interface CustomField {
  key: string; name: string; kind: "text" | "number" | "date" | "select" | "checkbox"; required: boolean; options: string[];
}
export interface ProjectComponent { key: string; name: string; lead_id: string | null }
export interface IssueTemplate { key: string; name: string; issue_type: Exclude<IssueType, "subtask">; description: string; priority: string }
export interface WorkspaceConfig {
  states: WorkflowState[]; fields: CustomField[]; components: ProjectComponent[]; templates: IssueTemplate[];
}
export const DEFAULT_CONFIG: WorkspaceConfig = {
  states: ISSUE_STATUSES.map((state) => ({ key: state.value, name: state.label, category: state.value, allowed_next: null })),
  fields: [], components: [], templates: [],
};
export interface ViewFilters {
  q: string; issue_type: string; status: string; workflow_state: string; priority: string; assignee: string;
  parent_id: string; sprint: string; label: string; component: string; due_after: string; due_before: string; project_ids: string[];
}
export const EMPTY_FILTERS: ViewFilters = {
  q: "", issue_type: "", status: "", workflow_state: "", priority: "", assignee: "", parent_id: "",
  sprint: "", label: "", component: "", due_after: "", due_before: "", project_ids: [],
};
export type ViewLayout = "board" | "list" | "table" | "calendar";
export type CardProperty = "assignee" | "priority" | "points" | "due" | "labels" | "component";
export interface BoardColumn { key: string; name: string; states: string[]; limit: number | null }
export interface ViewSettings {
  layout: ViewLayout; board_type: "scrum" | "kanban"; filters: ViewFilters;
  group_by: "none" | "assignee" | "epic" | "priority"; order_by: "rank" | "updated" | "created" | "due" | "priority";
  properties: CardProperty[]; columns: BoardColumn[];
}
export interface PmView {
  id: string; project_id: string | null; owner_id: string; name: string; visibility: "team" | "private";
  settings: ViewSettings; can_manage: boolean;
}
export function defaultSettings(scrum = true): ViewSettings {
  return { layout: "board", board_type: scrum ? "scrum" : "kanban", filters: { ...EMPTY_FILTERS },
    group_by: "none", order_by: "rank", properties: ["assignee", "priority", "points"], columns: [] };
}
export interface IssuePage { items: PmIssue[]; total: number; offset: number; limit: number }
export function issueParams(filters: ViewFilters, extras: Record<string, string> = {}) {
  const query = new URLSearchParams(extras);
  for (const [key, value] of Object.entries(filters)) {
    if (key === "project_ids") for (const id of value as string[]) query.append(key, id);
    else if (value) query.set(key, value as string);
  }
  return query.toString();
}
export function stateKey(issue: PmIssue) { return issue.workflow_state || issue.status; }
export function resolvedColumns(settings: ViewSettings, config: WorkspaceConfig): BoardColumn[] {
  if (!settings.columns.length) return config.states.map((state) => ({ key: state.key, name: state.name, states: [state.key], limit: null }));
  // New project states remain visible on older saved boards.
  const states = new Set(config.states.map((state) => state.key));
  const columns = settings.columns.map((column) => ({ ...column, states: column.states.filter((key) => states.has(key)) })).filter((column) => column.states.length);
  const mapped = new Set(columns.flatMap((column) => column.states));
  const keys = new Set(columns.map((column) => column.key));
  for (const state of config.states.filter((item) => !mapped.has(item.key))) {
    let key = state.key;
    for (let suffix = 1; keys.has(key); suffix++) key = `${state.key.slice(0, 58)}_${suffix}`;
    keys.add(key);
    columns.push({ key, name: state.name, states: [state.key], limit: null });
  }
  return columns;
}
export function filterIssues(issues: PmIssue[], filters: ViewFilters, userId?: string) {
  const needle = filters.q.trim().toLowerCase();
  return issues.filter((issue) =>
    (!needle || issue.summary.toLowerCase().includes(needle) || issue.key.toLowerCase() === needle) &&
    (!filters.issue_type || filters.issue_type.split(",").includes(issue.issue_type)) &&
    (!filters.status || filters.status.split(",").includes(issue.status)) &&
    (!filters.workflow_state || stateKey(issue) === filters.workflow_state) &&
    (!filters.priority || filters.priority.split(",").includes(issue.priority)) &&
    (!filters.assignee || (filters.assignee === "me" ? issue.assignee_id === userId : filters.assignee === "none" ? !issue.assignee_id : issue.assignee_id === filters.assignee)) &&
    (!filters.parent_id || issue.parent_id === filters.parent_id) &&
    (!filters.label || issue.labels?.includes(filters.label)) &&
    (!filters.component || issue.component === filters.component) &&
    (!filters.sprint || (filters.sprint === "backlog" ? !issue.sprint_id : issue.sprint_id === filters.sprint)) &&
    (!filters.due_after || Boolean(issue.due_date && issue.due_date >= filters.due_after)) &&
    (!filters.due_before || Boolean(issue.due_date && issue.due_date <= filters.due_before)));
}
