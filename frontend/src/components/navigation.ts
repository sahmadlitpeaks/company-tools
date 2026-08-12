import {
  Award,
  Banknote,
  BarChart3,
  BookText,
  Bot,
  Boxes,
  Briefcase,
  Building2,
  CalendarDays,
  CheckSquare,
  Clock,
  Coffee,
  CreditCard,
  DoorOpen,
  FileText,
  FolderOpen,
  GitBranch,
  GraduationCap,
  HeartHandshake,
  HeartPulse,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  LifeBuoy,
  Lightbulb,
  Link2,
  Lock,
  Magnet,
  Mail,
  Megaphone,
  Network,
  Package,
  Palette,
  Plane,
  QrCode,
  ReceiptText,
  ScrollText,
  SearchX,
  Settings as SettingsIcon,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Signpost,
  Sliders,
  Smartphone,
  Stamp,
  Target,
  UserCog,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  Webhook,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
  module?: string;
  keywords?: string[];
};

export type NavGroup = {
  section: string;
  items: NavItem[];
  adminOnly?: boolean;
};

export const NAV_GROUPS: NavGroup[] = [
  {
    section: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, module: "dashboard", keywords: ["home", "overview"] },
      { to: "/hub", label: "My Workspace", icon: LayoutGrid, keywords: ["home", "hub", "work"] },
    ],
  },
  {
    section: "My Account",
    items: [
      { to: "/profile", label: "My Profile", icon: UserRound, keywords: ["account", "personal"] },
      { to: "/security", label: "Security & 2FA", icon: ShieldCheck, keywords: ["password", "authentication", "mfa"] },
    ],
  },
  {
    section: "My Work",
    items: [
      { to: "/tasks", label: "Tasks", icon: CheckSquare, module: "tasks", keywords: ["projects", "assignments", "to do"] },
      { to: "/work-log", label: "Work Log", icon: ScrollText, module: "worklog", keywords: ["effort", "activity"] },
      { to: "/my-docs", label: "My Documents", icon: FileText, module: "workspace", keywords: ["notes", "files", "workspace"] },
    ],
  },
  {
    section: "People",
    items: [
      { to: "/hr", label: "HR Dashboard", icon: HeartHandshake, module: "hr", keywords: ["people analytics", "headcount"] },
      { to: "/directory", label: "Employee Directory", icon: Users, module: "directory", keywords: ["people", "employees", "colleagues"] },
      { to: "/org-chart", label: "Org Chart", icon: Network, module: "people_ops", keywords: ["organization", "reporting lines"] },
      { to: "/people-ops", label: "On / Offboarding", icon: UserCog, module: "people_ops", keywords: ["people operations", "onboarding", "offboarding"] },
    ],
  },
  {
    section: "Talent",
    items: [
      { to: "/recruiting", label: "Recruiting", icon: Briefcase, module: "recruiting", keywords: ["candidates", "jobs", "hiring"] },
      { to: "/performance", label: "Performance", icon: Target, keywords: ["reviews", "goals", "feedback"] },
      { to: "/training", label: "Training", icon: GraduationCap, keywords: ["learning", "courses", "certifications"] },
      { to: "/engagement", label: "Engagement", icon: Award, keywords: ["surveys", "kudos", "recognition"] },
    ],
  },
  {
    section: "Time & Pay",
    items: [
      { to: "/time", label: "Time Tracking", icon: Clock, module: "attendance", keywords: ["attendance", "clock", "timesheet"] },
      { to: "/leave", label: "Leave", icon: Plane, module: "approvals", keywords: ["holiday", "vacation", "time off"] },
      { to: "/expenses", label: "Expenses", icon: ReceiptText, keywords: ["claims", "receipts", "reimbursement"] },
      { to: "/payroll", label: "Payroll", icon: Banknote, module: "hr", keywords: ["salary", "payslip"] },
      { to: "/benefits", label: "Benefits", icon: HeartPulse, module: "hr", keywords: ["plans", "enrollment"] },
    ],
  },
  {
    section: "Requests & Support",
    items: [
      { to: "/approvals", label: "Approvals", icon: Stamp, module: "approvals", keywords: ["requests", "decisions"] },
      { to: "/purchases", label: "Purchase Requests", icon: ShoppingCart, module: "purchases", keywords: ["buy", "procurement", "spend"] },
      { to: "/service-desk", label: "Service Desk", icon: LifeBuoy, module: "service_desk", keywords: ["tickets", "help", "support", "it"] },
    ],
  },
  {
    section: "Knowledge & Communication",
    items: [
      { to: "/knowledge", label: "Knowledge Base", icon: BookText, module: "knowledge", keywords: ["articles", "guides", "help"] },
      { to: "/announcements", label: "Announcements", icon: Megaphone, module: "announcements", keywords: ["news", "updates"] },
      { to: "/ai-help", label: "AI Help", icon: Bot, module: "ai_help", keywords: ["assistant", "ask", "chat"] },
      { to: "/ideas", label: "Feedback & Ideas", icon: Lightbulb, module: "ideas", keywords: ["suggestions", "issues", "voting"] },
    ],
  },
  {
    section: "Workplace",
    items: [
      { to: "/cafe", label: "Café", icon: Coffee, module: "cafe", keywords: ["food", "orders", "menu"] },
      { to: "/bookings", label: "Rooms & Desks", icon: DoorOpen, module: "bookings", keywords: ["reservations", "spaces", "meeting room"] },
      { to: "/visitors", label: "Visitors", icon: UserPlus, module: "visitors", keywords: ["guests", "reception", "check in"] },
      { to: "/calendar", label: "Company Calendar", icon: CalendarDays, module: "calendar", keywords: ["events", "schedule"] },
      { to: "/lost-found", label: "Lost & Found", icon: SearchX, module: "lost_found", keywords: ["missing", "items", "claims"] },
    ],
  },
  {
    section: "Assets & Spend",
    items: [
      { to: "/asset-tracker", label: "Asset Tracker", icon: Boxes, module: "asset_tracker", keywords: ["equipment", "inventory", "devices"] },
      { to: "/phone-lines", label: "Phone Lines", icon: Smartphone, module: "asset_tracker", keywords: ["sim", "mobile", "numbers"] },
      { to: "/subscriptions", label: "Subscriptions", icon: Wallet, module: "subscriptions", keywords: ["vendors", "renewals", "recurring costs"] },
    ],
  },
  {
    section: "Sales",
    items: [
      { to: "/crm", label: "Leads (CRM)", icon: Magnet, module: "crm", keywords: ["customers", "pipeline", "sales"] },
      { to: "/inbox", label: "Web Inbox", icon: Inbox, module: "crm", keywords: ["submissions", "forms", "leads", "wordpress", "contact form"] },
      { to: "/inbox/rules", label: "Routing & Filtering", icon: Signpost, module: "crm", keywords: ["routing", "rules", "blocklist", "spam", "careers", "mapping"] },
    ],
  },
  {
    section: "Marketing",
    items: [
      { to: "/cards", label: "Digital Cards", icon: CreditCard, module: "cards", keywords: ["business cards", "profiles"] },
      { to: "/marketing-assets", label: "Marketing Assets", icon: FolderOpen, module: "marketing_assets", keywords: ["files", "media", "library"] },
      { to: "/branding", label: "Brand Center", icon: Palette, module: "branding", keywords: ["company", "logo", "colors"] },
      { to: "/products", label: "Products & Brochures", icon: Package, module: "products", keywords: ["catalogue", "sales material"] },
      { to: "/campaigns", label: "Campaign Studio", icon: Megaphone, module: "campaigns", keywords: ["marketing", "analytics", "channels"] },
      { to: "/shared", label: "Shared Links", icon: Share2, module: "shared", keywords: ["public", "published", "downloads"] },
    ],
  },
  {
    section: "Publishing Tools",
    items: [
      { to: "/qrcodes", label: "QR Codes", icon: QrCode, module: "qrcodes", keywords: ["scan", "links"] },
      { to: "/landing-pages", label: "Landing Pages", icon: LayoutTemplate, module: "landing_pages", keywords: ["web pages", "builder", "publish"] },
      { to: "/signatures", label: "Email Signatures", icon: Mail, module: "signatures", keywords: ["templates", "email"] },
      { to: "/shortener", label: "URL Shortener", icon: Link2, module: "shortener", keywords: ["short links", "clicks"] },
      { to: "/transfers", label: "Secure Transfers", icon: Lock, module: "transfers", keywords: ["files", "password", "download"] },
    ],
  },
  {
    section: "HR Administration",
    items: [
      { to: "/reports", label: "HR Reports", icon: BarChart3, module: "hr", keywords: ["analytics", "export"] },
      { to: "/hr/custom-fields", label: "Custom Fields", icon: Sliders, module: "hr", keywords: ["employee schema", "attributes"] },
      { to: "/hr/automations", label: "HR Automations", icon: Zap, module: "hr", keywords: ["reminders", "rules"] },
    ],
  },
  {
    section: "Platform Administration",
    adminOnly: true,
    items: [
      { to: "/companies", label: "Companies", icon: Building2, adminOnly: true, keywords: ["organizations", "brands"] },
      { to: "/departments", label: "Departments & Access", icon: ShieldCheck, adminOnly: true, keywords: ["permissions", "groups"] },
      { to: "/approval-workflows", label: "Approval Workflows", icon: GitBranch, adminOnly: true, keywords: ["routing", "approvers"] },
      { to: "/audit", label: "Audit Log", icon: ScrollText, adminOnly: true, keywords: ["history", "activity"] },
      { to: "/webhooks", label: "Webhooks", icon: Webhook, adminOnly: true, keywords: ["integrations", "events"] },
      { to: "/api-tokens", label: "API Tokens", icon: KeyRound, adminOnly: true, keywords: ["integrations", "credentials", "keys"] },
      { to: "/settings", label: "Settings", icon: SettingsIcon, adminOnly: true, keywords: ["configuration", "platform"] },
    ],
  },
];

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  return item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => isNavItemActive(pathname, item))
    .sort((left, right) => right.to.length - left.to.length)[0];
}

export function currentNavTitle(pathname: string): string {
  return findNavItem(pathname)?.label ?? "Internal Platform";
}

export function currentNavSection(pathname: string): string | undefined {
  return NAV_GROUPS.find((group) => group.items.some((item) => isNavItemActive(pathname, item)))?.section;
}

export function visibleNavGroups(
  isAdmin: boolean,
  can: (module: string) => boolean,
): NavGroup[] {
  return NAV_GROUPS.filter((group) => !group.adminOnly || isAdmin)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if ((item.adminOnly || group.adminOnly) && !isAdmin) return false;
        return !item.module || can(item.module);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
