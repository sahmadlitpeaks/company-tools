import { Link } from "react-router-dom";
import {
  CheckSquare,
  Clock3,
  FileText,
  FolderHeart,
  LifeBuoy,
  Plus,
} from "lucide-react";
import type { WorkLog, WorkLogSummary, WorkspaceItem, WorkSummary } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Loading, PageHead } from "../components/ui";
import { hm } from "./WorkLogPage";

export default function HubPage() {
  const work = useFetch<WorkSummary>("/api/me/work");
  const wsum = useFetch<WorkLogSummary>("/api/worklogs/summary?scope=mine");
  const logs = useFetch<WorkLog[]>("/api/worklogs?scope=mine");
  const docs = useFetch<WorkspaceItem[]>("/api/workspace");

  if (!work.data) return <Loading />;
  const w = work.data;

  return (
    <div>
      <PageHead title="My Workspace" subtitle="Everything you're working on — tasks, time, tickets and docs in one place." />

      <div className="grid cols-4 mb-5">
        <Stat icon={<CheckSquare size={16} />} value={w.tasks_open} label="Open tasks" to="/tasks" />
        <Stat icon={<Clock3 size={16} />} value={hm(wsum.data?.total_minutes ?? 0)} label="Time logged" to="/work-log" />
        <Stat icon={<LifeBuoy size={16} />} value={w.tickets_open + w.tickets_assigned} label="My tickets" to="/service-desk" />
        <Stat icon={<FolderHeart size={16} />} value={docs.data?.length ?? 0} label="My docs" to="/my-docs" />
      </div>

      <div className="grid cols-2">
        {/* Tasks */}
        <Panel title="My tasks" to="/tasks" addTo="/tasks?new=1">
          {w.my_tasks.length === 0 ? (
            <Empty text="No open tasks." />
          ) : (
            w.my_tasks.slice(0, 6).map((t) => (
              <Row key={t.id} label={t.title} meta={t.due_date ?? t.priority} warn={!!t.due_date && new Date(t.due_date) < new Date()} />
            ))
          )}
        </Panel>

        {/* Time / work log */}
        <Panel title="Recent work" to="/work-log" addTo="/work-log">
          {(logs.data?.length ?? 0) === 0 ? (
            <Empty text="Nothing logged yet." />
          ) : (
            logs.data!.slice(0, 6).map((l) => (
              <Row
                key={l.id}
                label={l.description}
                meta={`${l.kind} · ${hm(l.minutes)}`}
              />
            ))
          )}
        </Panel>

        {/* My docs */}
        <Panel title="My docs" to="/my-docs" addTo="/my-docs">
          {(docs.data?.length ?? 0) === 0 ? (
            <Empty text="No docs saved." />
          ) : (
            docs.data!.slice(0, 6).map((d) => (
              <Row key={d.id} label={d.title} meta={d.kind} icon={<FileText size={13} />} />
            ))
          )}
        </Panel>

        {/* Tickets */}
        <Panel title="My tickets" to="/service-desk" addTo="/service-desk?new=1">
          {w.my_tickets.length === 0 ? (
            <Empty text="No open tickets." />
          ) : (
            w.my_tickets.slice(0, 6).map((t) => (
              <Row key={t.id} label={t.subject} meta={`${t.category} · ${t.status.replace("_", " ")}`} />
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ icon, value, label, to }: { icon: React.ReactNode; value: React.ReactNode; label: string; to: string }) {
  return (
    <Link to={to} className="card stat">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "var(--brand-50)", color: "var(--brand-600)" }}>
          {icon}
        </span>
        <div className="value" style={{ fontSize: 24 }}>{value}</div>
      </div>
      <div className="label">{label}</div>
    </Link>
  );
}

function Panel({ title, to, addTo, children }: { title: string; to: string; addTo: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="spread mb-2">
        <h4 className="m-0">{title}</h4>
        <span className="flex items-center gap-2">
          <Link to={addTo} className="btn-sm inline-flex items-center gap-1"><Plus size={13} /> Add</Link>
          <Link to={to} className="text-xs font-medium text-brand-600">View all ›</Link>
        </span>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({ label, meta, warn, icon }: { label: string; meta?: string; warn?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-2 last:border-0">
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-sm font-medium">
        {icon}
        {label}
      </span>
      {meta && <span className={`flex-none text-xs ${warn ? "text-red-600" : "text-ink-muted"}`}>{meta}</span>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="muted text-sm">{text}</p>;
}
