import { useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useFetch } from "../hooks/useApi";
import { Loading, MiniBars } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import type { AnalyticsOverview } from "../api/types";

function StatCard({
  value,
  label,
  to,
  icon,
  accent,
}: {
  value: number | string;
  label: string;
  to: string;
  icon: string;
  accent: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:no-underline hover:shadow-soft"
    >
      <span
        className={`grid h-11 w-11 flex-none place-items-center rounded-xl text-lg ${accent}`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-none -tracking-[0.02em] text-ink">
          {value}
        </span>
        <span className="mt-1 block truncate text-[13px] text-ink-muted">{label}</span>
      </span>
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

  useEffect(() => {
    void api("/api/notifications/check-warranties", { method: "POST" }).catch(() => {});
  }, []);

  const c = data?.counts;
  const alerts = data?.assets.warranty_alerts ?? [];

  return (
    <div className="space-y-5">
      {/* Hero banner */}
      <div
        className="relative overflow-hidden rounded-2xl p-6 text-white shadow-soft sm:p-7"
        style={{
          background:
            "radial-gradient(1200px 200px at 0% 0%, rgba(255,255,255,.14), transparent 60%), linear-gradient(120deg, #08406f 0%, #0b5cab 55%, #1e6cc0 100%)",
        }}
      >
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-white/60">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </div>
            <h1 className="m-0 mt-1 text-white">
              Welcome back, {user?.given_name ?? user?.display_name ?? "there"}
            </h1>
            <p className="mt-1 max-w-xl text-white/75">
              Your company marketing &amp; employee toolkit at a glance.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                to="/cards"
                className="rounded-[10px] bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-white/90 hover:no-underline"
              >
                + New digital card
              </Link>
              <Link
                to="/asset-tracker"
                className="rounded-[10px] bg-white/15 px-4 py-2 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 hover:bg-white/25 hover:no-underline"
              >
                Add asset
              </Link>
              <Link
                to="/shortener"
                className="rounded-[10px] bg-white/15 px-4 py-2 text-sm font-semibold text-white ring-1 ring-inset ring-white/20 hover:bg-white/25 hover:no-underline"
              >
                Shorten URL
              </Link>
            </div>
          </div>
          <div className="hidden h-16 w-16 flex-none place-items-center rounded-2xl bg-white/10 text-2xl ring-1 ring-inset ring-white/20 sm:grid">
            📊
          </div>
        </div>
      </div>

      {loading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard value={c!.employees} label="Employees" to="/directory" icon="👥" accent="bg-blue-50 text-blue-600" />
            <StatCard value={c!.cards} label="Digital Cards" to="/cards" icon="💳" accent="bg-violet-50 text-violet-600" />
            <StatCard value={c!.assets} label="Tracked Assets" to="/asset-tracker" icon="🏷" accent="bg-amber-50 text-amber-600" />
            <StatCard value={data.engagement.total_link_clicks} label="Link Clicks" to="/shortener" icon="🔗" accent="bg-emerald-50 text-emerald-600" />
            <StatCard value={c!.qrcodes} label="QR Codes" to="/qrcodes" icon="▣" accent="bg-slate-100 text-slate-600" />
            <StatCard value={c!.landing_pages} label="Landing Pages" to="/landing-pages" icon="🖥" accent="bg-cyan-50 text-cyan-600" />
            <StatCard value={data.engagement.total_card_scans} label="Card Scans" to="/cards" icon="📈" accent="bg-rose-50 text-rose-600" />
            <StatCard value={c!.short_links} label="Short Links" to="/shortener" icon="✂️" accent="bg-indigo-50 text-indigo-600" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <div className="spread mb-3">
                <h3 className="m-0">Short-link clicks</h3>
                <span className="badge blue">14 days</span>
              </div>
              <MiniBars data={data.series.clicks} label="Clicks" color="var(--brand)" />
            </div>
            <div className="card">
              <div className="spread mb-3">
                <h3 className="m-0">Card scans</h3>
                <span className="badge green">14 days</span>
              </div>
              <MiniBars data={data.series.scans} label="Scans" color="#16a34a" />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Recent activity */}
            <div className="card">
              <h3 className="mt-0">Recent activity</h3>
              {data.recent_activity.length === 0 ? (
                <div className="muted">No activity yet.</div>
              ) : (
                <div className="-mb-2">
                  {data.recent_activity.map((a) => (
                    <div
                      key={a.id}
                      className="flex gap-3 border-b border-[var(--border)] py-2 last:border-0"
                    >
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-slate-100">
                        {ACTION_ICON[a.action] ?? "•"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{a.summary}</div>
                        <div className="text-xs text-ink-muted">
                          {a.actor ?? "Someone"} · {timeAgo(a.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Warranty alerts */}
            <div className="card">
              <h3 className="mt-0">
                Warranties expiring soon{" "}
                {alerts.length > 0 && <span className="badge amber">{alerts.length}</span>}
              </h3>
              {alerts.length === 0 ? (
                <div className="muted">Nothing expiring in the next 30 days. ✅</div>
              ) : (
                <table>
                  <tbody>
                    {alerts.slice(0, 6).map((a) => (
                      <tr key={a.id}>
                        <td className="font-semibold">{a.name}</td>
                        <td className="muted">
                          <code>{a.asset_tag}</code>
                        </td>
                        <td>
                          <span className={`badge ${a.days_left <= 7 ? "red" : "amber"}`}>
                            {a.days_left}d left
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
