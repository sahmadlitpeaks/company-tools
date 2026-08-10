import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Eye, EyeOff, GripVertical, Settings2 } from "lucide-react";
import { api } from "../api/client";
import type {
  AnalyticsOverview,
  Announcement,
  DashboardPreferences,
  HomeFeed,
  LeaveBalance,
  TimeSummary,
  WorkSummary,
} from "../api/types";
import { useAuth } from "../auth/AuthContext";
import DemoDataCard from "../components/DemoDataCard";
import {
  AnnouncementsCard,
  BackupStatusCard,
  CafeCard,
  EngagementChartCard,
  LeaveBalanceCard,
  LostFoundCard,
  MyWorkCard,
  OperationsOverviewCard,
  PeopleTodayCard,
  QuickActionsCard,
  RecentActivityCard,
  TimeStatusCard,
  UpcomingEventsCard,
  WarrantyAlertsCard,
  WelcomeCard,
} from "../components/dashboard/DashboardCards";
import { ErrorState, Loading, useToast } from "../components/ui";
import { useFetch } from "../hooks/useApi";
import type { CalEvent } from "./CalendarPage";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const WIDGET_LABELS: Record<string, string> = {
  clock: "Time clock",
  my_work: "My work",
  home_feed: "People today",
  announcements: "Announcements",
  leave: "Leave balance",
  analytics: "Company overview",
  trends: "Engagement trend",
  activity: "Recent activity",
  warranties: "Warranty alerts",
  calendar: "Upcoming events",
  backup_status: "Backup status",
  cafe: "Café orders",
  lost_found: "Lost & found",
};

const EMPLOYEE_WIDGETS = new Set([
  "clock",
  "my_work",
  "home_feed",
  "announcements",
  "leave",
  "calendar",
  "cafe",
  "lost_found",
]);

const OPERATIONS_WIDGETS = new Set([
  "analytics",
  "trends",
  "activity",
  "warranties",
  "backup_status",
]);

const EMPLOYEE_SPANS: Record<string, string> = {
  clock: "lg:col-span-7",
  my_work: "lg:col-span-5",
  announcements: "lg:col-span-5",
  home_feed: "lg:col-span-7",
  calendar: "md:col-span-2 lg:col-span-6",
  leave: "lg:col-span-3",
  cafe: "lg:col-span-3",
  lost_found: "lg:col-span-3",
};

const OPERATIONS_SPANS: Record<string, string> = {
  analytics: "lg:col-span-12",
  trends: "lg:col-span-7",
  activity: "lg:col-span-5",
  warranties: "lg:col-span-7",
  backup_status: "lg:col-span-5",
};

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function WidgetSection({
  id,
  className,
  customizing,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onHide,
  children,
}: {
  id: string;
  className?: string;
  customizing: boolean;
  dragging: string | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onHide: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={WIDGET_LABELS[id] ?? id}
      className={cn("min-w-0", className, dragging === id && "opacity-50")}
      draggable={customizing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => customizing && event.preventDefault()}
      onDrop={onDrop}
    >
      {customizing && (
        <div className="mb-2 flex items-center justify-between border border-dashed border-border bg-muted px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <GripVertical className="size-4 text-muted-foreground" />
            {WIDGET_LABELS[id] ?? id}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onHide}>
            <EyeOff data-icon="inline-start" /> Hide
          </Button>
        </div>
      )}
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const { notify } = useToast();
  const analytics = useFetch<AnalyticsOverview>("/api/analytics/overview");
  const work = useFetch<WorkSummary>("/api/me/work");
  const home = useFetch<HomeFeed>("/api/me/home");
  const time = useFetch<TimeSummary>(can("attendance") ? "/api/time/summary" : null);
  const announcements = useFetch<Announcement[]>(
    can("announcements") ? "/api/announcements" : null,
  );
  const leave = useFetch<LeaveBalance>(can("approvals") ? "/api/leave/balance" : null);
  const calendarEnd = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date;
  }, []);
  const events = useFetch<CalEvent[]>(
    can("calendar") ? `/api/calendar?start=${iso(new Date())}&end=${iso(calendarEnd)}` : null,
  );
  const preferences = useFetch<DashboardPreferences>("/api/me/dashboard-preferences");
  const [widgetOrder, setWidgetOrder] = useState<string[]>([]);
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>([]);
  const [customizing, setCustomizing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    void api("/api/notifications/check-warranties", { method: "POST" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!preferences.data) return;
    setWidgetOrder(preferences.data.widget_order);
    setHiddenWidgets(preferences.data.hidden_widgets);
  }, [preferences.data]);

  async function savePreferences(order: string[], hidden: string[]) {
    setWidgetOrder(order);
    setHiddenWidgets(hidden);
    try {
      const saved = await api<DashboardPreferences>("/api/me/dashboard-preferences", {
        method: "PUT",
        body: { widget_order: order, hidden_widgets: hidden },
      });
      setWidgetOrder(saved.widget_order);
      setHiddenWidgets(saved.hidden_widgets);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dashboard changes could not be saved.", "error");
      await preferences.reload();
    }
  }

  function dropBefore(target: string) {
    if (!dragging || dragging === target) return;
    const next = widgetOrder.filter((id) => id !== dragging);
    const targetIndex = next.indexOf(target);
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, dragging);
    setDragging(null);
    void savePreferences(next, hiddenWidgets);
  }

  async function resetPreferences() {
    try {
      const defaults = await api<DashboardPreferences>("/api/me/dashboard-preferences", {
        method: "DELETE",
      });
      setWidgetOrder(defaults.widget_order);
      setHiddenWidgets(defaults.hidden_widgets);
      notify("Dashboard reset to your role defaults.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dashboard could not be reset.", "error");
    }
  }

  const visibleWidgets = widgetOrder.filter((id) => !hiddenWidgets.includes(id));
  const employeeWidgets = visibleWidgets.filter((id) => EMPLOYEE_WIDGETS.has(id));
  const operationsWidgets = visibleWidgets.filter((id) => OPERATIONS_WIDGETS.has(id));
  const isManager = !!user && (user.is_admin || user.role === "manager");
  const showOperations = isManager && operationsWidgets.length > 0;

  function renderWidget(id: string): ReactNode {
    if (id === "clock" && can("attendance")) return <TimeStatusCard summary={time} />;
    if (id === "my_work") {
      return (
        <MyWorkCard
          work={work}
          canTasks={can("tasks")}
          canApprovals={can("approvals")}
          canServiceDesk={can("service_desk")}
        />
      );
    }
    if (id === "home_feed") return <PeopleTodayCard home={home} />;
    if (id === "announcements" && can("announcements")) {
      return <AnnouncementsCard announcements={announcements} />;
    }
    if (id === "leave" && can("approvals")) return <LeaveBalanceCard balance={leave} />;
    if (id === "calendar" && can("calendar")) return <UpcomingEventsCard events={events} />;
    if (id === "cafe" && can("cafe")) return <CafeCard />;
    if (id === "lost_found" && can("lost_found")) return <LostFoundCard />;
    if (id === "analytics") return <OperationsOverviewCard overview={analytics} can={can} />;
    if (id === "trends") return <EngagementChartCard overview={analytics} />;
    if (id === "activity") return <RecentActivityCard overview={analytics} />;
    if (id === "warranties") {
      return <WarrantyAlertsCard overview={analytics} canOpenAssets={can("asset_tracker")} />;
    }
    if (id === "backup_status" && user?.is_admin) return <BackupStatusCard />;
    return null;
  }

  function renderZone(ids: string[], spans: Record<string, string>) {
    return ids.map((id) => {
      const content = renderWidget(id);
      if (!content) return null;
      return (
        <WidgetSection
          key={id}
          id={id}
          className={spans[id]}
          customizing={customizing}
          dragging={dragging}
          onDragStart={() => setDragging(id)}
          onDragEnd={() => setDragging(null)}
          onDrop={() => dropBefore(id)}
          onHide={() => void savePreferences(widgetOrder, [...new Set([...hiddenWidgets, id])])}
        >
          {content}
        </WidgetSection>
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Your dashboard</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <WelcomeCard
          name={user?.given_name ?? user?.display_name ?? "there"}
          work={work}
          canTasks={can("tasks")}
          canApprovals={can("approvals")}
          canAnnouncements={can("announcements")}
        />
        <QuickActionsCard can={can} />
      </div>

      <DemoDataCard />

      <div className="flex flex-col items-start justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-tight">Your dashboard</h2>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            Daily work first, followed by the updates and operations relevant to you.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {customizing && (
            <Button type="button" variant="ghost" onClick={() => void resetPreferences()}>
              Reset to default
            </Button>
          )}
          <Button
            aria-pressed={customizing}
            type="button"
            variant={customizing ? "default" : "secondary"}
            onClick={() => setCustomizing((value) => !value)}
          >
            <Settings2 data-icon="inline-start" />
            {customizing ? "Done" : "Customize"}
          </Button>
        </div>
      </div>

      {customizing && hiddenWidgets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Hidden widgets</CardTitle>
            <CardDescription>Restore a widget to its curated dashboard zone.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {hiddenWidgets.map((id) => (
              <Button
                key={id}
                type="button"
                variant="secondary"
                onClick={() => void savePreferences(widgetOrder, hiddenWidgets.filter((item) => item !== id))}
              >
                <Eye data-icon="inline-start" /> Restore {WIDGET_LABELS[id] ?? id}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {preferences.loading && widgetOrder.length === 0 ? (
        <Loading />
      ) : preferences.error ? (
        <ErrorState message={preferences.error} onRetry={preferences.reload} />
      ) : (
        <>
          {employeeWidgets.length > 0 && (
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 lg:grid-cols-12">
              {renderZone(employeeWidgets, EMPLOYEE_SPANS)}
            </div>
          )}

          {showOperations && (
            <section className="flex flex-col gap-4" aria-labelledby="dashboard-operations">
              <div className="border-b border-border pb-3">
                <h2 id="dashboard-operations" className="m-0 text-lg font-semibold tracking-tight">Operations</h2>
                <p className="m-0 mt-1 text-sm text-muted-foreground">Manager and administrator signals, kept below your daily work.</p>
              </div>
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
                {renderZone(operationsWidgets, OPERATIONS_SPANS)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
