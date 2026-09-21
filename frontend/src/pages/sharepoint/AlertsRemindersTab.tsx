import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  Bell,
  BellOff,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutList,
  RefreshCw,
} from "lucide-react";
import type { SharePointReminder } from "@/api/sharepoint";
import type { User } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { useToast } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export interface AlertsRemindersTabProps {
  reminders: SharePointReminder[];
  isLoading?: boolean;
  isAdmin?: boolean;
  onComplete: (reminderId: string) => Promise<void>;
  onDismiss: (reminderId: string) => Promise<void>;
  onSnooze: (reminderId: string, days: number) => Promise<void>;
  onOpenDoc: (docId: string) => void;
  onRefresh?: () => void;
}

interface ParsedReminderItem {
  reminder: SharePointReminder;
  month: string;
  day: string;
  diffDays: number;
  isOverdue: boolean;
}

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

function parseReminderDate(dateStr: string | null | undefined): {
  month: string;
  day: string;
  diffDays: number;
} {
  if (!dateStr) {
    return { month: "—", day: "—", diffDays: 0 };
  }

  let year: number;
  let monthIndex: number;
  let dayNum: number;

  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    year = parseInt(match[1], 10);
    monthIndex = parseInt(match[2], 10) - 1;
    dayNum = parseInt(match[3], 10);
  } else {
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) {
      return { month: "—", day: "—", diffDays: 0 };
    }
    year = parsed.getFullYear();
    monthIndex = parsed.getMonth();
    dayNum = parsed.getDate();
  }

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const targetStart = new Date(year, monthIndex, dayNum).getTime();
  const diffDays = Math.round((targetStart - todayStart) / (1000 * 60 * 60 * 24));

  const month = MONTH_NAMES[monthIndex] ?? "—";
  const day = String(dayNum);

  return { month, day, diffDays };
}

function isReminderAssignedToUser(
  rem: SharePointReminder,
  user: User | null | undefined
): boolean {
  if (!user) return true;
  const userEmail = user.email?.trim().toLowerCase();
  const userName = user.display_name?.trim().toLowerCase();

  const remEmail = rem.recipient_email?.trim().toLowerCase();
  const remOwner = rem.responsible_name?.trim().toLowerCase();

  if (
    userEmail &&
    remEmail &&
    (remEmail === userEmail || remEmail.includes(userEmail))
  ) {
    return true;
  }
  if (
    userName &&
    remOwner &&
    (remOwner === userName ||
      remOwner.includes(userName) ||
      userName.includes(remOwner))
  ) {
    return true;
  }
  if (!userEmail && !userName) {
    return true;
  }
  return false;
}

export function AlertsRemindersTab({
  reminders,
  isLoading = false,
  onComplete,
  onDismiss,
  onSnooze,
  onOpenDoc,
  onRefresh,
}: AlertsRemindersTabProps) {
  const { user } = useAuth();
  const { notify } = useToast();

  const [scope, setScope] = useState<"mine" | "everyone">("mine");
  const [viewMode, setViewMode] = useState<"timeline" | "calendar">("timeline");
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [openSnoozeId, setOpenSnoozeId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<{
    id: string;
    type: "complete" | "snooze" | "dismiss";
  } | null>(null);

  const toggleSection = (id: string) => {
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [calendarMonth]);

  // Filter out completed and dismissed reminders
  const activeReminders = useMemo(() => {
    return (reminders || []).filter(
      (r) => r.status !== "completed" && r.status !== "dismissed"
    );
  }, [reminders]);

  // Filter by user assignment (Mine vs Everyone)
  const scopedReminders = useMemo(() => {
    if (scope === "everyone") {
      return activeReminders;
    }
    const assigned = activeReminders.filter((r) => isReminderAssignedToUser(r, user));
    if (assigned.length === 0 && (user?.is_admin || !user)) {
      return activeReminders;
    }
    return assigned;
  }, [activeReminders, scope, user]);

  // Categorize reminders into sections
  const {
    overdueItems,
    thisWeekItems,
    laterThisMonthItems,
    upcomingItems,
  } = useMemo(() => {
    const overdue: ParsedReminderItem[] = [];
    const thisWeek: ParsedReminderItem[] = [];
    const laterMonth: ParsedReminderItem[] = [];
    const upcoming: ParsedReminderItem[] = [];

    for (const rem of scopedReminders) {
      const { month, day, diffDays } = parseReminderDate(rem.target_date);
      const isOverdue = rem.status === "overdue" || diffDays < 0;

      const item: ParsedReminderItem = {
        reminder: rem,
        month,
        day,
        diffDays,
        isOverdue,
      };

      if (isOverdue) {
        overdue.push(item);
      } else if (diffDays <= 7) {
        thisWeek.push(item);
      } else if (diffDays <= 31) {
        laterMonth.push(item);
      } else {
        upcoming.push(item);
      }
    }

    overdue.sort((a, b) => a.diffDays - b.diffDays);
    thisWeek.sort((a, b) => a.diffDays - b.diffDays);
    laterMonth.sort((a, b) => a.diffDays - b.diffDays);
    upcoming.sort((a, b) => a.diffDays - b.diffDays);

    return {
      overdueItems: overdue,
      thisWeekItems: thisWeek,
      laterThisMonthItems: laterMonth,
      upcomingItems: upcoming,
    };
  }, [scopedReminders]);

  const countOverdue = overdueItems.length;
  const countThisWeek = thisWeekItems.length;
  const countLater = laterThisMonthItems.length;
  const totalCount =
    countOverdue + countThisWeek + countLater + upcomingItems.length;

  const handleComplete = async (reminderId: string) => {
    setBusyAction({ id: reminderId, type: "complete" });
    try {
      await onComplete(reminderId);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Failed to mark reminder as done",
        "error"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleSnooze = async (reminderId: string, days: number) => {
    setOpenSnoozeId(null);
    setBusyAction({ id: reminderId, type: "snooze" });
    try {
      await onSnooze(reminderId, days);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Failed to snooze reminder",
        "error"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleDismiss = async (reminderId: string) => {
    setOpenSnoozeId(null);
    setBusyAction({ id: reminderId, type: "dismiss" });
    try {
      await onDismiss(reminderId);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : "Failed to dismiss reminder",
        "error"
      );
    } finally {
      setBusyAction(null);
    }
  };

  const renderRow = (
    item: ParsedReminderItem,
    section: "overdue" | "this-week" | "later-month" | "upcoming"
  ) => {
    const { reminder: rem, month, day, diffDays } = item;
    const overdueDays = Math.max(1, Math.abs(diffDays));
    const isBusy = busyAction?.id === rem.id;
    const isCompleting = isBusy && busyAction?.type === "complete";
    const isSnoozing = isBusy && busyAction?.type === "snooze";

    return (
      <div
        key={rem.id}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-4 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          {section === "overdue" ? (
            <div className="w-14 shrink-0 text-center border border-destructive/40 bg-destructive/10 py-1.5 px-1">
              <span className="block text-[10px] font-bold text-destructive uppercase tracking-wide">
                {month}
              </span>
              <span className="block text-lg font-bold text-destructive leading-tight">
                {day}
              </span>
            </div>
          ) : section === "this-week" ? (
            <div className="w-14 shrink-0 text-center border border-amber-500/40 bg-amber-500/10 py-1.5 px-1">
              <span className="block text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                {month}
              </span>
              <span className="block text-lg font-bold text-amber-700 dark:text-amber-400 leading-tight">
                {day}
              </span>
            </div>
          ) : section === "later-month" ? (
            <div className="w-14 shrink-0 text-center border border-border bg-muted/50 text-foreground py-1.5 px-1">
              <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                {month}
              </span>
              <span className="block text-lg font-bold text-foreground leading-tight">
                {day}
              </span>
            </div>
          ) : (
            <div className="w-14 shrink-0 text-center border border-border bg-muted/30 text-foreground py-1.5 px-1">
              <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                {month}
              </span>
              <span className="block text-lg font-bold text-foreground leading-tight">
                {day}
              </span>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-foreground break-words sm:truncate">
              {rem.title}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 break-words">
              {section === "overdue" ? (
                <>
                  {overdueDays} days overdue
                  {rem.amount
                    ? ` · ${(rem.currency || "AED")} ${rem.amount.toLocaleString()}`
                    : ""}
                  {" · from "}
                  <button
                    type="button"
                    onClick={() => onOpenDoc(rem.document_id)}
                    className="text-primary hover:underline font-medium cursor-pointer"
                  >
                    {rem.document_name || "Document"}
                  </button>
                </>
              ) : (
                <>
                  In {diffDays} days
                  {rem.amount
                    ? ` · ${(rem.currency || "AED")} ${rem.amount.toLocaleString()}`
                    : ""}
                  {" · from "}
                  <button
                    type="button"
                    onClick={() => onOpenDoc(rem.document_id)}
                    className="text-primary hover:underline font-medium cursor-pointer"
                  >
                    {rem.document_name || "Document"}
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={isBusy}
            onClick={() => void handleComplete(rem.id)}
            className="rounded-none h-8 px-3 text-xs font-semibold"
          >
            {isCompleting ? (
              <Spinner data-icon="inline-start" aria-hidden="true" />
            ) : (
              <Check data-icon="inline-start" aria-hidden="true" />
            )}
            Mark done
          </Button>

          <Popover
            open={openSnoozeId === rem.id}
            onOpenChange={(open) => setOpenSnoozeId(open ? rem.id : null)}
          >
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  className="rounded-none h-8 px-3 text-xs font-medium"
                >
                  {isSnoozing ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : (
                    <Clock data-icon="inline-start" aria-hidden="true" />
                  )}
                  Snooze
                </Button>
              }
            />
            <PopoverContent align="end" className="w-44 p-1.5 rounded-none">
              <PopoverHeader className="px-2 py-1">
                <PopoverTitle className="text-xs font-semibold">
                  Snooze reminder
                </PopoverTitle>
                <PopoverDescription className="sr-only">
                  Select snooze duration
                </PopoverDescription>
              </PopoverHeader>
              <div className="flex flex-col gap-0.5">
                {[3, 7, 14, 30].map((days) => (
                  <Button
                    key={days}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-start h-7 px-2 text-xs font-normal rounded-none"
                    onClick={() => void handleSnooze(rem.id, days)}
                  >
                    {days} days
                  </Button>
                ))}
              </div>
              <div className="my-1 border-t border-border" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start h-7 px-2 text-xs font-normal text-destructive hover:text-destructive hover:bg-destructive/10 rounded-none w-full"
                onClick={() => void handleDismiss(rem.id)}
              >
                <BellOff data-icon="inline-start" aria-hidden="true" />
                Dismiss
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Bell className="size-5 text-primary" aria-hidden="true" />
            Alerts & reminders
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {countOverdue} overdue, {countThisWeek} due this week, {countLater} later this month.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <ToggleGroup
            value={[viewMode]}
            onValueChange={(val) => {
              const next = val[0];
              if (next === "timeline" || next === "calendar") {
                setViewMode(next);
              }
            }}
            variant="outline"
            spacing={0}
            className="rounded-none border border-border"
            aria-label="View mode"
          >
            <ToggleGroupItem
              value="timeline"
              className="h-8 px-2.5 text-xs rounded-none gap-1"
              aria-label="Timeline view"
            >
              <LayoutList data-icon="inline-start" className="size-3.5" />
              <span className="hidden sm:inline">Timeline</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="calendar"
              className="h-8 px-2.5 text-xs rounded-none gap-1"
              aria-label="Calendar view"
            >
              <CalendarDays data-icon="inline-start" className="size-3.5" />
              <span className="hidden sm:inline">Calendar</span>
            </ToggleGroupItem>
          </ToggleGroup>

          <ToggleGroup
            value={[scope]}
            onValueChange={(val) => {
              const next = val[0];
              if (next === "mine" || next === "everyone") {
                setScope(next);
              }
            }}
            variant="outline"
            spacing={0}
            className="rounded-none border border-border"
          >
            <ToggleGroupItem
              value="mine"
              className="h-8 px-3 text-xs rounded-none"
            >
              Mine
            </ToggleGroupItem>
            <ToggleGroupItem
              value="everyone"
              className="h-8 px-3 text-xs rounded-none"
            >
              Everyone
            </ToggleGroupItem>
          </ToggleGroup>

          {onRefresh && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isLoading}
              className="h-8 px-2.5 text-xs rounded-none"
              title="Refresh reminders"
            >
              <RefreshCw
                data-icon="inline-start"
                className={isLoading ? "animate-spin" : ""}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading && totalCount === 0 ? (
        <div className="flex items-center justify-center p-12">
          <Spinner className="size-6 text-primary" aria-label="Loading reminders" />
        </div>
      ) : totalCount === 0 ? (
        <Empty className="py-12 border border-dashed border-border bg-card/40 rounded-none">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </EmptyMedia>
            <EmptyTitle>No alerts or reminders</EmptyTitle>
            <EmptyDescription>
              {scope === "mine"
                ? "You have no overdue or upcoming reminders assigned to you."
                : "There are no overdue or upcoming reminders right now."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : viewMode === "calendar" ? (
        <div className="space-y-4">
          {/* Month Navigation */}
          <div className="flex items-center justify-between bg-card border border-border p-3 rounded-none shadow-xs">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCalendarMonth((curr) => subMonths(curr, 1))}
                className="rounded-none h-8 w-8 p-0"
                aria-label="Previous month"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-sm font-bold text-foreground min-w-[140px] text-center">
                {format(calendarMonth, "MMMM yyyy")}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCalendarMonth((curr) => addMonths(curr, 1))}
                className="rounded-none h-8 w-8 p-0"
                aria-label="Next month"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCalendarMonth(new Date())}
              className="rounded-none h-8 px-3 text-xs"
            >
              Today
            </Button>
          </div>

          {/* Calendar Grid */}
          <div className="bg-card border border-border rounded-none overflow-x-auto shadow-xs">
            <div className="min-w-[700px]">
              {/* Weekday headers */}
              <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-center text-xs font-bold text-muted-foreground uppercase py-2">
                <div>Sun</div>
                <div>Mon</div>
                <div>Tue</div>
                <div>Wed</div>
                <div>Thu</div>
                <div>Fri</div>
                <div>Sat</div>
              </div>
              {/* Day cells */}
              <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-border/60">
                {calendarDays.map((day) => {
                  const dayIso = format(day, "yyyy-MM-dd");
                  const isCurrentMonth = isSameMonth(day, calendarMonth);
                  const isCurrentDay = isToday(day);
                  const dayReminders = scopedReminders.filter((r) =>
                    r.target_date ? r.target_date.startsWith(dayIso) : false
                  );

                  return (
                    <div
                      key={dayIso}
                      className={cn(
                        "min-h-[100px] p-2 flex flex-col gap-1 transition-colors",
                        !isCurrentMonth ? "bg-muted/15 text-muted-foreground/50" : "bg-card text-foreground",
                        isCurrentDay && "bg-primary/5 ring-1 ring-primary/40 ring-inset"
                      )}
                    >
                      <div className="flex items-center justify-between text-xs pb-1">
                        <span
                          className={cn(
                            "size-5 flex items-center justify-center font-bold text-[11px] rounded-none",
                            isCurrentDay
                              ? "bg-primary text-primary-foreground"
                              : !isCurrentMonth
                                ? "text-muted-foreground/50"
                                : "text-foreground"
                          )}
                        >
                          {format(day, "d")}
                        </span>
                        {dayReminders.length > 0 && (
                          <Badge variant="outline" className="rounded-none text-[10px] h-4 px-1 py-0">
                            {dayReminders.length}
                          </Badge>
                        )}
                      </div>
                      <div className="flex-1 flex flex-col gap-1 overflow-y-auto max-h-[90px]">
                        {dayReminders.map((rem) => {
                          const isOverdue =
                            rem.status === "overdue" ||
                            (new Date(rem.target_date).getTime() < Date.now() && rem.status !== "completed");
                          return (
                            <div
                              key={rem.id}
                              className={cn(
                                "p-1.5 border text-[11px] rounded-none leading-tight space-y-1 shadow-2xs",
                                isOverdue
                                  ? "bg-destructive/10 border-destructive/30 text-destructive"
                                  : "bg-muted/50 border-border text-foreground"
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => onOpenDoc(rem.document_id)}
                                className="font-bold hover:underline text-left block truncate w-full cursor-pointer"
                                title={rem.title}
                              >
                                {rem.title}
                              </button>
                              <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                                <span className="capitalize truncate">{rem.category}</span>
                                <button
                                  type="button"
                                  onClick={() => void handleComplete(rem.id)}
                                  className="text-primary hover:underline font-semibold shrink-0 cursor-pointer"
                                  title="Mark completed"
                                >
                                  Done
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overdue Section */}
          {overdueItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSection("overdue")}
                    className="h-6 w-6 p-0 rounded-none text-destructive hover:bg-destructive/10"
                    aria-expanded={!collapsedSections["overdue"]}
                    aria-label={collapsedSections["overdue"] ? "Expand Overdue section" : "Collapse Overdue section"}
                  >
                    {collapsedSections["overdue"] ? (
                      <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                    )}
                  </Button>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-destructive">
                    Overdue
                  </h2>
                </div>
                <Badge variant="destructive" className="rounded-none text-[11px] px-1.5 py-0">
                  {overdueItems.length}
                </Badge>
              </div>
              {!collapsedSections["overdue"] && (
                <div className="bg-card border border-destructive/30 rounded-none overflow-hidden divide-y divide-border/60 shadow-xs">
                  {overdueItems.map((item) => renderRow(item, "overdue"))}
                </div>
              )}
            </div>
          )}

          {/* This Week Section */}
          {thisWeekItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSection("this-week")}
                    className="h-6 w-6 p-0 rounded-none text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                    aria-expanded={!collapsedSections["this-week"]}
                    aria-label={collapsedSections["this-week"] ? "Expand This week section" : "Collapse This week section"}
                  >
                    {collapsedSections["this-week"] ? (
                      <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                    )}
                  </Button>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    This week
                  </h2>
                </div>
                <Badge variant="secondary" className="rounded-none bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 text-[11px] px-1.5 py-0">
                  {thisWeekItems.length}
                </Badge>
              </div>
              {!collapsedSections["this-week"] && (
                <div className="bg-card border border-border rounded-none overflow-hidden divide-y divide-border/60 shadow-xs">
                  {thisWeekItems.map((item) => renderRow(item, "this-week"))}
                </div>
              )}
            </div>
          )}

          {/* Later This Month Section */}
          {laterThisMonthItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSection("later-month")}
                    className="h-6 w-6 p-0 rounded-none text-muted-foreground hover:bg-muted"
                    aria-expanded={!collapsedSections["later-month"]}
                    aria-label={collapsedSections["later-month"] ? "Expand Later this month section" : "Collapse Later this month section"}
                  >
                    {collapsedSections["later-month"] ? (
                      <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                    )}
                  </Button>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Later this month
                  </h2>
                </div>
                <Badge variant="outline" className="rounded-none text-[11px] px-1.5 py-0">
                  {laterThisMonthItems.length}
                </Badge>
              </div>
              {!collapsedSections["later-month"] && (
                <div className="bg-card border border-border rounded-none overflow-hidden divide-y divide-border/60 shadow-xs">
                  {laterThisMonthItems.map((item) => renderRow(item, "later-month"))}
                </div>
              )}
            </div>
          )}

          {/* Upcoming / Later Section */}
          {upcomingItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSection("upcoming")}
                    className="h-6 w-6 p-0 rounded-none text-muted-foreground hover:bg-muted"
                    aria-expanded={!collapsedSections["upcoming"]}
                    aria-label={collapsedSections["upcoming"] ? "Expand Upcoming section" : "Collapse Upcoming section"}
                  >
                    {collapsedSections["upcoming"] ? (
                      <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                    )}
                  </Button>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Upcoming
                  </h2>
                </div>
                <Badge variant="outline" className="rounded-none text-[11px] px-1.5 py-0">
                  {upcomingItems.length}
                </Badge>
              </div>
              {!collapsedSections["upcoming"] && (
                <div className="bg-card border border-border rounded-none overflow-hidden divide-y divide-border/60 shadow-xs">
                  {upcomingItems.map((item) => renderRow(item, "upcoming"))}
                </div>
              )}
            </div>
          )}

          {/* All Reminders & Tasks Table */}
          {scopedReminders.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-border">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  All Reminders &amp; Tasks
                </h2>
                <span className="font-mono text-xs text-muted-foreground hidden sm:inline">
                  ↔ Scroll horizontally to view all columns
                </span>
              </div>
              <div className="w-full min-w-0 max-w-full [&>div]:border [&>div]:border-border [&>div]:bg-card shadow-xs">
                <Table className="w-full min-w-[1000px]">
                  <TableHeader>
                    <TableRow className="group/row hover:bg-transparent border-b">
                      <TableHead className="sticky left-0 z-20 bg-table-header border-e border-border/70 min-w-[280px] max-w-[360px] py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Title &amp; Category
                      </TableHead>
                      <TableHead className="min-w-[240px] max-w-[320px] py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Document
                      </TableHead>
                      <TableHead className="min-w-[140px] whitespace-nowrap py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Target Date
                      </TableHead>
                      <TableHead className="min-w-[120px] whitespace-nowrap py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Value
                      </TableHead>
                      <TableHead className="min-w-[180px] whitespace-nowrap py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Responsible
                      </TableHead>
                      <TableHead className="min-w-[110px] whitespace-nowrap text-center py-3 px-2 text-xs font-bold uppercase text-foreground/80">
                        Status
                      </TableHead>
                      <TableHead className="min-w-[160px] whitespace-nowrap text-end py-3 px-3.5">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scopedReminders.map((r: SharePointReminder) => (
                      <TableRow key={r.id} className="group/row">
                        <TableCell className="sticky left-0 z-10 bg-card group-hover/row:bg-table-row-hover transition-colors border-e border-border/70 min-w-[280px] max-w-[360px] align-middle py-3 px-3.5">
                          <span className={cn("text-xs sm:text-sm font-semibold text-foreground block truncate", r.status === "completed" && "line-through text-muted-foreground")}>
                            {r.title}
                          </span>
                          <span className="text-[11px] text-muted-foreground capitalize">
                            {r.category.replace(/_/g, " ")}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-[240px] max-w-[320px] py-3 px-3.5 align-middle text-xs truncate">
                          <button
                            type="button"
                            onClick={() => onOpenDoc(r.document_id)}
                            className="text-primary hover:underline font-medium text-left truncate block max-w-full"
                          >
                            {r.document_name || "Document"}
                          </button>
                        </TableCell>
                        <TableCell className="min-w-[140px] whitespace-nowrap py-3 px-3.5 align-middle text-xs font-mono">
                          {r.target_date}
                        </TableCell>
                        <TableCell className="min-w-[120px] whitespace-nowrap py-3 px-3.5 align-middle text-xs font-mono">
                          {r.amount ? `${r.currency || "AED"} ${r.amount.toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell className="min-w-[180px] whitespace-nowrap py-3 px-3.5 align-middle text-xs text-muted-foreground truncate">
                          {r.responsible_name || r.recipient_email || "Not assigned"}
                        </TableCell>
                        <TableCell className="min-w-[110px] whitespace-nowrap text-center py-3 px-2 align-middle">
                          <span className={cn("text-xs font-semibold px-2 py-0.5 border rounded-none uppercase", r.status === "completed" ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" : "bg-muted text-foreground border-border")}>
                            {r.status}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-[160px] whitespace-nowrap text-end py-3 px-3.5 align-middle">
                          <div className="flex items-center justify-end gap-1.5">
                            {r.status === "pending" && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void onComplete(r.id)}
                                className="rounded-none h-7 px-2 text-xs"
                              >
                                <Check data-icon="inline-start" /> Done
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer Note */}
      <div className="pt-2">
        <p className="text-xs text-muted-foreground">
          You are emailed 30 days, 7 days and on the day of expiry.
        </p>
      </div>
    </div>
  );
}

export default AlertsRemindersTab;
