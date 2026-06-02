export interface User {
  id: string;
  email: string;
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
  created_at: string;
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
  created_at: string;
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

export interface TrackedAsset {
  id: string;
  asset_tag: string;
  name: string;
  category?: string | null;
  status: string;
  location?: string | null;
  serial_number?: string | null;
  notes?: string | null;
  assigned_to_id?: string | null;
  assigned_to_name?: string | null;
  purchase_date?: string | null;
  purchase_cost?: string | null;
  vendor?: string | null;
  warranty_expiry?: string | null;
  useful_life_years?: number | null;
  current_book_value?: string | null;
  created_at: string;
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
