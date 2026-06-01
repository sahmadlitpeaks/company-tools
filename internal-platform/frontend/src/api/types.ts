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
  product_id?: string | null;
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
