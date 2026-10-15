export const DECISION_STATUSES = [
  { value: "draft", label: "Draft" }, { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" },
  { value: "superseded", label: "Superseded" }, { value: "archived", label: "Archived" },
];
export const DECISION_CATEGORIES = [
  { value: "business", label: "Business" }, { value: "product", label: "Product" },
  { value: "technical", label: "Technical" }, { value: "operational", label: "Operational" },
  { value: "security_compliance", label: "Security / Compliance" }, { value: "other", label: "Other" },
];
export const EVIDENCE_TYPES = [
  { value: "teams", label: "Teams message" }, { value: "document", label: "Document" },
  { value: "meeting", label: "Meeting notes" }, { value: "other", label: "Other" },
];
export type DecisionEvidence = { type: string; label: string; url: string; added_by_name?: string; added_at?: string };
export type DecisionIssue = { id: string; key: string; summary: string; issue_type: string; status: string; reporter_name: string | null; assignee_name: string | null };
export type DecisionContent = {
  title: string; category: string; context: string; approach: string; rationale: string; alternatives: string;
  owner_id: string | null; approver_id: string | null; effective_date: string | null;
};
export type DecisionSnapshot = DecisionContent & {
  key: string; owner_name: string | null; approver_name: string | null; proposed_by_name: string | null;
  evidence: DecisionEvidence[]; issues: DecisionIssue[];
};
export type Decision = DecisionContent & {
  id: string; project_id: string; key: string; status: string; proposed_by_id: string | null;
  owner_name: string | null; approver_name: string | null; proposed_by_name: string | null;
  version: number; revision_number: number; approved_revision_number: number | null; approved_at: string | null;
  created_at: string; updated_at: string; superseded_by_id: string | null;
  can_edit: boolean; can_submit: boolean; can_revise: boolean; can_decide: boolean; can_archive: boolean; can_supersede: boolean;
};
export type DecisionDetailData = Decision & {
  evidence: DecisionEvidence[]; issues: DecisionIssue[];
  revisions: { number: number; snapshot: DecisionSnapshot; change_summary: string; submitted_by_name: string; created_at: string }[];
  events: { id: string; action: string; note: string; actor_name: string; revision_number: number | null; created_at: string }[];
  related_decisions: { id: string; key: string; title: string; relationship: "replaces" | "replaced_by" }[];
};
export type DecisionPage = { items: Decision[]; total: number };
export function decisionLabel(options: { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}
