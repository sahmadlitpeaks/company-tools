import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarDays,
  CalendarOff,
  Cake,
  CheckCircle2,
  CheckSquare,
  CreditCard,
  FileText,
  History,
  LayoutTemplate,
  LifeBuoy,
  Link2,
  Megaphone,
  Palmtree,
  PartyPopper,
  QrCode,
  ScanLine,
  Stamp,
  Timer,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/api/client";
import type {
  AnalyticsOverview,
  Announcement,
  Celebration,
  HomeFeed,
  LeaveBalance,
  TimeSummary,
  WorkSummary,
} from "@/api/types";
import type { CalEvent } from "@/pages/CalendarPage";
import { ErrorState, Loading, useToast } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface DashboardResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

function duration(minutes: number) {
  const rounded = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

function parseDate(value: string) {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
}

function parseUtc(value: string) {
  return new Date(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
}

function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return parseDate(value).toLocaleDateString(
    undefined,
    options ?? { month: "short", day: "numeric" },
  );
}

function initials(name?: string | null) {
  const parts = (name || "?").trim().split(/\s+/);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0].slice(0, 2)).toUpperCase();
}

function CardLoading() {
  return (
    <CardContent>
      <Loading />
    </CardContent>
  );
}

function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <CardContent>
      <ErrorState message={message} onRetry={onRetry} />
    </CardContent>
  );
}

export function WelcomeCard({
  name,
  work,
  canTasks,
  canApprovals,
  canAnnouncements,
}: {
  name: string;
  work: DashboardResource<WorkSummary>;
  canTasks: boolean;
  canApprovals: boolean;
  canAnnouncements: boolean;
}) {
  const attention = work.data
    ? [
        canTasks && work.data.tasks_overdue > 0
          ? `${work.data.tasks_overdue} overdue task${work.data.tasks_overdue === 1 ? "" : "s"}`
          : null,
        canApprovals && work.data.approvals_to_review > 0
          ? `${work.data.approvals_to_review} approval${work.data.approvals_to_review === 1 ? "" : "s"} to review`
          : null,
        canAnnouncements && work.data.announcements_unread > 0
          ? `${work.data.announcements_unread} unread announcement${work.data.announcements_unread === 1 ? "" : "s"}`
          : null,
      ].filter((item): item is string => !!item)
    : [];

  return (
    <Card className="bg-sidebar text-sidebar-foreground ring-sidebar-border lg:col-span-8">
      <CardHeader>
        <CardDescription className="text-sidebar-foreground">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </CardDescription>
        <CardTitle className="text-2xl tracking-tight text-sidebar-foreground sm:text-3xl">
          Welcome back, {name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border border-sidebar-border bg-sidebar-accent px-4 py-3 text-sidebar-accent-foreground">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
            {attention.length > 0 ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
            Attention today
          </div>
          {work.loading && !work.data ? (
            <p className="m-0 text-sm">Checking what needs you today...</p>
          ) : work.error ? (
            <p className="m-0 text-sm">Your work summary is temporarily unavailable.</p>
          ) : attention.length > 0 ? (
            <p className="m-0 text-sm font-medium">{attention.join(" · ")}</p>
          ) : (
            <p className="m-0 text-sm font-medium">Nothing urgent is waiting for you.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function QuickActionsCard({ can }: { can: (module: string) => boolean }) {
  const actions: Array<{ label: string; to: string; module?: string; icon: LucideIcon }> = [
    { label: "My tasks", to: "/tasks", module: "tasks", icon: CheckSquare },
    { label: "Calendar", to: "/calendar", module: "calendar", icon: CalendarDays },
    { label: "Request leave", to: "/leave", module: "approvals", icon: Palmtree },
    { label: "Approvals", to: "/approvals", module: "approvals", icon: Stamp },
    { label: "Get help", to: "/service-desk", module: "service_desk", icon: LifeBuoy },
    { label: "My documents", to: "/my-docs", module: "workspace", icon: FileText },
  ];
  const available = actions.filter((action) => !action.module || can(action.module)).slice(0, 6);

  return (
    <Card className="lg:col-span-4">
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
        <CardDescription>Go straight to the tools you use most.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        {available.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.to}
              to={action.to}
              className="flex min-h-14 items-center gap-3 border border-border bg-background px-3 py-2 font-medium text-foreground hover:bg-muted hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-4 shrink-0 text-primary" />
              <span>{action.label}</span>
            </Link>
          );
        })}
        {available.length === 0 && (
          <Link
            to="/profile"
            className="col-span-2 flex min-h-14 items-center gap-3 border border-border bg-background px-3 py-2 font-medium text-foreground hover:bg-muted hover:no-underline"
          >
            <Users className="size-4 text-primary" /> My profile
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

export function TimeStatusCard({ summary }: { summary: DashboardResource<TimeSummary> }) {
  const { notify } = useToast();
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!summary.data) return;
    const timestamp = Date.now();
    setLoadedAt(timestamp);
    setNow(timestamp);
  }, [summary.data]);

  useEffect(() => {
    if (!summary.data?.open_entry || summary.data.active_break) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [summary.data?.active_break, summary.data?.open_entry]);

  const data = summary.data;
  const elapsed = data
    ? data.today_elapsed_minutes +
      (data.open_entry && !data.active_break
        ? Math.max(0, Math.floor((now - loadedAt) / 60_000))
        : 0)
    : 0;
  const expected = data
    ? Math.max(
        60,
        data.daily_expected_minutes || Math.round((data.week_expected_minutes || 2400) / 5),
      )
    : 480;
  const progress = Math.min(100, (elapsed / expected) * 100);
  const status = data?.active_break
    ? "On break"
    : data?.open_entry
      ? "Clocked in"
      : elapsed > 0
        ? "Clocked out"
        : "Not started";
  const clockedInAt = data?.open_entry?.clock_in
    ? parseUtc(data.open_entry.clock_in).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  async function clock() {
    setBusy(true);
    try {
      await api("/api/time/clock", { method: "POST" });
      await summary.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to update the time clock.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="size-4 text-primary" /> Today's time
        </CardTitle>
        <CardDescription>
          {clockedInAt ? `Started at ${clockedInAt}` : "Track progress against your daily schedule."}
        </CardDescription>
        {data && (
          <CardAction>
            <Badge variant={data.active_break ? "warning" : data.open_entry ? "success" : "secondary"}>
              {status}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      {summary.loading && !data ? (
        <CardLoading />
      ) : summary.error || !data ? (
        <CardError message={summary.error ?? "Time status is unavailable."} onRetry={summary.reload} />
      ) : (
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
                {duration(elapsed)}
              </div>
              <p className="mb-0 mt-2 text-sm text-muted-foreground">
                {data.today_break_minutes}m break · {duration(data.week_minutes)} this week
              </p>
            </div>
            <Button type="button" onClick={() => void clock()} disabled={busy}>
              <Timer data-icon="inline-start" />
              {busy ? "Updating..." : data.open_entry ? "Clock out" : "Clock in"}
            </Button>
          </div>
          <div>
            <Progress value={progress} aria-label="Daily work goal" />
            <div className="mt-2 flex items-center text-xs">
              <span>Daily goal: {duration(expected)}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">{Math.round(progress)}%</span>
            </div>
          </div>
        </CardContent>
      )}
      <CardFooter>
        <Link to="/time" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto")}>
          Open time tracking <ArrowRight data-icon="inline-end" />
        </Link>
      </CardFooter>
    </Card>
  );
}

interface WorkItem {
  id: string;
  label: string;
  meta: string;
  to?: string;
  overdue?: boolean;
  onboardingId?: string;
}

function taskMeta(dueDate: string | null | undefined, priority: string) {
  if (!dueDate) return priority;
  return `Due ${formatDate(dueDate)}`;
}

export function MyWorkCard({
  work,
  canTasks,
  canApprovals,
  canServiceDesk,
}: {
  work: DashboardResource<WorkSummary>;
  canTasks: boolean;
  canApprovals: boolean;
  canServiceDesk: boolean;
}) {
  const { notify } = useToast();
  const [completing, setCompleting] = useState<string | null>(null);
  const data = work.data;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const taskItems: WorkItem[] = canTasks
    ? (data?.my_tasks ?? []).map((task) => ({
        id: `task-${task.id}`,
        label: task.title,
        meta: taskMeta(task.due_date, task.priority),
        to: "/tasks",
        overdue: !!task.due_date && parseDate(task.due_date) < today,
      }))
    : [];
  const items: WorkItem[] = [
    ...taskItems.filter((item) => item.overdue),
    ...(canApprovals
      ? (data?.review_approvals ?? []).map((approval) => ({
          id: `approval-${approval.id}`,
          label: approval.title,
          meta: `${approval.type} · ${approval.requester_name ?? "Request"}`,
          to: "/approvals",
        }))
      : []),
    ...(data?.my_onboarding_tasks ?? []).map((task) => ({
      id: `onboarding-${task.id}`,
      label: task.title,
      meta: "Onboarding action",
      onboardingId: task.id,
    })),
    ...taskItems.filter((item) => !item.overdue),
    ...(canApprovals
      ? (data?.my_approvals ?? []).map((approval) => ({
          id: `my-approval-${approval.id}`,
          label: approval.title,
          meta: "My request · pending",
          to: "/approvals",
        }))
      : []),
    ...(canServiceDesk
      ? (data?.my_tickets ?? []).map((ticket) => ({
          id: `ticket-${ticket.id}`,
          label: ticket.subject,
          meta: `${ticket.category} · ${ticket.status.replace(/_/g, " ")}`,
          to: "/service-desk",
        }))
      : []),
  ];
  const visibleItems = items.slice(0, 5);
  const total = data
    ? (canTasks ? data.tasks_open : 0) +
      (canApprovals ? data.approvals_to_review + data.approvals_pending : 0) +
      (canServiceDesk ? data.tickets_assigned : 0) +
      data.onboarding_open
    : 0;

  async function completeOnboarding(id: string) {
    setCompleting(id);
    try {
      await api(`/api/me/onboarding-tasks/${id}/done`, { method: "POST" });
      notify("Marked done.");
      await work.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to complete this action.", "error");
    } finally {
      setCompleting(null);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>My work</CardTitle>
        <CardDescription>Your next five tasks, requests, and actions.</CardDescription>
        {data && (
          <CardAction>
            <Badge variant={data.tasks_overdue > 0 ? "destructive" : "secondary"}>{total} open</Badge>
          </CardAction>
        )}
      </CardHeader>
      {work.loading && !data ? (
        <CardLoading />
      ) : work.error || !data ? (
        <CardError message={work.error ?? "Your work is unavailable."} onRetry={work.reload} />
      ) : visibleItems.length === 0 ? (
        <CardContent>
          <div className="flex min-h-32 flex-col items-center justify-center border border-dashed border-border text-center">
            <CheckCircle2 className="mb-2 size-6 text-primary" />
            <p className="m-0 font-medium">You're all caught up.</p>
            <p className="m-0 mt-1 text-sm text-muted-foreground">Nothing needs your attention right now.</p>
          </div>
        </CardContent>
      ) : (
        <CardContent className="flex flex-col">
          {visibleItems.map((item) => {
            const content = (
              <>
                <span className={cn("grid size-8 shrink-0 place-items-center bg-muted", item.overdue && "text-destructive")}>
                  {item.overdue ? <AlertTriangle className="size-4" /> : <CheckSquare className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.label}</span>
                  <span className={cn("block truncate text-xs text-muted-foreground", item.overdue && "text-destructive")}>
                    {item.meta}
                  </span>
                </span>
              </>
            );

            return (
              <div key={item.id} className="flex min-h-14 items-center gap-3 border-b border-border py-2 last:border-0">
                {item.to ? (
                  <Link to={item.to} className="flex min-w-0 flex-1 items-center gap-3 text-foreground hover:no-underline">
                    {content}
                  </Link>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>
                )}
                {item.onboardingId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={completing === item.onboardingId}
                    onClick={() => void completeOnboarding(item.onboardingId!)}
                  >
                    Done
                  </Button>
                )}
              </div>
            );
          })}
          {total > visibleItems.length && (
            <p className="mb-0 mt-3 text-xs text-muted-foreground">
              +{total - visibleItems.length} more across your workspaces
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function AnnouncementsCard({ announcements }: { announcements: DashboardResource<Announcement[]> }) {
  const items = announcements.data ?? [];
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="size-4 text-primary" /> Announcements
        </CardTitle>
        <CardDescription>The latest company updates.</CardDescription>
        <CardAction>
          <Link to="/announcements" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            View all
          </Link>
        </CardAction>
      </CardHeader>
      {announcements.loading && !announcements.data ? (
        <CardLoading />
      ) : announcements.error ? (
        <CardError message={announcements.error} onRetry={announcements.reload} />
      ) : items.length === 0 ? (
        <CardContent className="text-muted-foreground">No announcements yet.</CardContent>
      ) : (
        <CardContent className="flex flex-col">
          {items.slice(0, 3).map((item) => (
            <div key={item.id} className="border-b border-border py-3 first:pt-0 last:border-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <p className="m-0 font-medium">{item.title}</p>
                {!item.is_read && <Badge variant="info">New</Badge>}
              </div>
              <p className="mb-0 mt-1 line-clamp-2 text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function CelebrationIcon({ kind }: { kind: string }) {
  if (kind === "birthday") return <Cake className="size-3 text-primary" />;
  if (kind === "anniversary") return <PartyPopper className="size-3 text-primary" />;
  return <UserPlus className="size-3 text-primary" />;
}

function PersonAvatar({ name, url }: { name?: string | null; url?: string | null }) {
  return (
    <Avatar size="lg">
      {url && <AvatarImage src={url} alt={name ?? ""} />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function PersonRow({
  id,
  name,
  avatarUrl,
  detail,
  trailing,
}: {
  id?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  detail?: ReactNode;
  trailing?: ReactNode;
}) {
  const content = (
    <>
      <PersonAvatar name={name} url={avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name ?? "Employee"}</span>
        {detail && <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">{detail}</span>}
      </span>
      {trailing}
    </>
  );
  const className = "flex min-h-14 items-center gap-3 border-b border-border py-2 text-foreground last:border-0";

  return id ? (
    <Link to={`/people/${id}`} className={cn(className, "hover:no-underline")}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function PeopleTodayCard({ home }: { home: DashboardResource<HomeFeed> }) {
  const celebrations = home.data?.celebrations ?? [];
  const out = home.data?.whos_out ?? [];
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>People today</CardTitle>
        <CardDescription>Who's away and moments worth celebrating.</CardDescription>
      </CardHeader>
      {home.loading && !home.data ? (
        <CardLoading />
      ) : home.error ? (
        <CardError message={home.error} onRetry={home.reload} />
      ) : (
        <CardContent className="grid gap-6 md:grid-cols-2">
          <section aria-labelledby="dashboard-whos-out">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="dashboard-whos-out" className="m-0 flex items-center gap-2 text-sm font-semibold">
                <CalendarOff className="size-4 text-primary" /> Who's out
              </h3>
              {out.length > 6 && <Badge variant="secondary">+{out.length - 6} more</Badge>}
            </div>
            {out.length === 0 ? (
              <p className="m-0 border border-dashed border-border p-4 text-sm text-muted-foreground">Everyone is in today.</p>
            ) : (
              out.slice(0, 6).map((person) => (
                <PersonRow
                  key={person.user_id ?? `${person.name}-${person.leave_type}-${person.until ?? "today"}`}
                  id={person.user_id}
                  name={person.name}
                  avatarUrl={person.avatar_url}
                  detail={person.leave_type ?? "Away today"}
                  trailing={person.until ? <span className="shrink-0 text-xs text-muted-foreground">Until {formatDate(person.until)}</span> : null}
                />
              ))
            )}
          </section>
          <section aria-labelledby="dashboard-celebrations">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="dashboard-celebrations" className="m-0 flex items-center gap-2 text-sm font-semibold">
                <PartyPopper className="size-4 text-primary" /> Celebrations
              </h3>
              {celebrations.length > 6 && <Badge variant="secondary">+{celebrations.length - 6} more</Badge>}
            </div>
            {celebrations.length === 0 ? (
              <p className="m-0 border border-dashed border-border p-4 text-sm text-muted-foreground">No celebrations coming up.</p>
            ) : (
              celebrations.slice(0, 6).map((celebration: Celebration) => (
                <PersonRow
                  key={`${celebration.user_id}-${celebration.kind}`}
                  id={celebration.user_id}
                  name={celebration.name}
                  avatarUrl={celebration.avatar_url}
                  detail={<><CelebrationIcon kind={celebration.kind} /> {celebration.detail}</>}
                  trailing={<Badge variant="outline">{celebration.label}</Badge>}
                />
              ))
            )}
          </section>
        </CardContent>
      )}
    </Card>
  );
}

function eventDate(event: CalEvent) {
  const date = parseDate(event.start);
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(event.start);
  return date.toLocaleString(
    undefined,
    allDay
      ? { weekday: "short", month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

export function UpcomingEventsCard({ events }: { events: DashboardResource<CalEvent[]> }) {
  const items = events.data ?? [];
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" /> Coming up
        </CardTitle>
        <CardDescription>Next on your company calendar.</CardDescription>
        <CardAction>
          <Link to="/calendar" className={buttonVariants({ variant: "ghost", size: "sm" })}>View calendar</Link>
        </CardAction>
      </CardHeader>
      {events.loading && !events.data ? (
        <CardLoading />
      ) : events.error ? (
        <CardError message={events.error} onRetry={events.reload} />
      ) : items.length === 0 ? (
        <CardContent className="text-muted-foreground">Nothing scheduled in the next 30 days.</CardContent>
      ) : (
        <CardContent className="flex flex-col">
          {items.slice(0, 5).map((event) => (
            <Link
              key={`${event.kind}-${event.id}`}
              to="/calendar"
              className="flex min-h-14 items-center gap-3 border-b border-border py-2 text-foreground last:border-0 hover:no-underline"
            >
              <span className="grid size-9 shrink-0 place-items-center bg-primary/15 text-foreground">
                <CalendarDays className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{event.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{event.subtitle ?? event.kind.replace(/_/g, " ")}</span>
              </span>
              <span className="max-w-24 shrink-0 text-right text-xs text-muted-foreground">{eventDate(event)}</span>
            </Link>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

export function LeaveBalanceCard({ balance }: { balance: DashboardResource<LeaveBalance> }) {
  const data = balance.data;
  const usedPercent = data?.entitlement_days
    ? Math.min(100, (data.used_days / data.entitlement_days) * 100)
    : 0;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palmtree className="size-4 text-primary" /> Leave balance
        </CardTitle>
        <CardDescription>Your allowance for {data?.year ?? new Date().getFullYear()}.</CardDescription>
      </CardHeader>
      {balance.loading && !data ? (
        <CardLoading />
      ) : balance.error || !data ? (
        <CardError message={balance.error ?? "Leave balance is unavailable."} onRetry={balance.reload} />
      ) : (
        <CardContent className="flex flex-col gap-4">
          <div>
            <div className="text-3xl font-semibold tabular-nums">{data.remaining_days}</div>
            <p className="m-0 mt-1 text-sm text-muted-foreground">days remaining</p>
          </div>
          <div>
            <Progress value={usedPercent} aria-label="Annual leave used" />
            <div className="mt-2 flex items-center text-xs">
              <span>{data.used_days} used of {data.entitlement_days}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">{Math.round(usedPercent)}%</span>
            </div>
          </div>
        </CardContent>
      )}
      <CardFooter>
        <Link to="/leave" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto")}>
          View leave <ArrowRight data-icon="inline-end" />
        </Link>
      </CardFooter>
    </Card>
  );
}

function CompactLinkCard({
  title,
  value,
  description,
  to,
  icon: Icon,
  loading,
  error,
  onRetry,
}: {
  title: string;
  value: ReactNode;
  description: string;
  to: string;
  icon: LucideIcon;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className="size-4 text-primary" /> {title}</CardTitle>
        <CardAction>
          <Link to={to} aria-label={`Open ${title}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
            <ArrowRight />
          </Link>
        </CardAction>
      </CardHeader>
      {loading ? (
        <CardLoading />
      ) : error ? (
        <CardError message={error} onRetry={onRetry ?? (() => undefined)} />
      ) : (
        <CardContent>
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <p className="mb-0 mt-1 line-clamp-2 text-sm text-muted-foreground">{description}</p>
        </CardContent>
      )}
    </Card>
  );
}

function trendPoints(values: number[], max: number) {
  const width = 700;
  const height = 220;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - (value / max) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function EngagementTrendChart({
  data,
}: {
  data: Array<{ date: string; clicks: number; scans: number }>;
}) {
  const max = Math.max(1, ...data.flatMap((point) => [point.clicks, point.scans]));
  const firstDate = formatDate(data[0].date, { month: "short", day: "numeric" });
  const lastDate = formatDate(data[data.length - 1].date, { month: "short", day: "numeric" });

  return (
    <div>
      <svg
        role="img"
        aria-labelledby="engagement-chart-title engagement-chart-description"
        viewBox="-42 -16 760 260"
        className="h-64 w-full overflow-visible"
      >
        <title id="engagement-chart-title">Engagement trend</title>
        <desc id="engagement-chart-description">
          Link clicks and digital card scans from {firstDate} to {lastDate}. Peak daily activity was {max}.
        </desc>
        {[0, 0.5, 1].map((ratio) => {
          const y = 220 - ratio * 220;
          return (
            <g key={ratio}>
              <line x1="0" x2="700" y1={y} y2={y} className="stroke-border" strokeDasharray="4 4" />
              <text x="-10" y={y + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {Math.round(max * ratio)}
              </text>
            </g>
          );
        })}
        <polyline
          points={trendPoints(data.map((point) => point.clicks), max)}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={trendPoints(data.map((point) => point.scans), max)}
          fill="none"
          stroke="var(--chart-3)"
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
        <text x="0" y="244" className="fill-muted-foreground text-[11px]">{firstDate}</text>
        <text x="700" y="244" textAnchor="end" className="fill-muted-foreground text-[11px]">{lastDate}</text>
      </svg>
      <div className="flex justify-center gap-5 text-xs text-muted-foreground" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 bg-[var(--chart-1)]" /> Link clicks
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 bg-[var(--chart-3)]" /> Card scans
        </span>
      </div>
      <table className="sr-only">
        <caption>Daily engagement values</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Link clicks</th>
            <th scope="col">Card scans</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <th scope="row">{formatDate(point.date, { weekday: "short", month: "short", day: "numeric" })}</th>
              <td>{point.clicks}</td>
              <td>{point.scans}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EngagementChartCard({ overview }: { overview: DashboardResource<AnalyticsOverview> }) {
  const chartData = useMemo(() => {
    const byDate = new Map<string, { date: string; clicks: number; scans: number }>();
    for (const point of overview.data?.series.clicks ?? []) {
      byDate.set(point.date, { date: point.date, clicks: point.count, scans: 0 });
    }
    for (const point of overview.data?.series.scans ?? []) {
      const existing = byDate.get(point.date) ?? { date: point.date, clicks: 0, scans: 0 };
      existing.scans = point.count;
      byDate.set(point.date, existing);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [overview.data]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Engagement trend</CardTitle>
        <CardDescription>Short-link clicks and card scans over the last 14 days.</CardDescription>
        <CardAction><Badge variant="info">14 days</Badge></CardAction>
      </CardHeader>
      {overview.loading && !overview.data ? (
        <CardLoading />
      ) : overview.error ? (
        <CardError message={overview.error} onRetry={overview.reload} />
      ) : chartData.length === 0 ? (
        <CardContent className="text-muted-foreground">No engagement data in this period.</CardContent>
      ) : (
        <CardContent>
          <EngagementTrendChart data={chartData} />
        </CardContent>
      )}
    </Card>
  );
}

export function OperationsOverviewCard({
  overview,
  can,
}: {
  overview: DashboardResource<AnalyticsOverview>;
  can: (module: string) => boolean;
}) {
  const data = overview.data;
  const metrics: Array<{ label: string; value: number; to: string; module: string; icon: LucideIcon }> = data
    ? [
        { label: "Employees", value: data.counts.employees ?? 0, to: "/directory", module: "directory", icon: Users },
        { label: "Digital cards", value: data.counts.cards ?? 0, to: "/cards", module: "cards", icon: CreditCard },
        { label: "Tracked assets", value: data.counts.assets ?? 0, to: "/asset-tracker", module: "asset_tracker", icon: Boxes },
        { label: "Link clicks", value: data.engagement.total_link_clicks, to: "/shortener", module: "shortener", icon: Link2 },
        { label: "Card scans", value: data.engagement.total_card_scans, to: "/cards", module: "cards", icon: ScanLine },
        { label: "QR codes", value: data.counts.qrcodes ?? 0, to: "/qrcodes", module: "qrcodes", icon: QrCode },
        { label: "Landing pages", value: data.counts.landing_pages ?? 0, to: "/landing-pages", module: "landing_pages", icon: LayoutTemplate },
      ].filter((metric) => can(metric.module)).slice(0, 6)
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company overview</CardTitle>
        <CardDescription>Operational totals for the areas you can access.</CardDescription>
      </CardHeader>
      {overview.loading && !data ? (
        <CardLoading />
      ) : overview.error || !data ? (
        <CardError message={overview.error ?? "Company overview is unavailable."} onRetry={overview.reload} />
      ) : metrics.length === 0 ? (
        <CardContent className="text-muted-foreground">No operational metrics are available for your permissions.</CardContent>
      ) : (
        <CardContent className="grid gap-px bg-border p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <Link key={metric.label} to={metric.to} className="flex min-w-0 items-center gap-3 bg-card px-4 py-4 text-foreground hover:bg-muted hover:no-underline">
                <span className="grid size-9 shrink-0 place-items-center bg-primary/15"><Icon className="size-4" /></span>
                <span className="min-w-0">
                  <span className="block text-xl font-semibold tabular-nums">{metric.value.toLocaleString()}</span>
                  <span className="block truncate text-xs text-muted-foreground">{metric.label}</span>
                </span>
              </Link>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const seconds = Math.max(0, (Date.now() - parseDate(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function RecentActivityCard({ overview }: { overview: DashboardResource<AnalyticsOverview> }) {
  const items = overview.data?.recent_activity ?? [];
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><History className="size-4 text-primary" /> Recent activity</CardTitle>
        <CardDescription>Latest operational changes.</CardDescription>
      </CardHeader>
      {overview.loading && !overview.data ? (
        <CardLoading />
      ) : overview.error ? (
        <CardError message={overview.error} onRetry={overview.reload} />
      ) : items.length === 0 ? (
        <CardContent className="text-muted-foreground">No recent activity.</CardContent>
      ) : (
        <CardContent className="flex flex-col">
          {items.slice(0, 6).map((item) => (
            <div key={item.id} className="flex min-h-12 items-center gap-3 border-b border-border py-2 last:border-0">
              <span className="grid size-8 shrink-0 place-items-center bg-muted"><Activity className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.summary}</span>
                <span className="block text-xs text-muted-foreground">{item.actor ?? "Someone"} · {timeAgo(item.created_at)}</span>
              </span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

export function WarrantyAlertsCard({
  overview,
  canOpenAssets,
}: {
  overview: DashboardResource<AnalyticsOverview>;
  canOpenAssets: boolean;
}) {
  const alerts = overview.data?.assets.warranty_alerts ?? [];
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Warranty alerts</CardTitle>
        <CardDescription>Assets expiring within 30 days.</CardDescription>
        {alerts.length > 0 && <CardAction><Badge variant="warning">{alerts.length}</Badge></CardAction>}
      </CardHeader>
      {overview.loading && !overview.data ? (
        <CardLoading />
      ) : overview.error ? (
        <CardError message={overview.error} onRetry={overview.reload} />
      ) : alerts.length === 0 ? (
        <CardContent>
          <div className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="size-4" /> Nothing expiring soon.</div>
        </CardContent>
      ) : (
        <CardContent className="flex flex-col">
          {alerts.slice(0, 4).map((item) => (
            <div key={item.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-2 last:border-0">
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="block text-xs text-muted-foreground">{item.asset_tag} · expires {formatDate(item.warranty_expiry)}</span>
              </span>
              <Badge variant={item.days_left <= 7 ? "destructive" : "warning"}>{item.days_left}d</Badge>
            </div>
          ))}
          {alerts.length > 4 && <p className="mb-0 mt-3 text-xs text-muted-foreground">+{alerts.length - 4} more alerts</p>}
        </CardContent>
      )}
      {canOpenAssets && (
        <CardFooter>
          <Link to="/asset-tracker" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto")}>
            Open assets <ArrowRight data-icon="inline-end" />
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}

export function CafeCard() {
  const orders = useFetch<Array<{ id: string; item_name: string; status: string }>>("/api/cafe/orders");
  const active = (orders.data ?? []).filter((order) => !["collected", "cancelled"].includes(order.status));
  return (
    <CompactLinkCard
      title="Café orders"
      value={`${active.length} active`}
      description={active[0] ? `${active[0].item_name} · ${active[0].status}` : "Browse the menu"}
      to="/cafe"
      icon={FileText}
      loading={orders.loading && !orders.data}
      error={orders.error}
      onRetry={orders.reload}
    />
  );
}

export function BackupStatusCard() {
  const status = useFetch<{ latest?: { status: string; created_at: string } | null }>("/api/backups/status");
  return (
    <CompactLinkCard
      title="Backup status"
      value={status.data?.latest?.status ?? "No backup"}
      description={status.data?.latest ? `Last run ${timeAgo(status.data.latest.created_at)}` : "Create the first backup"}
      to="/settings"
      icon={History}
      loading={status.loading && !status.data}
      error={status.error}
      onRetry={status.reload}
    />
  );
}

export function LostFoundCard() {
  const reports = useFetch<Array<{ status: string; description: string }>>("/api/lost-found");
  const open = (reports.data ?? []).filter((item) => item.status === "open");
  return (
    <CompactLinkCard
      title="Lost & found"
      value={`${open.length} open`}
      description={open[0]?.description ?? "Browse or report an item"}
      to="/lost-found"
      icon={AlertTriangle}
      loading={reports.loading && !reports.data}
      error={reports.error}
      onRetry={reports.reload}
    />
  );
}
