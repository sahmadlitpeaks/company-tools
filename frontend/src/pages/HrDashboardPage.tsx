import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import {
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
import { Empty, Loading, MetricCard, PageHead } from "../components/ui";

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
              className={buttonVariants({ variant: "outline" })}
            >
               <Zap data-icon="inline-start" /> Automations
            </Link>
          ) : undefined
        }
      />

      {/* KPI tiles */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <AttentionCard items={attention} />
        <BarCard title="Headcount by department" rows={data.by_department} />
        <BarCard title="By employment type" rows={data.by_employment_type} />
      </div>

      {/* Joiners */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
    <Link to={to} aria-label={label} title={label} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <MetricCard value={value} label={label} icon={<Icon />} />
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
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        {open.length > 0 && <CardAction><Badge variant="warning">{open.length}</Badge></CardAction>}
      </CardHeader>
      <CardContent>
      {open.length === 0 ? (
        <div className="flex items-center gap-2.5 border border-dashed px-3 py-4 text-sm text-muted-foreground">
          <CheckCircle2 className="flex-none text-success" />
          All clear — nothing needs your attention right now.
        </div>
      ) : (
        <div className="-mx-1.5">
          {items.map((i) => (
            <Link
              key={i.label}
              to={i.to}
              className="flex items-center justify-between gap-2 px-2.5 py-2 text-sm text-foreground hover:bg-muted hover:no-underline"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className={i.count > 0 ? "flex-none text-warning" : "flex-none text-muted-foreground"}>
                  {i.icon}
                </span>
                <span className={`truncate ${i.count === 0 ? "text-muted-foreground" : "font-medium"}`}>
                  {i.label}
                </span>
              </span>
              <Badge variant={i.count > 0 ? "warning" : "secondary"}>{i.count}</Badge>
            </Link>
          ))}
        </div>
      )}
      </CardContent>
    </Card>
  );
}

function BarCard({ title, rows }: { title: string; rows: HrCountItem[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{total} total</CardDescription></CardHeader>
      <CardContent>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <div key={r.label}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="capitalize">{r.label}</span>
                <span className="font-semibold [font-variant-numeric:tabular-nums]">
                  {r.count}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden bg-muted">
                <div
                  className="h-full bg-primary"
                  style={{
                    width: `${(r.count / max) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{hint}</CardDescription></CardHeader>
      <CardContent>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 border border-dashed px-4 py-6 text-center">
          <UserPlus className="text-muted-foreground opacity-60" />
          <span className="text-sm text-muted-foreground">{empty}</span>
        </div>
      ) : (
        <div className="-mx-1.5">
          {rows.map((j) => (
            <Link
              key={j.id}
              to={`/people/${j.id}`}
              className="flex items-center gap-3 px-2.5 py-2 text-foreground hover:bg-muted hover:no-underline"
            >
              <Avatar className="size-8"><AvatarFallback>{joinerInitials(j.name)}</AvatarFallback></Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{j.name || "—"}</span>
                {j.job_title && (
                  <span className="block truncate text-xs text-muted-foreground">{j.job_title}</span>
                )}
              </span>
              {j.hire_date && <Badge variant="secondary">{j.hire_date}</Badge>}
            </Link>
          ))}
        </div>
      )}
      </CardContent>
    </Card>
  );
}
