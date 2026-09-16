import { useEffect, useState } from "react";
import {
  BellOff,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  Filter,
  ListTodo,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  X,
} from "lucide-react";
import { api } from "@/api/client";
import {
  type SharePointReminder,
  readableStatus,
} from "@/api/sharepoint";
import { useFetch } from "@/hooks/useApi";
import { Empty, Loading, useToast } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type CategoryFilter = "all" | "expiry" | "task" | "deadline";
type StatusFilter = "all" | "pending" | "completed" | "dismissed" | "sent";

export function TasksAndRemindersTab({ isAdmin }: { isAdmin: boolean }) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { notify } = useToast();

  const remindersApi = useFetch<SharePointReminder[]>("/api/sharepoint/reminders");
  const [localReminders, setLocalReminders] = useState<SharePointReminder[] | null>(null);

  useEffect(() => {
    if (remindersApi.data) {
      setLocalReminders(remindersApi.data);
    }
  }, [remindersApi.data]);

  const allReminders = localReminders ?? remindersApi.data ?? [];

  // Filtering
  const filtered = allReminders.filter((r) => {
    // Category match
    if (categoryFilter === "expiry" && !(r.category === "expiry" || r.category === "renewal")) {
      return false;
    }
    if (categoryFilter === "task" && r.category !== "task") {
      return false;
    }
    if (categoryFilter === "deadline" && !(r.category === "deadline" || r.category === "milestone")) {
      return false;
    }

    // Status match
    if (statusFilter !== "all" && r.status !== statusFilter) {
      return false;
    }

    // Search query match
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = r.title.toLowerCase().includes(q);
      const matchDoc = (r.document_name || "").toLowerCase().includes(q);
      const matchPath = (r.document_path || "").toLowerCase().includes(q);
      const matchOwner = (r.responsible_name || "").toLowerCase().includes(q);
      const matchEmail = (r.recipient_email || "").toLowerCase().includes(q);
      if (!matchTitle && !matchDoc && !matchPath && !matchOwner && !matchEmail) {
        return false;
      }
    }

    return true;
  });

  // Metric computations
  const totalCount = allReminders.length;
  const upcoming30Days = allReminders.filter((r) => {
    try {
      const days = Math.ceil((new Date(r.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return days >= 0 && days <= 30 && r.status === "pending";
    } catch {
      return false;
    }
  }).length;

  const pendingTasksCount = allReminders.filter((r) => r.status === "pending").length;
  const completedCount = allReminders.filter((r) => r.status === "completed").length;
  const totalValue = allReminders.reduce((acc, r) => acc + (r.amount || 0), 0);

  // Actions
  async function testSend(reminderId: string) {
    setBusyId(reminderId);
    try {
      const res = await api<{ success: boolean; last_error?: string }>(
        `/api/sharepoint/reminders/${reminderId}/test-send`,
        { method: "POST" }
      );
      if (res.success) {
        notify("Test reminder email & Teams card dispatched successfully!");
      } else {
        notify(readableStatus(res.last_error || "Dispatch failed"), "error");
      }
      void remindersApi.reload();
    } catch (err) {
      notify(readableStatus(err instanceof Error ? err.message : "Dispatch failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function completeTask(reminderId: string) {
    setBusyId(reminderId);
    setLocalReminders((curr) =>
      curr ? curr.map((r) => (r.id === reminderId ? { ...r, status: "completed" as const } : r)) : null
    );
    try {
      await api(`/api/sharepoint/reminders/${reminderId}/complete`, { method: "POST" });
      notify("Task marked as completed!");
      void remindersApi.reload();
    } catch (err) {
      void remindersApi.reload();
      notify(readableStatus(err instanceof Error ? err.message : "Action failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function reopenTask(reminderId: string) {
    setBusyId(reminderId);
    setLocalReminders((curr) =>
      curr ? curr.map((r) => (r.id === reminderId ? { ...r, status: "pending" as const } : r)) : null
    );
    try {
      await api(`/api/sharepoint/reminders/${reminderId}/reopen`, { method: "POST" });
      notify("Item restored to pending status.");
      void remindersApi.reload();
    } catch (err) {
      void remindersApi.reload();
      notify(readableStatus(err instanceof Error ? err.message : "Action failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function dismissReminder(reminderId: string) {
    setBusyId(reminderId);
    setLocalReminders((curr) =>
      curr ? curr.map((r) => (r.id === reminderId ? { ...r, status: "dismissed" as const } : r)) : null
    );
    try {
      await api(`/api/sharepoint/reminders/${reminderId}/dismiss`, { method: "POST" });
      notify("Item dismissed.");
      void remindersApi.reload();
    } catch (err) {
      void remindersApi.reload();
      notify(readableStatus(err instanceof Error ? err.message : "Dismiss failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  const [runningReminders, setRunningReminders] = useState(false);

  async function handleRunReminders() {
    setRunningReminders(true);
    try {
      const res = await api<{ checked: number; created: number }>("/api/sharepoint/reminders/run", {
        method: "POST",
      });
      notify(`Notification cycle complete: checked ${res.checked} reminders, dispatched ${res.created}.`);
      void remindersApi.reload();
    } catch (err) {
      notify(readableStatus(err instanceof Error ? err.message : "Dispatch failed"), "error");
    } finally {
      setRunningReminders(false);
    }
  }

  return (
    <Card className="rounded-none border-border">
      <CardHeader className="p-3.5 pb-2 border-b border-border/70 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Calendar className="size-4 text-sky-500" />
              Tasks & Reminders
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Extracted deadlines, milestones, contract renewals, and actionable deliverable tasks
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRunReminders()}
                disabled={runningReminders}
                className="rounded-none h-8 text-xs gap-1.5"
                title="Trigger automated escalating notification cycle (Teams & Email)"
              >
                <Send data-icon="inline-start" className={runningReminders ? "animate-spin size-3" : "size-3"} />
                {runningReminders ? "Dispatching…" : "Run Reminders"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void remindersApi.reload()}
              disabled={remindersApi.loading}
              className="rounded-none h-8 text-xs gap-1"
            >
              <RefreshCw
                data-icon="inline-start"
                className={remindersApi.loading ? "animate-spin size-3" : "size-3"}
              />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-3.5">
        {/* Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <div className="p-3 border border-border bg-card space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <Calendar className="size-3 text-primary" /> Total Tracked
            </span>
            <span className="text-lg font-bold font-mono">{totalCount}</span>
          </div>
          <div className="p-3 border border-border bg-card space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <Clock className="size-3 text-amber-600" /> Due &le; 30 Days
            </span>
            <span className="text-lg font-bold font-mono text-amber-700 dark:text-amber-400">
              {upcoming30Days}
            </span>
          </div>
          <div className="p-3 border border-border bg-card space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <ListTodo className="size-3 text-sky-600" /> Pending Action
            </span>
            <span className="text-lg font-bold font-mono text-sky-700 dark:text-sky-400">
              {pendingTasksCount}
            </span>
          </div>
          <div className="p-3 border border-border bg-card space-y-1">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <CheckCircle2 className="size-3 text-emerald-600" /> Completed
            </span>
            <span className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400">
              {completedCount}
            </span>
          </div>
          <div className="p-3 border border-border bg-card space-y-1 col-span-2 sm:col-span-1">
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <DollarSign className="size-3 text-emerald-600" /> Tracked Value
            </span>
            <span className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400 truncate block">
              ${totalValue.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
          {/* Category Filter Buttons */}
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[
              { id: "all" as CategoryFilter, label: "All Items" },
              { id: "expiry" as CategoryFilter, label: "Expiries & Renewals" },
              { id: "task" as CategoryFilter, label: "Actionable Tasks" },
              { id: "deadline" as CategoryFilter, label: "Milestones & Deadlines" },
            ].map((tab) => (
              <Button
                key={tab.id}
                variant={categoryFilter === tab.id ? "default" : "outline"}
                size="xs"
                onClick={() => setCategoryFilter(tab.id)}
                className="h-7 text-xs rounded-none"
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* Status Select Filter */}
            <div className="flex items-center gap-1">
              <Filter className="size-3 text-muted-foreground hidden sm:inline" />
              <Select
                value={statusFilter}
                onValueChange={(val) => {
                  if (val) setStatusFilter(val as StatusFilter);
                }}
              >
                <SelectTrigger className="h-7 text-xs rounded-none min-w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-none">
                  <SelectGroup>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending Only</SelectItem>
                    <SelectItem value="completed">Completed Only</SelectItem>
                    <SelectItem value="dismissed">Dismissed Only</SelectItem>
                    <SelectItem value="sent">Sent / Delivered</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* Keyword Search Input */}
            <div className="w-full sm:w-56">
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <Search className="size-3 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter tasks…"
                  className="text-xs h-7"
                />
                {search && (
                  <InputGroupButton onClick={() => setSearch("")} title="Clear search">
                    <X className="size-3" />
                  </InputGroupButton>
                )}
              </InputGroup>
            </div>
          </div>
        </div>

        {/* Loading State - initial load only */}
        {remindersApi.loading && allReminders.length === 0 && <Loading />}

        {/* Empty State */}
        {(!remindersApi.loading || allReminders.length > 0) && filtered.length === 0 && (
          <Empty
            icon={<Calendar />}
            message="No tasks or reminders matching this filter"
            hint="Tasks and reminders are generated automatically when Luna analyzes documents containing deadlines, renewals, action items, or commercial milestones."
          />
        )}

        {/* Results Stream */}
        {filtered.length > 0 && (
          <>
            {/* Mobile View (Cards) */}
            <div className="space-y-3 md:hidden">
              {filtered.map((r) => {
                const daysLeft = Math.ceil(
                  (new Date(r.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                );
                const isOverdue = daysLeft < 0 && r.status === "pending";
                const isUrgent = daysLeft <= 30 && daysLeft >= 0 && r.status === "pending";

                return (
                  <Card key={r.id} className="rounded-none border-border">
                    <CardContent className="p-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <h4 className="font-semibold text-xs leading-snug break-words">
                            {r.title}
                          </h4>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="font-mono truncate">{r.document_name}</span>
                            {r.document_url && (
                              <a
                                href={r.document_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80 shrink-0"
                                title="Open document in SharePoint"
                              >
                                <ExternalLink className="size-2.5" />
                              </a>
                            )}
                          </div>
                        </div>
                        <Badge
                          variant={
                            r.status === "completed"
                              ? "outline"
                              : isOverdue
                              ? "destructive"
                              : isUrgent
                              ? "outline"
                              : "secondary"
                          }
                          className={cn(
                            "text-[10px] font-mono shrink-0 rounded-none",
                            r.status === "completed" &&
                              "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
                            isUrgent &&
                              "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30"
                          )}
                        >
                          {r.status === "completed"
                            ? "Done"
                            : isOverdue
                            ? `${Math.abs(daysLeft)}d overdue`
                            : `${daysLeft}d left`}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                        <div>
                          <span className="block text-[10px] uppercase font-semibold">Due Date</span>
                          <span className="font-mono text-foreground">{r.target_date}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase font-semibold">Category</span>
                          <span className="capitalize">{r.category}</span>
                        </div>
                        {r.amount !== null && (
                          <div>
                            <span className="block text-[10px] uppercase font-semibold">Value</span>
                            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {r.amount.toLocaleString()} {r.currency || "USD"}
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="block text-[10px] uppercase font-semibold">Responsible</span>
                          <span className="truncate block" title={r.responsible_name || "Unassigned"}>
                            {r.responsible_name || "Unassigned"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-border/50">
                        <Badge
                          variant={
                            r.status === "completed"
                              ? "outline"
                              : r.status === "sent"
                              ? "default"
                              : r.status === "dismissed"
                              ? "outline"
                              : "secondary"
                          }
                          className={cn(
                            "text-[10px] font-mono capitalize rounded-none",
                            r.status === "completed" &&
                              "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                          )}
                        >
                          {r.status}
                        </Badge>

                        <div className="flex items-center gap-1.5">
                          {r.status === "pending" && (
                            <>
                              <Button
                                variant="outline"
                                size="xs"
                                disabled={busyId === r.id}
                                onClick={() => void completeTask(r.id)}
                                title="Mark completed"
                                className="rounded-none h-6 px-2 text-[11px] gap-1 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                              >
                                <Check data-icon="inline-start" className="size-2.5" />
                                Complete
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                disabled={busyId === r.id}
                                onClick={() => void dismissReminder(r.id)}
                                title="Dismiss notification"
                                className="rounded-none text-destructive/70 hover:text-destructive hover:bg-destructive/15"
                              >
                                <BellOff className="size-3.5" />
                              </Button>
                            </>
                          )}

                          {(r.status === "completed" || r.status === "dismissed") && (
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={busyId === r.id}
                              onClick={() => void reopenTask(r.id)}
                              title="Re-open item"
                              className="rounded-none h-6 px-1.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                            >
                              <RotateCcw data-icon="inline-start" className="size-2.5" />
                              Re-open
                            </Button>
                          )}

                          {isAdmin && (
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={busyId === r.id}
                              onClick={() => void testSend(r.id)}
                              className="rounded-none h-6 px-2 text-xs"
                              title="Send test email & Teams notification"
                            >
                              <Send data-icon="inline-start" className="size-2.5" />
                              Test
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto border border-border">
              <Table className="table-fixed w-full min-w-[1050px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[28%] min-w-[200px]">Item & Category</TableHead>
                    <TableHead className="w-[20%] min-w-[150px]">Document & Path</TableHead>
                    <TableHead className="w-[14%] min-w-[105px]">Target Date</TableHead>
                    <TableHead className="w-[10%] min-w-[85px]">Value</TableHead>
                    <TableHead className="w-[12%] min-w-[100px]">Responsible</TableHead>
                    <TableHead className="w-[105px] min-w-[105px] text-center">Status</TableHead>
                    <TableHead className="w-[170px] min-w-[170px] text-end">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const daysLeft = Math.ceil(
                      (new Date(r.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                    );
                    const isOverdue = daysLeft < 0 && r.status === "pending";
                    const isUrgent = daysLeft <= 30 && daysLeft >= 0 && r.status === "pending";

                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-normal align-middle py-2.5">
                          <p
                            className={cn(
                              "text-xs font-medium leading-snug break-words line-clamp-2",
                              r.status === "completed" && "line-through text-muted-foreground"
                            )}
                            title={r.title}
                          >
                            {r.title}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                            <span
                              className={cn(
                                "size-1.5 rounded-full shrink-0",
                                r.category === "expiry"
                                  ? "bg-rose-500"
                                  : r.category === "renewal"
                                  ? "bg-blue-500"
                                  : r.category === "task"
                                  ? "bg-emerald-500"
                                  : "bg-amber-500"
                              )}
                            />
                            <span className="capitalize">{r.category.replace(/_/g, " ")}</span>
                            {r.notes && (
                              <span
                                className="text-muted-foreground/70 truncate max-w-[140px]"
                                title={r.notes}
                              >
                                · {r.notes}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="whitespace-normal align-middle py-2.5">
                          <div className="flex items-center gap-1">
                            <p
                              className="font-medium text-xs line-clamp-2 leading-snug break-words"
                              title={r.document_name ?? undefined}
                            >
                              {r.document_name}
                            </p>
                            {r.document_url && (
                              <a
                                href={r.document_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80 shrink-0"
                                title="Open in SharePoint"
                              >
                                <ExternalLink className="size-2.5" />
                              </a>
                            )}
                          </div>
                          <div
                            className="text-[10px] text-muted-foreground font-mono truncate mt-0.5"
                            title={r.document_path || "SharePoint"}
                          >
                            {r.document_path || "SharePoint"}
                          </div>
                        </TableCell>

                        <TableCell className="text-xs font-mono align-middle py-2.5">
                          <div>{r.target_date}</div>
                          <span
                            className={cn(
                              "text-[10px] font-medium block",
                              r.status === "completed"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : isOverdue
                                ? "text-destructive font-bold"
                                : isUrgent
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                            )}
                          >
                            {r.status === "completed"
                              ? "Completed"
                              : isOverdue
                              ? `${Math.abs(daysLeft)}d overdue`
                              : `${daysLeft}d left`}
                          </span>
                          <span className="text-[9px] text-muted-foreground/75 block font-sans capitalize">
                            {r.lead_days === 0
                              ? "Due-day alert"
                              : [1, 3, 5].includes(r.lead_days)
                              ? `3x final week (${r.lead_days}d)`
                              : [7, 14, 21].includes(r.lead_days)
                              ? `Weekly (${r.lead_days}d)`
                              : `Monthly (${r.lead_days}d)`}
                          </span>
                        </TableCell>

                        <TableCell className="text-xs font-mono truncate align-middle py-2.5">
                          {r.amount !== null ? (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              {r.amount.toLocaleString()} {r.currency || "USD"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </TableCell>

                        <TableCell
                          className="text-xs text-muted-foreground align-middle py-2.5"
                          title={r.recipient_email || r.responsible_name || "Unassigned"}
                        >
                          <span className="line-clamp-2 leading-snug break-all">
                            {r.responsible_name || r.recipient_email || "Unassigned"}
                          </span>
                        </TableCell>

                        <TableCell className="w-[105px] min-w-[105px] text-center whitespace-nowrap align-middle py-2.5 px-2">
                          <Badge
                            variant={
                              r.status === "completed"
                                ? "outline"
                                : r.status === "sent"
                                ? "default"
                                : r.status === "dismissed"
                                ? "outline"
                                : "secondary"
                            }
                            className={cn(
                              "capitalize text-[10px] rounded-none font-mono px-2",
                              r.status === "completed" &&
                                "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                            )}
                          >
                            {r.status}
                          </Badge>
                        </TableCell>

                        <TableCell className="w-[170px] min-w-[170px] text-end whitespace-nowrap align-middle py-2.5 px-3">
                          <div className="flex items-center justify-end gap-1.5 flex-nowrap shrink-0">
                            {r.status === "pending" && (
                              <>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  disabled={busyId === r.id}
                                  onClick={() => void completeTask(r.id)}
                                  title="Mark as completed"
                                  className="rounded-none h-6 px-2 text-[11px] gap-1 shrink-0 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  <Check data-icon="inline-start" className="size-2.5" />
                                  Done
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={busyId === r.id}
                                  onClick={() => void dismissReminder(r.id)}
                                  title="Dismiss item"
                                  className="rounded-none size-6 shrink-0 text-destructive/70 hover:text-destructive hover:bg-destructive/15"
                                >
                                  <BellOff className="size-3.5" />
                                  <span className="sr-only">Dismiss</span>
                                </Button>
                              </>
                            )}

                            {(r.status === "completed" || r.status === "dismissed") && (
                              <Button
                                variant="ghost"
                                size="xs"
                                disabled={busyId === r.id}
                                onClick={() => void reopenTask(r.id)}
                                title="Re-open item"
                                className="rounded-none h-6 px-2 text-[11px] gap-1 shrink-0 text-muted-foreground hover:text-foreground"
                              >
                                <RotateCcw data-icon="inline-start" className="size-2.5" />
                                Re-open
                              </Button>
                            )}

                            {isAdmin && (
                              <Button
                                variant="outline"
                                size="xs"
                                disabled={busyId === r.id}
                                onClick={() => void testSend(r.id)}
                                title="Send test email & Teams notification"
                                className="rounded-none h-6 px-2 text-[11px] gap-1 shrink-0"
                              >
                                <Send data-icon="inline-start" className="size-2.5" />
                                Test
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
