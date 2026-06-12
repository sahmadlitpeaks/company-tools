import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  ShieldAlert,
  UserPlus,
  Users,
} from "lucide-react";
import { Zap } from "lucide-react";
import type { HrCountItem, HrJoiner, HrOverview } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, PageHead } from "../components/ui";

export default function HrDashboardPage() {
  const { user } = useAuth();
  const { data, loading, error } = useFetch<HrOverview>("/api/hr/overview");
  if (loading) return <Loading />;
  if (error || !data) return <Empty message="HR dashboard unavailable." />;

  const attention = [
    {
      icon: <CalendarClock size={15} />,
      label: "Pending leave approvals",
      count: data.pending_leave,
      to: "/approvals",
    },
    {
      icon: <FileWarning size={15} />,
      label: "Documents expiring ≤ 60 days",
      count: data.docs_expiring,
      to: "/directory",
    },
    {
      icon: <ShieldAlert size={15} />,
      label: "Contracts ending ≤ 60 days",
      count: data.contracts_expiring,
      to: "/directory",
    },
    {
      icon: <CalendarClock size={15} />,
      label: "Probation ending ≤ 30 days",
      count: data.probation_ending,
      to: "/directory",
    },
  ];

  return (
    <div>
      <PageHead
        title="HR Dashboard"
        subtitle="People operations at a glance."
        action={
          user?.is_admin ? (
            <Link
              to="/hr/automations"
              className="btn inline-flex items-center gap-1.5 hover:no-underline"
              style={{ flex: "0 0 auto" }}
            >
              <Zap size={15} /> Automations
            </Link>
          ) : undefined
        }
      />

      {/* KPI tiles */}
      <div
        className="grid mb-4"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}
      >
        <Kpi icon={Users} label="Headcount" value={data.headcount} to="/directory" />
        <Kpi icon={CalendarOff} label="On leave today" value={data.on_leave_today} to="/leave" />
        <Kpi
          icon={ClipboardList}
          label="Open review cycles"
          value={data.open_review_cycles}
          to="/performance"
        />
        <Kpi
          icon={UserPlus}
          label="Onboarding journeys"
          value={data.open_journeys}
          to="/people-ops"
        />
      </div>

      {/* Attention + breakdowns */}
      <div
        className="grid mb-4"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}
      >
        <AttentionCard items={attention} />
        <BarCard title="Headcount by department" rows={data.by_department} />
        <BarCard title="By employment type" rows={data.by_employment_type} />
      </div>

      {/* Joiners */}
      <div className="grid cols-2">
        <JoinerCard
          title="Recent joiners"
          hint="last 30 days"
          rows={data.recent_joiners}
          empty="No one joined in the last 30 days."
        />
        <JoinerCard
          title="Upcoming joiners"
          hint="scheduled starts"
          rows={data.upcoming_joiners}
          empty="No one is scheduled to start."
        />
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: React.ComponentType<{ size?: number | string }>;
  label: string;
  value: number;
  to: string;
}) {
  return (
    <Link to={to} className="card group flex items-center gap-3.5 !py-4 hover:no-underline">
      <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[26px] font-bold leading-none -tracking-[0.02em] text-ink [font-variant-numeric:tabular-nums]">
          {value}
        </span>
        <span className="mt-1 block truncate text-[13px] font-medium text-ink-muted">
          {label}
        </span>
      </span>
      <ArrowUpRight
        size={16}
        className="flex-none text-ink-muted opacity-0 transition-opacity group-hover:opacity-70"
      />
    </Link>
  );
}

function AttentionCard({
  items,
}: {
  items: { icon: React.ReactNode; label: string; count: number; to: string }[];
}) {
  const open = items.filter((i) => i.count > 0);
  return (
    <div className="card">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="m-0">Needs attention</h3>
        {open.length > 0 && <span className="badge amber">{open.length}</span>}
      </div>
      {open.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--border-strong)] px-3 py-4 text-sm text-ink-muted">
          <CheckCircle2 size={18} className="flex-none" style={{ color: "var(--ok)" }} />
          All clear — nothing needs your attention right now.
        </div>
      ) : (
        <div className="-mx-1.5">
          {items.map((i) => (
            <Link
              key={i.label}
              to={i.to}
              className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-[var(--surface-2)] hover:no-underline"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className="flex-none"
                  style={{ color: i.count > 0 ? "var(--warn)" : "var(--muted)" }}
                >
                  {i.icon}
                </span>
                <span className={`truncate ${i.count === 0 ? "text-ink-muted" : "font-medium"}`}>
                  {i.label}
                </span>
              </span>
              <span className={`badge ${i.count > 0 ? "amber" : ""}`}>{i.count}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function BarCard({ title, rows }: { title: string; rows: HrCountItem[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="m-0">{title}</h3>
        <span className="text-xs text-ink-muted">{total} total</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted text-sm">No data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="capitalize">{r.label}</span>
                <span className="font-semibold [font-variant-numeric:tabular-nums]">
                  {r.count}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${(r.count / max) * 100}%`,
                    background: "linear-gradient(90deg, var(--brand-400), var(--brand-600))",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function joinerInitials(name?: string | null): string {
  const src = (name || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function JoinerCard({
  title,
  hint,
  rows,
  empty,
}: {
  title: string;
  hint: string;
  rows: HrJoiner[];
  empty: string;
}) {
  return (
    <div className="card">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h3 className="m-0">{title}</h3>
        <span className="text-xs text-ink-muted">{hint}</span>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-6 text-center">
          <UserPlus size={20} className="text-ink-muted opacity-60" />
          <span className="text-sm text-ink-muted">{empty}</span>
        </div>
      ) : (
        <div className="-mx-1.5">
          {rows.map((j) => (
            <Link
              key={j.id}
              to={`/people/${j.id}`}
              className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-ink hover:bg-[var(--surface-2)] hover:no-underline"
            >
              <span className="avatar !h-8 !w-8 text-[11px]">{joinerInitials(j.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{j.name || "—"}</span>
                {j.job_title && (
                  <span className="block truncate text-xs text-ink-muted">{j.job_title}</span>
                )}
              </span>
              {j.hire_date && <span className="badge flex-none">{j.hire_date}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
