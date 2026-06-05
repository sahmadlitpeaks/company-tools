import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckSquare,
  LifeBuoy,
  Stamp,
} from "lucide-react";
import type { WorkSummary } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";

/** Personal "what needs me today" panel shown at the top of the dashboard. */
export default function MyWork() {
  const { can } = useAuth();
  const { data } = useFetch<WorkSummary>("/api/me/work");
  if (!data) return null;

  const nothing =
    data.tasks_open === 0 &&
    data.approvals_pending === 0 &&
    data.approvals_to_review === 0 &&
    data.tickets_open === 0 &&
    data.tickets_assigned === 0;

  return (
    <div className="mb-5">
      <h3 className="mb-3">My work</h3>

      <div className="grid cols-4 mb-4">
        {can("tasks") && (
          <StatCard
            to="/tasks"
            icon={<CheckSquare size={16} />}
            value={data.tasks_open}
            label="Open tasks"
            sub={data.tasks_overdue > 0 ? `${data.tasks_overdue} overdue` : undefined}
            danger={data.tasks_overdue > 0}
          />
        )}
        {can("approvals") && (
          <StatCard
            to="/approvals"
            icon={<Stamp size={16} />}
            value={data.approvals_to_review}
            label="To review"
            sub={`${data.approvals_pending} of mine pending`}
          />
        )}
        {can("service_desk") && (
          <StatCard
            to="/service-desk"
            icon={<LifeBuoy size={16} />}
            value={data.tickets_assigned}
            label="Tickets assigned"
            sub={`${data.tickets_open} raised by me`}
          />
        )}
        {can("tasks") && (
          <StatCard
            to="/tasks"
            icon={<AlertTriangle size={16} />}
            value={data.tasks_overdue}
            label="Overdue"
            danger={data.tasks_overdue > 0}
          />
        )}
      </div>

      {nothing ? (
        <div className="card text-center text-ink-muted">
          You're all caught up — nothing needs you right now. 🎉
        </div>
      ) : (
        <div className="grid cols-3">
          {can("tasks") && data.my_tasks.length > 0 && (
            <Panel title="My tasks" to="/tasks">
              {data.my_tasks.slice(0, 5).map((t) => (
                <Row
                  key={t.id}
                  label={t.title}
                  meta={t.due_date ?? t.priority}
                  warn={!!t.due_date && new Date(t.due_date) < new Date()}
                />
              ))}
            </Panel>
          )}
          {can("approvals") && data.review_approvals.length > 0 && (
            <Panel title="Awaiting my approval" to="/approvals">
              {data.review_approvals.slice(0, 5).map((a) => (
                <Row key={a.id} label={a.title} meta={`${a.type} · ${a.requester_name ?? ""}`} />
              ))}
            </Panel>
          )}
          {can("service_desk") && data.my_tickets.length > 0 && (
            <Panel title="My tickets" to="/service-desk">
              {data.my_tickets.slice(0, 5).map((t) => (
                <Row key={t.id} label={t.subject} meta={`${t.category} · ${t.status.replace("_", " ")}`} />
              ))}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  to,
  icon,
  value,
  label,
  sub,
  danger,
}: {
  to: string;
  icon: React.ReactNode;
  value: number;
  label: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <Link to={to} className="card stat">
      <div className="flex items-center gap-2">
        <span
          className="grid h-8 w-8 place-items-center rounded-lg"
          style={{
            background: danger && value > 0 ? "color-mix(in srgb, var(--danger) 15%, var(--surface))" : "var(--brand-50)",
            color: danger && value > 0 ? "var(--danger)" : "var(--brand-600)",
          }}
        >
          {icon}
        </span>
        <div className="value" style={{ fontSize: 26 }}>{value}</div>
      </div>
      <div className="label">{label}</div>
      {sub && <div className="muted text-xs">{sub}</div>}
    </Link>
  );
}

function Panel({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="spread mb-2">
        <h4 className="m-0">{title}</h4>
        <Link to={to} className="text-xs font-medium text-brand-600">
          View all ›
        </Link>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({ label, meta, warn }: { label: string; meta?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-2 last:border-0">
      <span className="truncate text-sm font-medium">{label}</span>
      {meta && (
        <span className={`flex-none text-xs ${warn ? "text-red-600" : "text-ink-muted"}`}>
          {meta}
        </span>
      )}
    </div>
  );
}
