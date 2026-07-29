import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckSquare,
  PartyPopper,
  LifeBuoy,
  Stamp,
  UserCheck,
} from "lucide-react";
import { api } from "../api/client";
import type { WorkSummary } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { MetricCard, useToast } from "./ui";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Personal "what needs me today" panel shown at the top of the dashboard. */
export default function MyWork() {
  const { can } = useAuth();
  const { notify } = useToast();
  const { data, reload } = useFetch<WorkSummary>("/api/me/work");
  if (!data) return null;

  async function completeOnboarding(id: string) {
    await api(`/api/me/onboarding-tasks/${id}/done`, { method: "POST" });
    notify("Marked done.");
    reload();
  }

  const nothing =
    data.tasks_open === 0 &&
    data.approvals_pending === 0 &&
    data.approvals_to_review === 0 &&
    data.tickets_open === 0 &&
    data.tickets_assigned === 0 &&
    data.onboarding_open === 0;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="m-0">My work</h3>

      {/* Exactly 4 cards → exactly 4 columns (not auto-fill, which invents empty tracks). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <Card size="sm">
          <CardContent className="flex items-center justify-center gap-2 text-center text-muted-foreground">
            <PartyPopper aria-hidden="true" /> You're all caught up — nothing needs you right now.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          {data.my_onboarding_tasks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserCheck /> My onboarding actions
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col">
                {data.my_onboarding_tasks.slice(0, 6).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 border-b py-2 last:border-0"
                  >
                    <span className="truncate text-sm font-medium">{t.title}</span>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => completeOnboarding(t.id)}
                    >
                      <CheckSquare data-icon="inline-start" /> Done
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
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
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MetricCard
        value={value}
        label={label}
        sub={sub}
        icon={icon}
        tone={danger && value > 0 ? "destructive" : "default"}
      />
    </Link>
  );
}

function Panel({ title, to, children }: { title: string; to: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Link to={to} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hover:no-underline")}>
            View all ›
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col">{children}</CardContent>
    </Card>
  );
}

function Row({ label, meta, warn }: { label: string; meta?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b py-2 last:border-0">
      <span className="truncate text-sm font-medium">{label}</span>
      {meta && (
        <span className={`flex-none text-xs ${warn ? "text-destructive" : "text-muted-foreground"}`}>
          {meta}
        </span>
      )}
    </div>
  );
}
