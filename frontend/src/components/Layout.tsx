import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BrandProvider } from "../brand/BrandContext";
import BrandSwitcher from "../brand/BrandSwitcher";
import NotificationBell from "./NotificationBell";

const NAV = [
  { section: "Overview" },
  { to: "/", label: "Dashboard", icon: "▦", end: true },
  { to: "/directory", label: "Employee Directory", icon: "👥" },
  { section: "Marketing" },
  { to: "/cards", label: "Digital Cards", icon: "💳" },
  { to: "/assets", label: "Marketing Assets", icon: "📁" },
  { to: "/branding", label: "Brand Center", icon: "🎨" },
  { to: "/products", label: "Products & Brochures", icon: "📦" },
  { section: "Operations" },
  { to: "/asset-tracker", label: "Asset Tracker", icon: "🏷" },
  { section: "Tools" },
  { to: "/qrcodes", label: "QR Codes", icon: "▣" },
  { to: "/landing-pages", label: "Landing Pages", icon: "🖥" },
  { to: "/signatures", label: "Email Signatures", icon: "✉" },
  { to: "/shortener", label: "URL Shortener", icon: "🔗" },
  { to: "/transfers", label: "Secure Transfers", icon: "🔒" },
  { section: "Admin", adminOnly: true },
  { to: "/brands", label: "Brands", icon: "🏢", adminOnly: true },
  { to: "/settings", label: "Settings", icon: "⚙️", adminOnly: true },
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
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">AG</span>
          <span>AG Holding</span>
        </div>
        <nav className="nav-scroll">
          {NAV.filter(
            (item) => !("adminOnly" in item && item.adminOnly) || user?.is_admin,
          ).map((item, i) =>
            "section" in item ? (
              <div key={i} className="nav-section">
                {item.section}
              </div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to!}
                end={item.end}
                className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="sidebar-foot">Internal Platform · v1</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
              AG Holding
            </span>
            <span className="text-[15px] font-semibold">{currentTitle(location.pathname)}</span>
          </div>
          <div className="flex flex-none items-center gap-2">
          <BrandSwitcher />
          <span className="mx-1 hidden h-7 w-px bg-[var(--border)] sm:block" />
          <NotificationBell />
          <span className="mx-1 h-7 w-px bg-[var(--border)]" />
          <div className="profile" ref={menuRef}>
            <button className="profile-btn" onClick={() => setMenuOpen((o) => !o)}>
              <span className="avatar">{initials(user?.display_name, user?.email)}</span>
              <span className="profile-meta">
                <span className="profile-name">{name}</span>
                <span className="profile-role">{role}</span>
              </span>
              <span className="caret">▾</span>
            </button>
            {menuOpen && (
              <div className="profile-menu">
                <div className="profile-menu-head">
                  <div style={{ fontWeight: 600 }}>{name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{user?.email}</div>
                </div>
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
    </div>
   </BrandProvider>
  );
}
