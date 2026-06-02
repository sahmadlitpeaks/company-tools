import { Link } from "react-router-dom";
import { useFetch } from "../hooks/useApi";
import { PageHead } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import type {
  DigitalCard,
  LandingPage,
  Product,
  QRCode,
  ShortLink,
  User,
} from "../api/types";

function Stat({
  value,
  label,
  to,
}: {
  value: number | string;
  label: string;
  to: string;
}) {
  return (
    <Link to={to} className="card stat" style={{ textDecoration: "none" }}>
      <span className="value">{value}</span>
      <span className="label">{label}</span>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const users = useFetch<User[]>("/api/users");
  const cards = useFetch<DigitalCard[]>("/api/cards");
  const qrcodes = useFetch<QRCode[]>("/api/qrcodes");
  const products = useFetch<Product[]>("/api/products");
  const pages = useFetch<LandingPage[]>("/api/landing-pages");
  const links = useFetch<ShortLink[]>("/api/short-links");

  const totalClicks =
    links.data?.reduce((sum, l) => sum + l.click_count, 0) ?? 0;

  return (
    <div>
      <PageHead
        title={`Welcome, ${user?.given_name ?? user?.display_name ?? "there"} 👋`}
        subtitle="Your company marketing & employee toolkit at a glance."
      />
      <div className="grid cols-4">
        <Stat value={users.data?.length ?? "…"} label="Employees" to="/directory" />
        <Stat value={cards.data?.length ?? "…"} label="My Digital Cards" to="/cards" />
        <Stat value={qrcodes.data?.length ?? "…"} label="QR Codes" to="/qrcodes" />
        <Stat value={products.data?.length ?? "…"} label="Products" to="/products" />
        <Stat
          value={pages.data?.length ?? "…"}
          label="Landing Pages"
          to="/landing-pages"
        />
        <Stat
          value={links.data?.length ?? "…"}
          label="Short Links"
          to="/shortener"
        />
        <Stat value={totalClicks} label="Total Link Clicks" to="/shortener" />
      </div>

      <div className="grid cols-2" style={{ marginTop: 20 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Quick actions</h3>
          <div className="row" style={{ gap: 10 }}>
            <Link className="btn btn-primary" to="/cards">
              New digital card
            </Link>
            <Link className="btn" to="/qrcodes">
              Generate QR code
            </Link>
            <Link className="btn" to="/shortener">
              Shorten a URL
            </Link>
            <Link className="btn" to="/signatures">
              Build email signature
            </Link>
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Recent short links</h3>
          {links.data && links.data.length > 0 ? (
            <table>
              <tbody>
                {links.data.slice(0, 5).map((l) => (
                  <tr key={l.id}>
                    <td>
                      <code>/s/{l.code}</code>
                    </td>
                    <td className="muted" style={{ maxWidth: 220 }}>
                      {l.target_url}
                    </td>
                    <td>
                      <span className="badge blue">{l.click_count} clicks</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">No short links yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
