import { useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useFetch } from "../hooks/useApi";
import { Loading, MiniBars, PageHead } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import type { AnalyticsOverview } from "../api/types";

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

function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const ACTION_ICON: Record<string, string> = {
  created: "➕",
  updated: "✏️",
  deleted: "🗑",
  checked_out: "📤",
  checked_in: "📥",
  maintenance: "🔧",
  published: "🚀",
  sent: "✉️",
};

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, loading } = useFetch<AnalyticsOverview>("/api/analytics/overview");

  // Generate warranty notifications on load (idempotent on the backend).
  useEffect(() => {
    void api("/api/notifications/check-warranties", { method: "POST" }).catch(() => {});
  }, []);

  const c = data?.counts;
  const alerts = data?.assets.warranty_alerts ?? [];

  return (
    <div>
      <PageHead
        title={`Welcome, ${user?.given_name ?? user?.display_name ?? "there"} 👋`}
        subtitle="Your company marketing & employee toolkit at a glance."
      />

      {loading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid cols-4">
            <Stat value={c!.employees} label="Employees" to="/directory" />
            <Stat value={c!.cards} label="Digital Cards" to="/cards" />
            <Stat value={c!.assets} label="Tracked Assets" to="/asset-tracker" />
            <Stat
              value={data.engagement.total_link_clicks}
              label="Total Link Clicks"
              to="/shortener"
            />
            <Stat value={c!.qrcodes} label="QR Codes" to="/qrcodes" />
            <Stat value={c!.landing_pages} label="Landing Pages" to="/landing-pages" />
            <Stat
              value={data.engagement.total_card_scans}
              label="Card Scans"
              to="/cards"
            />
            <Stat value={c!.short_links} label="Short Links" to="/shortener" />
          </div>

          <div className="grid cols-2" style={{ marginTop: 20 }}>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Short-link clicks</h3>
              <MiniBars
                data={data.series.clicks}
                label="Clicks"
                color="var(--brand)"
              />
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Card scans</h3>
              <MiniBars
                data={data.series.scans}
                label="Scans"
                color="#16a34a"
              />
            </div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 20 }}>
            {/* Recent activity */}
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Recent activity</h3>
              {data.recent_activity.length === 0 ? (
                <div className="muted">No activity yet.</div>
              ) : (
                <div>
                  {data.recent_activity.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        padding: "8px 0",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <span style={{ flex: "0 0 auto" }}>
                        {ACTION_ICON[a.action] ?? "•"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div>{a.summary}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {a.actor ?? "Someone"} · {timeAgo(a.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Alerts + asset health + quick actions */}
            <div className="row" style={{ flexDirection: "column", gap: 16, alignItems: "stretch" }}>
              <div className="card">
                <h3 style={{ marginTop: 0 }}>
                  Warranties expiring soon{" "}
                  {alerts.length > 0 && (
                    <span className="badge amber">{alerts.length}</span>
                  )}
                </h3>
                {alerts.length === 0 ? (
                  <div className="muted">Nothing expiring in the next 30 days. ✅</div>
                ) : (
                  <table>
                    <tbody>
                      {alerts.slice(0, 5).map((a) => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 600 }}>{a.name}</td>
                          <td className="muted">
                            <code>{a.asset_tag}</code>
                          </td>
                          <td>
                            <span
                              className={`badge ${a.days_left <= 7 ? "red" : "amber"}`}
                            >
                              {a.days_left}d left
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="card">
                <h3 style={{ marginTop: 0 }}>Quick actions</h3>
                <div className="row" style={{ gap: 10 }}>
                  <Link className="btn btn-primary" to="/cards">
                    New digital card
                  </Link>
                  <Link className="btn" to="/asset-tracker">
                    Add asset
                  </Link>
                  <Link className="btn" to="/qrcodes">
                    Generate QR
                  </Link>
                  <Link className="btn" to="/shortener">
                    Shorten URL
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
