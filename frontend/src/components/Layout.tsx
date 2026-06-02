import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV = [
  { section: "Overview" },
  { to: "/", label: "Dashboard", icon: "▦", end: true },
  { to: "/directory", label: "Employee Directory", icon: "👥" },
  { section: "Marketing" },
  { to: "/cards", label: "Digital Cards", icon: "💳" },
  { to: "/assets", label: "Marketing Assets", icon: "📁" },
  { to: "/branding", label: "Brand Center", icon: "🎨" },
  { to: "/products", label: "Products & Brochures", icon: "📦" },
  { section: "Tools" },
  { to: "/qrcodes", label: "QR Codes", icon: "▣" },
  { to: "/landing-pages", label: "Landing Pages", icon: "🖥" },
  { to: "/signatures", label: "Email Signatures", icon: "✉" },
  { to: "/shortener", label: "URL Shortener", icon: "🔗" },
  { to: "/transfers", label: "Secure Transfers", icon: "🔒" },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">AG</span>
          <span>AG Holding</span>
        </div>
        {NAV.map((item, i) =>
          "section" in item ? (
            <div key={i} className="nav-section">
              {item.section}
            </div>
          ) : (
            <NavLink
              key={item.to}
              to={item.to!}
              end={item.end}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <span style={{ width: 18, textAlign: "center" }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ),
        )}
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="title">Internal Platform</div>
          <div className="row" style={{ flex: "0 0 auto", gap: 14 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 600 }}>{user?.display_name ?? user?.email}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {user?.is_admin ? "Administrator" : user?.job_title ?? "Employee"}
              </div>
            </div>
            <button className="btn-sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
