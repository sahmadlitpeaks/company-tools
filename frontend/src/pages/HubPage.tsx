import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Loading, MetricCard, PageHead } from "../components/ui";
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

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<CheckSquare size={16} />} value={w.tasks_open} label="Open tasks" to="/tasks" />
        <Stat icon={<Clock3 size={16} />} value={hm(wsum.data?.total_minutes ?? 0)} label="Time logged" to="/work-log" />
        <Stat icon={<LifeBuoy size={16} />} value={w.tickets_open + w.tickets_assigned} label="My tickets" to="/service-desk" />
        <Stat icon={<FolderHeart size={16} />} value={docs.data?.length ?? 0} label="My docs" to="/my-docs" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
    <Link to={to} aria-label={label} title={label} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <MetricCard value={value} label={label} icon={icon} />
    </Link>
  );
}

function Panel({ title, to, addTo, children }: { title: string; to: string; addTo: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction className="col-start-1 row-span-1 row-start-2 flex items-center gap-2 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
          <Link to={addTo} className={buttonVariants({ variant: "outline", size: "sm" })}><Plus data-icon="inline-start" /> Add</Link>
          <Link to={to} className={buttonVariants({ variant: "link", size: "sm" })}>View all ›</Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col">{children}</CardContent>
    </Card>
  );
}

function Row({ label, meta, warn, icon }: { label: string; meta?: string; warn?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b py-2 last:border-0">
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-sm font-medium">
        {icon}
        {label}
      </span>
      {meta && <span className={`flex-none text-xs ${warn ? "text-destructive" : "text-muted-foreground"}`}>{meta}</span>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
