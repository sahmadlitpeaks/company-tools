export interface User {
  id: string;
  email?: string | null;
  personal_email?: string | null;
  passport_no?: string | null;
  nationality?: string | null;
  bamboo_id?: string | null;
  display_name?: string | null;
  given_name?: string | null;
  surname?: string | null;
  job_title?: string | null;
  department?: string | null;
  office_location?: string | null;
  mobile_phone?: string | null;
  business_phone?: string | null;
  avatar_url?: string | null;
  is_active: boolean;
  is_admin: boolean;
  must_change_password?: boolean;
  role: string;
  status: string;
  permissions?: string[] | null;
  department_id?: string | null;
  department_name?: string | null;
  extra_permissions?: string[] | null;
  revoked_permissions?: string[] | null;
  effective_permissions: string[];
  managed_brand_ids: string[];
  created_at: string;
}

export interface Department {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
  member_count: number;
  created_at: string;
}

export interface ModuleInfo {
  key: string;
  label: string;
}

export interface ModuleCatalogue {
  modules: ModuleInfo[];
  role_defaults: Record<string, string[]>;
}

export interface DigitalCard {
  id: string;
  slug: string;
  owner_id: string;
  full_name: string;
  title?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  website?: string | null;
  linkedin?: string | null;
  address?: string | null;
  bio?: string | null;
  photo_url?: string | null;
  accent_color: string;
  lead_capture_enabled: boolean;
  is_active: boolean;
  created_at: string;
}

export interface Lead {
  id: string;
  card_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  status: string;
  created_at: string;
}

export interface Folder {
  id: string;
  name: string;
  parent_id?: string | null;
  created_at: string;
}

export interface Asset {
  id: string;
  folder_id?: string | null;
  name: string;
  file_path: string;
  content_type?: string | null;
  size_bytes: number;
  version: number;
  is_public: boolean;
  share_code?: string | null;
  share_expires_at?: string | null;
  share_require_lead: boolean;
  share_has_passcode: boolean;
  created_at: string;
}

export interface ShareSettings {
  expires_in_days?: number | null;
  passcode?: string | null;
  require_lead?: boolean;
}

export interface ShareInfo {
  is_public: boolean;
  share_code?: string | null;
  share_url?: string | null;
  expires_at?: string | null;
  require_lead?: boolean;
  has_passcode?: boolean;
}

export interface BrandBrief {
  name: string;
  logo_url?: string | null;
  primary_color: string;
  website?: string | null;
  tagline?: string | null;
}

export interface PublicDocMeta {
  id: string;
  kind: "brochure" | "asset";
  title: string;
  content_type?: string | null;
  size_bytes: number;
  requires_passcode: boolean;
  requires_lead: boolean;
  brand?: BrandBrief | null;
}

export interface DocVersion {
  id: string;
  version: number;
  content_type?: string | null;
  size_bytes: number;
  note?: string | null;
  created_at: string;
}

export interface SharedDoc {
  kind: "brochure" | "asset";
  id: string;
  title: string;
  share_code: string;
  share_url: string;
  public_url: string;
  opens: number;
  downloads: number;
  last_opened?: string | null;
  expires_at?: string | null;
  require_lead: boolean;
  has_passcode: boolean;
  created_at: string;
}

export interface SearchHit {
  kind: "brochure" | "asset" | "product";
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
}

export interface SearchResults {
  query: string;
  hits: SearchHit[];
}

export interface BrandKit {
  id: string;
  name: string;
  description?: string | null;
  guidelines_url?: string | null;
  primary_colors?: string | null;
  fonts?: string | null;
  logo_url?: string | null;
  created_at: string;
}

export interface BrandAsset {
  id: string;
  brand_kit_id: string;
  name: string;
  category: string;
  file_path: string;
  content_type?: string | null;
  size_bytes: number;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  landing_url?: string | null;
  image_url?: string | null;
  created_at: string;
}

export interface Brochure {
  id: string;
  product_id?: string | null;
  title: string;
  file_path: string;
  content_type?: string | null;
  size_bytes: number;
  download_count: number;
  version: number;
  is_public: boolean;
  share_code?: string | null;
  share_expires_at?: string | null;
  share_require_lead: boolean;
  share_has_passcode: boolean;
  created_at: string;
}

export interface QRCode {
  id: string;
  label: string;
  target_url: string;
  fill_color: string;
  back_color: string;
  scan_count: number;
  dynamic: boolean;
  product_id?: string | null;
  created_at: string;
}

export interface LandingLead {
  id: string;
  page_id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  created_at: string;
}

export interface LandingPage {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  blocks?: string | null;
  html?: string | null;
  theme: string;
  status: string;
  view_count: number;
  created_at: string;
}

export interface SignatureTemplate {
  id: string;
  name: string;
  description?: string | null;
  html: string;
  is_default: boolean;
  created_at: string;
}

export interface EmailSignature {
  id: string;
  user_id: string;
  template_id?: string | null;
  rendered_html?: string | null;
  created_at: string;
}

export interface SecureTransfer {
  id: string;
  filename: string;
  content_type?: string | null;
  size_bytes: number;
  recipient_email: string;
  message?: string | null;
  has_password: boolean;
  one_time: boolean;
  max_downloads: number;
  download_count: number;
  expires_at?: string | null;
  is_consumed: boolean;
  email_sent: boolean;
  created_at: string;
}

export interface SecureTransferCreated extends SecureTransfer {
  share_url: string;
}

export interface TransferMeta {
  filename: string;
  size_bytes: number;
  requires_password: boolean;
  sender_name?: string | null;
  message?: string | null;
  expires_at?: string | null;
  status: "available" | "expired" | "consumed";
}

export interface CampaignKpis {
  spend: string;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: string;
  ctr: number;
  cpc: string;
  cpm: string;
  cpa: string;
  conversion_rate: number;
  roas: number;
}

export interface Campaign {
  id: string;
  brand_id?: string | null;
  name: string;
  objective?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
  created_at: string;
  kpis?: CampaignKpis | null;
}

export interface CampaignMetric {
  id: string;
  campaign_id: string;
  channel: string;
  date?: string | null;
  spend: string;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: string;
  created_at: string;
}

export interface ChannelBreakdown extends CampaignKpis {
  channel: string;
}

export interface CampaignBreakdown {
  totals: CampaignKpis;
  by_channel: ChannelBreakdown[];
  series: { date: string; spend: string; conversions: number; clicks: number }[];
}

export interface CampaignOverview {
  totals: CampaignKpis;
  by_channel: ChannelBreakdown[];
  campaigns: (CampaignKpis & { id: string; name: string })[];
}

export interface ShortLink {
  id: string;
  code: string;
  target_url: string;
  title?: string | null;
  campaign?: string | null;
  is_active: boolean;
  click_count: number;
  created_at: string;
}

export interface PhoneLine {
  id: string;
  number: string;
  carrier?: string | null;
  plan_name?: string | null;
  sim_number?: string | null;
  monthly_cost?: string | null;
  data_allowance?: string | null;
  status: string;
  assigned_to_id?: string | null;
  assigned_to_name?: string | null;
  assigned_to_title?: string | null;
  brand_id?: string | null;
  contract_start?: string | null;
  contract_end?: string | null;
  notes?: string | null;
  bill_count: number;
  created_at: string;
}

export interface PhoneLineEvent {
  id: string;
  line_id: string;
  event_type: string;
  user_id?: string | null;
  user_name?: string | null;
  note?: string | null;
  performed_by_name?: string | null;
  created_at: string;
}

export interface PhoneBill {
  id: string;
  line_id: string;
  period: string;
  amount?: string | null;
  data_used?: string | null;
  status: string;
  note?: string | null;
  created_at: string;
}

export interface PhoneLineDetail extends PhoneLine {
  events: PhoneLineEvent[];
  bills: PhoneBill[];
}

export interface PhoneSummary {
  total: number;
  by_status: Record<string, number>;
  assigned: number;
  monthly_cost: string;
}

export interface TrackedAsset {
  id: string;
  asset_tag: string;
  name: string;
  category?: string | null;
  status: string;
  location?: string | null;
  serial_number?: string | null;
  notes?: string | null;
  condition?: string | null;
  brand_id?: string | null;
  assigned_to_id?: string | null;
  assigned_to_name?: string | null;
  assigned_to_title?: string | null;
  purchase_date?: string | null;
  purchase_cost?: string | null;
  vendor?: string | null;
  warranty_expiry?: string | null;
  useful_life_years?: number | null;
  current_book_value?: string | null;
  next_maintenance_date?: string | null;
  maintenance_interval_days?: number | null;
  disposal_date?: string | null;
  salvage_value?: string | null;
  disposal_notes?: string | null;
  attachment_count: number;
  created_at: string;
}

export interface NamedItem {
  id: string;
  name: string;
}

export interface AssetAttachment {
  id: string;
  asset_id: string;
  kind: string;
  name: string;
  content_type?: string | null;
  size_bytes: number;
  created_at: string;
}

export interface AssignmentSpan {
  user_id?: string | null;
  user_name?: string | null;
  checked_out_at: string;
  checked_in_at?: string | null;
  note?: string | null;
}

export interface AssetEvent {
  id: string;
  asset_id: string;
  event_type: string;
  user_id?: string | null;
  user_name?: string | null;
  note?: string | null;
  cost?: string | null;
  performed_by_id?: string | null;
  performed_by_name?: string | null;
  created_at: string;
}

export interface AssetSummary {
  total: number;
  by_status: Record<string, number>;
  total_purchase_cost: string;
  total_book_value: string;
}

export interface AssetReports {
  by_category: {
    category: string;
    count: number;
    purchase_cost: string;
    book_value: string;
  }[];
  by_status: Record<string, number>;
  by_location: { location: string; count: number }[];
  by_condition?: Record<string, number>;
  totals: { count: number; purchase_cost: string; book_value: string };
}

export interface SeriesPoint {
  date: string;
  count: number;
}

export interface WarrantyAlert {
  id: string;
  name: string;
  asset_tag: string;
  warranty_expiry: string;
  days_left: number;
}

export interface ActivityItem {
  id: string;
  actor?: string | null;
  action: string;
  entity_type: string;
  summary: string;
  created_at?: string | null;
}

export interface Brand {
  id: string;
  slug: string;
  name: string;
  logo_url?: string | null;
  icon_url?: string | null;
  primary_color: string;
  secondary_color?: string | null;
  accent_color: string;
  font_family?: string | null;
  palette?: string | null;
  website?: string | null;
  email_domain?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  address?: string | null;
  tagline?: string | null;
  social?: string | null;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
}

export interface BrandDocument {
  id: string;
  brand_id: string;
  name: string;
  category: string;
  current_version: number;
  version_count: number;
  latest_size?: number | null;
  updated_at: string;
}

export interface BrandDocumentVersion {
  id: string;
  version: number;
  content_type?: string | null;
  size_bytes: number;
  created_at: string;
}

export interface CrmLead {
  id: string;
  brand_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source: string;
  source_detail?: string | null;
  status: string;
  owner_id?: string | null;
  owner_name?: string | null;
  value?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface CrmSummary {
  total: number;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  won_value: string;
  open_value: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body?: string | null;
  link?: string | null;
  category: string;
  is_read: boolean;
  created_at: string;
}

export interface AnalyticsOverview {
  counts: Record<string, number>;
  engagement: { total_link_clicks: number; total_card_scans: number };
  series: { clicks: SeriesPoint[]; scans: SeriesPoint[] };
  assets: {
    by_status: Record<string, number>;
    total_book_value: string;
    warranty_alerts: WarrantyAlert[];
  };
  recent_activity: ActivityItem[];
}

// ---- Office operations ----
export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  due_date?: string | null;
  recurrence?: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  created_by_id?: string | null;
  created_by_name?: string | null;
  brand_id?: string | null;
  completed_at?: string | null;
  created_at: string;
  onboarding_task_id?: string | null;
  subtasks_total: number;
  subtasks_done: number;
  comment_count: number;
}

export interface TaskItem {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  sort: number;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id?: string | null;
  author_name?: string | null;
  body: string;
  created_at: string;
}

export interface TaskDetail extends Task {
  items: TaskItem[];
  comments: TaskComment[];
}

export interface ActivityEntry {
  id: string;
  actor_name?: string | null;
  action: string;
  summary: string;
  created_at: string;
}

export interface SavedView {
  id: string;
  surface: string;
  name: string;
  params: string;
  created_at: string;
}

export interface Approval {
  id: string;
  type: string;
  title: string;
  details?: string | null;
  amount?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status: string;
  requester_id?: string | null;
  requester_name?: string | null;
  approver_id?: string | null;
  approver_name?: string | null;
  decided_by_id?: string | null;
  decided_by_name?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
  created_at: string;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id?: string | null;
  author_name?: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface Ticket {
  id: string;
  number?: number | null;
  subject: string;
  description?: string | null;
  category: string;
  priority: string;
  status: string;
  requester_id?: string | null;
  requester_name?: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  asset_id?: string | null;
  sla_response_due?: string | null;
  sla_resolution_due?: string | null;
  first_responded_at?: string | null;
  resolved_at?: string | null;
  resolution_note?: string | null;
  comment_count: number;
  effort_minutes: number;
  created_at: string;
}

export interface TicketDetail extends Ticket {
  comments: TicketComment[];
}

export interface ArticleSummary {
  id: string;
  title: string;
  category?: string | null;
  is_published: boolean;
  pinned: boolean;
  view_count: number;
  author_name?: string | null;
  updated_at: string;
}

export interface Article extends ArticleSummary {
  body: string;
  author_id?: string | null;
  created_at: string;
}

export interface WorkSummary {
  tasks_open: number;
  tasks_overdue: number;
  approvals_pending: number;
  approvals_to_review: number;
  tickets_open: number;
  tickets_assigned: number;
  announcements_unread: number;
  my_tasks: Task[];
  my_approvals: Approval[];
  review_approvals: Approval[];
  my_tickets: Ticket[];
  onboarding_open: number;
  my_onboarding_tasks: JourneyTask[];
}

export interface Attachment {
  id: string;
  entity_type: string;
  entity_id: string;
  name: string;
  content_type?: string | null;
  size_bytes: number;
  uploaded_by_id?: string | null;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  is_published: boolean;
  author_id?: string | null;
  author_name?: string | null;
  is_read: boolean;
  read_count: number;
  created_at: string;
}

export interface LeaveBalance {
  user_id: string;
  user_name?: string | null;
  year: number;
  entitlement_days: number;
  used_days: number;
  remaining_days: number;
}

export interface WhosOutItem {
  user_id?: string | null;
  user_name?: string | null;
  title: string;
  start_date?: string | null;
  end_date?: string | null;
}

export interface AuditEntry {
  id: string;
  actor_name?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  summary: string;
  created_at: string;
}

export interface AuditPage {
  items: AuditEntry[];
  actions: string[];
  entity_types: string[];
  has_more: boolean;
}

// ---- People ops (onboarding / offboarding) ----
export interface JourneyTask {
  id: string;
  journey_id: string;
  title: string;
  category: string;
  status: string;
  owner_id?: string | null;
  owner_name?: string | null;
  done_by_id?: string | null;
  done_by_name?: string | null;
  done_at?: string | null;
  sort: number;
}

export interface TargetAccess {
  id: string;
  name?: string | null;
  email: string;
  status: string;
  role: string;
  is_admin: boolean;
  effective_permissions: string[];
}

export interface AssignedAsset {
  id: string;
  asset_tag: string;
  name: string;
}

export interface Journey {
  id: string;
  kind: string;
  status: string;
  note?: string | null;
  target_user_id?: string | null;
  target_name?: string | null;
  brand_id?: string | null;
  brand_name?: string | null;
  created_by_id?: string | null;
  created_by_name?: string | null;
  completed_at?: string | null;
  created_at: string;
  total_tasks: number;
  done_tasks: number;
}

export interface AccessGrant {
  id: string;
  user_id: string;
  name: string;
  system?: string | null;
  username?: string | null;
  notes?: string | null;
  status: string;
  revoked_at?: string | null;
  created_at: string;
}

export interface AssignedPhone {
  id: string;
  number: string;
}

export interface PersonSubscription {
  subscription_id: string;
  name: string;
  vendor?: string | null;
  source: string; // seat | department | company
  seat_id?: string | null;
  seat_status?: string | null;
}

export interface JourneyDetail extends Journey {
  tasks: JourneyTask[];
  target?: TargetAccess | null;
  assigned_assets: AssignedAsset[];
  assigned_phones: AssignedPhone[];
  access_grants: AccessGrant[];
  subscriptions: PersonSubscription[];
}

// ---- Work log + quick docs ----
export interface WorkLog {
  id: string;
  user_id: string;
  user_name?: string | null;
  work_date: string;
  minutes: number;
  description: string;
  kind: string;
  entity_type?: string | null;
  entity_id?: string | null;
  entity_label?: string | null;
  created_at: string;
}

export interface WorkLogSummary {
  total_minutes: number;
  entries: number;
  by_kind: Record<string, number>;
  by_day: Record<string, number>;
  by_user: Record<string, number>;
}

export interface WorkspaceItem {
  id: string;
  owner_id: string;
  owner_name?: string | null;
  kind: string;
  title: string;
  body?: string | null;
  url?: string | null;
  content_type?: string | null;
  size_bytes: number;
  tags?: string | null;
  pinned: boolean;
  shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionSeat {
  id: string;
  user_id: string;
  user_name?: string | null;
  user_title?: string | null;
  status: string;
  revoked_at?: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  name: string;
  vendor?: string | null;
  plan?: string | null;
  url?: string | null;
  status: string;
  scope: string; // company | department | person
  department_id?: string | null;
  department_name?: string | null;
  cost_type: string; // flat | per_seat
  cost?: string | null;
  currency: string;
  billing_cycle: string;
  start_date?: string | null;
  end_date?: string | null;
  auto_renew: boolean;
  owner_id?: string | null;
  owner_name?: string | null;
  brand_id?: string | null;
  notes?: string | null;
  active_seats: number;
  monthly_cost?: string | null;
  seats: SubscriptionSeat[];
  created_at: string;
}

export interface SubscriptionSummary {
  total: number;
  by_status: Record<string, number>;
  monthly_spend: string;
  renewing_soon: number;
}

export interface ProfileItem {
  id: string;
  label: string;
  sub?: string | null;
  status?: string | null;
}

export interface ProfileSubscription {
  subscription_id: string;
  name: string;
  vendor?: string | null;
  source: string; // seat | department | company
  seat_status?: string | null;
}

export interface ProfileTask {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  due_date?: string | null;
}

export interface ProfileJourney {
  id: string;
  kind: string;
  status: string;
  total_tasks: number;
  done_tasks: number;
  created_at: string;
}

export interface Profile {
  id: string;
  name?: string | null;
  email?: string | null;
  job_title?: string | null;
  role: string;
  status: string;
  is_admin: boolean;
  department_name?: string | null;
  hr_department?: string | null;
  office_location?: string | null;
  mobile_phone?: string | null;
  business_phone?: string | null;
  avatar_url?: string | null;
  created_at: string;
  personal_email?: string | null;
  nationality?: string | null;
  passport_no?: string | null;
  modules: string[];
  access_grants: ProfileItem[];
  subscriptions: ProfileSubscription[];
  assets: ProfileItem[];
  phones: ProfileItem[];
  open_tasks: ProfileTask[];
  journeys: ProfileJourney[];
  can_manage: boolean;
  can_see_sensitive: boolean;
}

export interface SpendBucket {
  label: string;
  monthly: string;
  count: number;
}

export interface SubscriptionReport {
  monthly_total: string;
  annual_total: string;
  active_seats: number;
  by_department: SpendBucket[];
  by_vendor: SpendBucket[];
  by_billing_cycle: SpendBucket[];
  top: SpendBucket[];
}

export interface ProvisionSuggestion {
  kind: string;
  ref_id?: string | null;
  label: string;
  detail?: string | null;
  peer_count: number;
  peer_total: number;
}

export interface ProvisionSuggestions {
  department_name?: string | null;
  peer_total: number;
  auto_covered: PersonSubscription[];
  subscriptions: ProvisionSuggestion[];
  access: ProvisionSuggestion[];
}
