export type SharePointRun = {
  id: string; status: string; discovered: number; processed: number; failed: number; error_code: string | null;
};

export type SharePointStatus = {
  enabled: boolean; configured: boolean; missing: string[]; connected: boolean;
  microsoft_sign_in_required: boolean; can_review: boolean; user_id: string;
  openai_configured: boolean; active_run: boolean;
  polling_enabled: boolean; sync_interval_seconds: number;
  scheduler_enabled: boolean; email_configured: boolean; teams_configured: boolean;
  run: SharePointRun | null; last_sync: string | null; languages: string[];
};

export type Evidence = { segment_id: string; quote: string };
export type Finding = {
  title: string; owner: string | null; deadline: string | null; status: string; priority: string; evidence: Evidence[];
};

export type ExpiryFinding = {
  title: string;
  date: string;
  category: "expiry" | "renewal" | "effective" | "warranty" | "milestone" | "deadline" | "other";
  responsible: string | null;
  evidence: Evidence[];
};

export type CommercialFinding = {
  description: string;
  amount: number | null;
  currency: string | null;
  payment_terms: string | null;
  billing_frequency: "one_time" | "monthly" | "quarterly" | "annual" | "milestone" | "unknown";
  evidence: Evidence[];
};

export type AnalysisSection = {
  summary: string; summary_evidence: Evidence[]; tasks: Finding[]; deadlines: Finding[];
  risks: Finding[]; blockers: Finding[]; contacts: Finding[];
  expiries?: ExpiryFinding[]; commercials?: CommercialFinding[];
  project_status: string | null; requires_attention: boolean;
  compliance?: {
    document_type: string;
    company?: { value: string } | null;
    reference_number?: { value: string } | null;
    issue_date?: { value: string } | null;
    effective_date?: { value: string } | null;
    expiry_date?: { value: string } | null;
    renewal_date?: { value: string } | null;
    termination_notice?: { days: number } | null;
    parties?: Array<{ value: string }>;
    obligations?: Array<{ value: string }>;
    review_reasons?: string[];
  };
};
export type Segment = { id: string; location: string; text: string };
export type SharePointDocument = {
  id: string; name: string; path?: string; url: string; status: string; error_code: string | null;
  languages: string[]; size?: number; modified_at: string | null; processed_at?: string | null;
  requires_attention: boolean; model?: string; attempts?: number;
  analysis?: { sections: AnalysisSection[]; requires_attention: boolean } | null;
  compliance?: AnalysisSection["compliance"] | null;
  segments?: Segment[]; usage?: { input_tokens: number; output_tokens: number } | null;
};
export type DocumentPage = { items: SharePointDocument[]; next_cursor: string | null };
export type SharePointReminder = {
  id: string;
  task_id?: string | null;
  document_id: string;
  document_name?: string | null;
  document_path?: string | null;
  document_url?: string | null;
  title: string;
  category: string;
  target_date: string;
  reminder_date: string;
  lead_days: number;
  responsible_name: string | null;
  recipient_email: string | null;
  amount: number | null;
  currency: string | null;
  status: "pending" | "sent" | "completed" | "dismissed" | "overdue" | "failed";
  notes?: string | null;
  sent_at?: string | null;
  delivery_channels?: string[] | null;
  last_error?: string | null;
  attempts?: number;
};

export type ChatCitation = {
  document_id: string;
  document_name: string;
  document_path?: string | null;
  document_url?: string | null;
  location?: string | null;
  quote?: string | null;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ChatResponse = {
  reply: string;
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
  citations?: ChatCitation[];
};

export type CentralChatIn = {
  messages: ChatMessage[];
  document_ids?: string[] | null;
};

export function readableStatus(value: string) {
  return value.replace(/_/g, " ");
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getStatusBadgeInfo(status: string): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
} {
  switch (status) {
    case "ready":
      return { label: "Ready", variant: "default", className: "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border-emerald-600/30 font-medium" };
    case "processing":
      return { label: "AI Processing…", variant: "outline", className: "bg-primary/10 text-primary border-primary/30 animate-pulse font-medium" };
    case "queued":
      return { label: "Queued", variant: "outline" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    case "ai_skipped":
      return { label: "AI Prohibited", variant: "outline" };
    default:
      return { label: readableStatus(status), variant: "outline" };
  }
}

export function calculateEstimatedCost(
  usage?: { input_tokens: number; output_tokens: number } | null,
  modelName?: string | null
): { costUsd: number; formatted: string } | null {
  if (!usage) return null;
  const model = (modelName || "gpt-5.6-luna").toLowerCase();
  let inRate = 0.20 / 1_000_000;
  let outRate = 1.20 / 1_000_000;

  if (model.includes("gpt-5.6-luna")) {
    inRate = 0.20 / 1_000_000;
    outRate = 1.20 / 1_000_000;
  } else if (model.includes("gpt-5.6-sol")) {
    inRate = 4.00 / 1_000_000;
    outRate = 20.00 / 1_000_000;
  } else if (model.includes("gpt-5.6-terra")) {
    inRate = 2.00 / 1_000_000;
    outRate = 12.00 / 1_000_000;
  } else if (model.includes("gpt-4o-mini")) {
    inRate = 0.15 / 1_000_000;
    outRate = 0.60 / 1_000_000;
  } else if (model.includes("gpt-4o")) {
    inRate = 2.50 / 1_000_000;
    outRate = 10.00 / 1_000_000;
  } else if (model.includes("o3-mini") || model.includes("o4-mini")) {
    inRate = 1.10 / 1_000_000;
    outRate = 4.40 / 1_000_000;
  } else if (model.includes("o1")) {
    inRate = 15.00 / 1_000_000;
    outRate = 60.00 / 1_000_000;
  }

  const cost = (usage.input_tokens * inRate) + (usage.output_tokens * outRate);
  const formatted = cost > 0 && cost < 0.01
    ? "<$0.01"
    : `$${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return { costUsd: cost, formatted };
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
