import { Link } from "react-router-dom";
import {
  CalendarClock,
  CalendarOff,
  ClipboardList,
  FileWarning,
  ShieldAlert,
  UserPlus,
  Users,
} from "lucide-react";
import type { HrCountItem, HrOverview } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead } from "../components/ui";

export default function HrDashboardPage() {
  const { data, loading, error } = useFetch<HrOverview>("/api/hr/overview");
  if (loading) return <Loading />;
  if (error || !data) return <Empty message="HR dashboard unavailable." />;

  return (
    <div>
      <PageHead title="HR Dashboard" subtitle="People operations at a glance." />

      <div className="grid mb-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <Stat icon={<Users size={16} />} label="Headcount" value={data.headcount} />
        <Stat icon={<CalendarOff size={16} />} label="On leave today" value={data.on_leave_today} to="/leave" />
        <Stat icon={<CalendarClock size={16} />} label="Pending leave" value={data.pending_leave} to="/approvals" accent={data.pending_leave > 0} />
        <Stat icon={<FileWarning size={16} />} label="Docs expiring ≤60d" value={data.docs_expiring} accent={data.docs_expiring > 0} />
        <Stat icon={<ShieldAlert size={16} />} label="Contracts ≤60d" value={data.contracts_expiring} accent={data.contracts_expiring > 0} />
        <Stat icon={<CalendarClock size={16} />} label="Probation ≤30d" value={data.probation_ending} />
        <Stat icon={<ClipboardList size={16} />} label="Open review cycles" value={data.open_review_cycles} to="/performance" />
        <Stat icon={<UserPlus size={16} />} label="Open journeys" value={data.open_journeys} to="/people-ops" />
      </div>

      <div className="grid cols-2">
        <BarCard title="Headcount by department" rows={data.by_department} />
        <BarCard title="By employment type" rows={data.by_employment_type} />
      </div>

      <div className="grid cols-2 mt-4">
        <JoinerCard title="Recent joiners (30 days)" rows={data.recent_joiners} empty="No recent joiners." />
        <JoinerCard title="Upcoming joiners" rows={data.upcoming_joiners} empty="No one scheduled to start." />
      </div>
    </div>
  );
}

function Stat({
  icon, label, value, to, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  to?: string;
  accent?: boolean;
}) {
  const body = (
    <div className="card">
      <div className="muted flex items-center gap-1.5 text-xs">{icon} {label}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color: accent ? "var(--brand-600)" : undefined }}>{value}</div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

function BarCard({ title, rows }: { title: string; rows: HrCountItem[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="card">
      <h3 className="mt-0">{title}</h3>
      {rows.length === 0 ? (
        <p className="muted text-sm">No data.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex justify-between text-sm">
                <span className="capitalize">{r.label}</span>
                <span className="font-medium">{r.count}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JoinerCard({ title, rows, empty }: { title: string; rows: HrOverview["recent_joiners"]; empty: string }) {
  return (
    <div className="card">
      <h3 className="mt-0">{title}</h3>
      {rows.length === 0 ? (
        <p className="muted text-sm">{empty}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((j) => (
            <Link key={j.id} to={`/people/${j.id}`} className="flex items-center justify-between py-1.5 text-sm hover:text-brand-600">
              <span><span className="font-medium">{j.name}</span>{j.job_title ? <span className="muted"> · {j.job_title}</span> : ""}</span>
              <span className="muted">{j.hire_date}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
