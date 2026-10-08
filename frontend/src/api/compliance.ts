export type ComplianceSummary = {
  expiring_60: number;
  expiring_30: number;
  due_this_week: number;
  overdue: number;
  needs_review: number;
  unassigned: number;
  tasks_by_owner: Record<string, number>;
  documents_by_company: Record<string, number>;
};

export type ComplianceDocument = {
  id: string;
  source_id?: string;
  source_name?: string;
  name: string;
  url: string;
  company_id: string | null;
  company: string;
  document_type: string;
  reference_number: string | null;
  expiry_date: string | null;
  action_date: string | null;
  renewal_date: string | null;
  notice_days: number | null;
  status: string;
  processing_status: string;
  error_code: string | null;
  folder_department_id: string | null;
  folder_department: string | null;
  can_review: boolean;
  review_reasons: string[];
  modified_at: string | null;
  uploaded_at: string | null;
  uploaded_by_email: string | null;
};

export type ComplianceTask = {
  id: string;
  document_id: string;
  document_name: string;
  title: string;
  company: string | null;
  document_type: string;
  due_date: string;
  basis: string;
  status: string;
  owner: string;
  can_assign: boolean;
  can_complete: boolean;
  owner_user_id: string | null;
  owner_department_id: string | null;
};

export type ComplianceDashboard = {
  summary: ComplianceSummary;
  documents: ComplianceDocument[];
  tasks: ComplianceTask[];
};

export type ComplianceOption = { id: string; name: string };
export type ComplianceUserOption = ComplianceOption & { department_id: string | null };
export type ComplianceOptions = {
  companies: ComplianceOption[];
  departments: ComplianceOption[];
  users: ComplianceUserOption[];
};

export type OwnerRule = {
  id: string;
  company_id: string | null;
  document_type: string | null;
  folder_name: string | null;
  owner_user_id: string | null;
  owner_department_id: string | null;
  reminder_leads: number[];
  priority: number;
  is_active: boolean;
};

export type ComplianceHistory = {
  versions: Array<{ source_version: string; modified_at: string | null; extracted: Record<string, unknown> | null; status: string }>;
  events: Array<{ id: string; action: string; actor_id: string | null; task_id: string | null; details: Record<string, unknown> | null; at: string }>;
};

export const DOCUMENT_TYPES = [
  ["trade_license", "Trade license"],
  ["contract", "Contract / agreement"],
  ["iso_cap_certificate", "ISO / CAP certificate"],
  ["insurance", "Insurance"],
  ["dpa", "DPA"],
  ["regulatory_license", "Regulatory license"],
  ["vendor_agreement", "Vendor agreement"],
  ["laboratory_accreditation", "Laboratory accreditation"],
  ["it_software_agreement", "IT / software agreement"],
  ["product_sheet", "Product information sheet"],
  ["vendor_notice", "Vendor price notice"],
  ["other", "Other compliance document"],
] as const;

export function documentTypeLabel(value: string) {
  if (!value || value === "unknown") return "Not classified";
  return DOCUMENT_TYPES.find(([key]) => key === value)?.[1] ?? value.replace(/_/g, " ");
}

export function factValue(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    return String((value as { value: unknown }).value ?? "");
  }
  return "";
}
