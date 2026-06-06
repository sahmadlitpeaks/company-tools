import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Boxes,
  CheckSquare,
  ChevronDown,
  CreditCard,
  FolderOpen,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  Link2,
  Lock,
  Magnet,
  Mail,
  Megaphone,
  Menu,
  Moon,
  Package,
  Palette,
  Plane,
  QrCode,
  ScrollText,
  Settings as SettingsIcon,
  Share2,
  Sliders,
  Stamp,
  Sun,
  UserCog,
  Users,
  BookText,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { BrandProvider } from "../brand/BrandContext";
import BrandSwitcher from "../brand/BrandSwitcher";
import GlobalSearch from "./GlobalSearch";
import NotificationBell from "./NotificationBell";
import CommandPalette from "./CommandPalette";
import AppearanceModal from "../theme/AppearanceModal";
import { useTheme } from "../theme/ThemeContext";

export const APP_NAME = "AG Holding";

type NavEntry =
  | { section: string; adminOnly?: boolean }
  | {
      to: string;
      label: string;
      icon: LucideIcon;
      end?: boolean;
      adminOnly?: boolean;
      module?: string;
    };

const NAV: NavEntry[] = [
  { section: "Overview" },
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, module: "dashboard" },
  { to: "/directory", label: "Employee Directory", icon: Users, module: "directory" },
  { section: "Marketing" },
  { to: "/cards", label: "Digital Cards", icon: CreditCard, module: "cards" },
  { to: "/marketing-assets", label: "Marketing Assets", icon: FolderOpen, module: "marketing_assets" },
  { to: "/branding", label: "Brand Center", icon: Palette, module: "branding" },
  { to: "/products", label: "Products & Brochures", icon: Package, module: "products" },
  { to: "/shared", label: "Shared Links", icon: Share2, module: "shared" },
  { section: "Sales" },
  { to: "/crm", label: "Leads (CRM)", icon: Magnet, module: "crm" },
  { to: "/campaigns", label: "Campaign Studio", icon: Megaphone, module: "campaigns" },
  { section: "Workplace" },
  { to: "/tasks", label: "Tasks", icon: CheckSquare, module: "tasks" },
  { to: "/approvals", label: "Approvals", icon: Stamp, module: "approvals" },
  { to: "/leave", label: "Leave", icon: Plane, module: "approvals" },
  { to: "/service-desk", label: "Service Desk", icon: LifeBuoy, module: "service_desk" },
  { to: "/knowledge", label: "Knowledge Base", icon: BookText, module: "knowledge" },
  { to: "/announcements", label: "Announcements", icon: Megaphone, module: "announcements" },
  { to: "/people-ops", label: "On / Offboarding", icon: UserCog, module: "people_ops" },
  { section: "Operations" },
  { to: "/asset-tracker", label: "Asset Tracker", icon: Boxes, module: "asset_tracker" },
  { section: "Tools" },
  { to: "/qrcodes", label: "QR Codes", icon: QrCode, module: "qrcodes" },
  { to: "/landing-pages", label: "Landing Pages", icon: LayoutTemplate, module: "landing_pages" },
  { to: "/signatures", label: "Email Signatures", icon: Mail, module: "signatures" },
  { to: "/shortener", label: "URL Shortener", icon: Link2, module: "shortener" },
  { to: "/transfers", label: "Secure Transfers", icon: Lock, module: "transfers" },
  { section: "Admin", adminOnly: true },
  { to: "/audit", label: "Audit Log", icon: ScrollText, adminOnly: true },
  { to: "/settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
];

function initials(name?: string | null, email?: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function currentTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const item = NAV.find(
    (n) => "to" in n && n.to !== "/" && pathname.startsWith(n.to as string),
  );
  return (item && "label" in item ? item.label : "") || "Internal Platform";
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const theme = useTheme();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global ⌘K / Ctrl+K to open the command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const isDark =
    theme.mode === "dark" ||
    (theme.mode === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  // Filter nav by permission, then drop section headers left with no items.
  const navItems = NAV.filter((item) => {
    if ("section" in item) return !item.adminOnly || user?.is_admin;
    if (item.adminOnly && !user?.is_admin) return false;
    if (item.module && !can(item.module)) return false;
    return true;
  });
  const visibleNav = navItems.filter((item, i) => {
    if (!("section" in item)) return true;
    const next = navItems[i + 1];
    return next !== undefined && !("section" in next);
  });
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const title = currentTitle(location.pathname);

  // Dynamic document title per route.
  useEffect(() => {
    document.title = `${title} — ${APP_NAME}`;
  }, [title]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const name = user?.display_name ?? user?.email;
  const role = user?.is_admin ? "Administrator" : user?.job_title ?? "Employee";

  return (
   <BrandProvider>
    <div className="app-shell">
      {navOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="logo">AG</span>
          <span>AG Holding</span>
        </div>
        <nav className="nav-scroll">
          {visibleNav.map((item, i) =>
            "section" in item ? (
              <div key={i} className="nav-section">
                {item.section}
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
              >
                <item.icon className="nav-icon" size={18} strokeWidth={2} />
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="sidebar-foot">Internal Platform · v1</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="flex items-center gap-2">
            <button
              className="menu-btn"
              aria-label="Open menu"
              onClick={() => setNavOpen((o) => !o)}
            >
              <Menu size={18} />
            </button>
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                {APP_NAME}
              </span>
              <span className="text-[15px] font-semibold">{title}</span>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
          <GlobalSearch />
          <button
            className="bell-btn"
            title={isDark ? "Switch to light" : "Switch to dark"}
            aria-label="Toggle dark mode"
            onClick={() => theme.setField("mode", isDark ? "light" : "dark")}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <BrandSwitcher />
          <span className="mx-1 hidden h-7 w-px bg-[var(--border)] sm:block" />
          <NotificationBell />
          <span className="mx-1 h-7 w-px bg-[var(--border)]" />
          <div className="profile" ref={menuRef}>
            <button className="profile-btn" aria-label="Account menu" onClick={() => setMenuOpen((o) => !o)}>
              <span className="avatar">{initials(user?.display_name, user?.email)}</span>
              <span className="profile-meta">
                <span className="profile-name">{name}</span>
                <span className="profile-role">{role}</span>
              </span>
              <ChevronDown size={14} className="caret" />
            </button>
            {menuOpen && (
              <div className="profile-menu">
                <div className="profile-menu-head">
                  <div style={{ fontWeight: 600 }}>{name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{user?.email}</div>
                </div>
                <button
                  className="profile-menu-item flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false);
                    setAppearanceOpen(true);
                  }}
                >
                  <Sliders size={15} /> Appearance
                </button>
                <button className="profile-menu-item" onClick={logout}>
                  Sign out
                </button>
              </div>
            )}
          </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      {appearanceOpen && <AppearanceModal onClose={() => setAppearanceOpen(false)} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
   </BrandProvider>
  );
}
