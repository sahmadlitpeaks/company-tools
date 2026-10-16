export const REQUIREMENT_STATUSES = [
  { value: "draft", label: "Draft" }, { value: "ready", label: "Ready" },
  { value: "in_progress", label: "In progress" }, { value: "delivered", label: "Delivered" },
  { value: "archived", label: "Archived" },
] as const;
export type RequirementStatus = typeof REQUIREMENT_STATUSES[number]["value"];
export const REQUIREMENT_SECTIONS = [
  { key: "original_request", label: "Original request", hint: "What was requested, and by whom? Include the original wording or a source link." },
  { key: "context", label: "Context", hint: "Why is this needed? Describe the problem, users and background." },
  { key: "functional_requirements", label: "Functional requirements", hint: "What must users be able to do? Describe the behavior in detail." },
  { key: "technical_requirements", label: "Technical requirements", hint: "Document integrations, data, security and technical constraints, when known." },
  { key: "scope", label: "Scope", hint: "Define what is included, excluded and any dependencies." },
  { key: "expected_outcome", label: "Expected outcome", hint: "What result should the completed work achieve?" },
  { key: "acceptance_criteria", label: "Acceptance criteria", hint: "List the checks that will show the requirement has been met." },
  { key: "supporting_information", label: "Supporting information", hint: "Add relevant links, notes and references. Files can be attached after saving." },
] as const;
export interface RequirementContent {
  title: string; original_request: string; context: string; functional_requirements: string; technical_requirements: string;
  scope: string; expected_outcome: string; acceptance_criteria: string; supporting_information: string;
  owner_id: string | null; status: RequirementStatus;
}
export interface Requirement {
  title: string; status: RequirementStatus; owner_id: string | null;
  id: string; key: string; project_id: string; project_key: string; project_name: string; project_status: string;
  owner_name: string | null; my_role: "admin" | "member" | "viewer"; version: number; created_at: string; updated_at: string;
  task_count: number; task_done: number; decision_count: number;
}
export interface RequirementDetailData extends Requirement, RequirementContent {
  issues: { id: string; key: string; summary: string; issue_type: string; status: string }[];
  decisions: { id: string; key: string; title: string; status: string }[];
  events: { id: string; actor_name: string; action: string; details: Record<string, unknown>; created_at: string }[];
}
export interface RequirementPage { items: Requirement[]; total: number }
export function requirementHref(row: Pick<Requirement, "project_key" | "id">) {
  return `/projects/${encodeURIComponent(row.project_key)}?tab=requirements&requirement=${row.id}`;
}
export function requirementLabel(status: string) { return REQUIREMENT_STATUSES.find((item) => item.value === status)?.label ?? status; }
