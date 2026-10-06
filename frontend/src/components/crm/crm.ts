import type { CrmLead, CrmPriority } from "../../api/types";

/** Pipeline stages in order. Keep in step with LEAD_STATUSES in backend/app/models/crm.py. */
export const STAGES = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export const OPEN_STAGES: readonly string[] = STAGES.slice(0, 5);
export const STAGE_LABELS: Record<string, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", proposal: "Proposal",
  negotiation: "Negotiation", won: "Won", lost: "Lost",
};
export const STAGE_BADGES: Record<string, "info" | "warning" | "success" | "secondary" | "destructive" | "outline"> = {
  new: "info", contacted: "warning", qualified: "outline", proposal: "outline", negotiation: "warning", won: "success", lost: "secondary",
};
export const STAGE_OPTIONS = STAGES.map((value) => ({ value, label: STAGE_LABELS[value] }));

export const PRIORITIES: CrmPriority[] = ["high", "medium", "low"];
export const PRIORITY_LABELS: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
export const PRIORITY_BADGES: Record<string, "destructive" | "warning" | "secondary"> = { high: "destructive", medium: "warning", low: "secondary" };

export const SOURCE_LABELS: Record<string, string> = { web: "website", card: "card", landing: "landing", manual: "manual", import: "import" };

export const ACTIVITY_LABELS: Record<string, string> = {
  note: "Note", call: "Call", email: "Email", meeting: "Meeting", created: "Created", change: "Updated", import: "Import",
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function leadName(lead: Pick<CrmLead, "name" | "email">): string {
  return lead.name ?? lead.email ?? "Unnamed lead";
}

export function money(value?: string | null): string {
  if (!value) return "—";
  const number = Number(value);
  return Number.isNaN(number) ? String(value) : number.toLocaleString(undefined, { style: "currency", currency: "AED" });
}

/** Today as the UTC calendar day the API uses for follow-up dates. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Show a YYYY-MM-DD day without shifting it through the local time zone. */
export function formatDay(day?: string | null): string {
  if (!day) return "—";
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(undefined, { timeZone: "UTC" });
}

export type FollowUpState = "overdue" | "today" | "upcoming" | null;

/** Follow-ups only matter while a lead is still open. */
export function followUpState(lead: Pick<CrmLead, "follow_up_date" | "status">, today = todayUtc()): FollowUpState {
  if (!lead.follow_up_date || !OPEN_STAGES.includes(lead.status)) return null;
  if (lead.follow_up_date < today) return "overdue";
  return lead.follow_up_date === today ? "today" : "upcoming";
}

export function parseTags(text: string): string[] {
  const seen: string[] = [];
  for (const raw of text.split(/[,;]/)) {
    const tag = raw.trim().replace(/\s+/g, " ").toLowerCase();
    if (tag && !seen.includes(tag)) seen.push(tag);
  }
  return seen;
}
