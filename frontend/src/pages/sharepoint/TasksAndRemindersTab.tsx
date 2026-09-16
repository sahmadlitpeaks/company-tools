import { useEffect, useState } from "react";
import {
  BellOff,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  LayoutGrid,
  LayoutList,
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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

type CategoryFilter = "all" | "expiry" | "task" | "deadline";
type StatusFilter = "all" | "pending" | "completed" | "dismissed" | "sent";

type PageItem = {
  type: "page" | "ellipsis";
  value?: number;
  key: string;
};

function getPageItems(current: number, total: number): PageItem[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => ({
      type: "page",
      value: i + 1,
      key: `page-${i + 1}`,
    }));
  }
  if (current <= 4) {
    return [
      { type: "page", value: 1, key: "page-1" },
      { type: "page", value: 2, key: "page-2" },
      { type: "page", value: 3, key: "page-3" },
      { type: "page", value: 4, key: "page-4" },
      { type: "page", value: 5, key: "page-5" },
      { type: "ellipsis", key: "ellipsis-end" },
      { type: "page", value: total, key: `page-${total}` },
    ];
  }
  if (current >= total - 3) {
    return [
      { type: "page", value: 1, key: "page-1" },
      { type: "ellipsis", key: "ellipsis-start" },
      { type: "page", value: total - 4, key: `page-${total - 4}` },
      { type: "page", value: total - 3, key: `page-${total - 3}` },
      { type: "page", value: total - 2, key: `page-${total - 2}` },
      { type: "page", value: total - 1, key: `page-${total - 1}` },
      { type: "page", value: total, key: `page-${total}` },
    ];
  }
  return [
    { type: "page", value: 1, key: "page-1" },
    { type: "ellipsis", key: "ellipsis-start" },
    { type: "page", value: current - 1, key: `page-${current - 1}` },
    { type: "page", value: current, key: `page-${current}` },
    { type: "page", value: current + 1, key: `page-${current + 1}` },
    { type: "ellipsis", key: "ellipsis-end" },
    { type: "page", value: total, key: `page-${total}` },
  ];
}

const PAGE_SIZE = 20;

export function TasksAndRemindersTab({ isAdmin }: { isAdmin: boolean }) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [currentPage, setCurrentPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { notify } = useToast();

  const remindersApi = useFetch<SharePointReminder[]>("/api/sharepoint/reminders");
  const [localReminders, setLocalReminders] = useState<SharePointReminder[] | null>(null);

  useEffect(() => {
    if (remindersApi.data) {
      setLocalReminders(remindersApi.data);
    }
  }, [remindersApi.data]);

  useEffect(() => {
    setCurrentPage(1);
  }, [categoryFilter, statusFilter, search]);

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

  // Pagination computations
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filtered.length);
  const paginatedReminders = filtered.slice(startIndex, startIndex + PAGE_SIZE);

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
    <Card className="rounded-none border-border min-w-0 max-w-full overflow-hidden">
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

      <CardContent className="space-y-4 p-3.5 min-w-0 max-w-full">
        {/* Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs min-w-0">
          <div className="p-3.5 border border-border bg-card space-y-1 min-w-0">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
              <Calendar className="size-3.5 text-primary" /> Total Tracked
            </span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-foreground block">{totalCount}</span>
          </div>
          <div className="p-3.5 border border-border bg-card space-y-1 min-w-0">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
              <Clock className="size-3.5 text-amber-600" /> Due &le; 30 Days
            </span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-amber-700 dark:text-amber-400 block">
              {upcoming30Days}
            </span>
          </div>
          <div className="p-3.5 border border-border bg-card space-y-1 min-w-0">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
              <ListTodo className="size-3.5 text-sky-600" /> Pending Action
            </span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-sky-700 dark:text-sky-400 block">
              {pendingTasksCount}
            </span>
          </div>
          <div className="p-3.5 border border-border bg-card space-y-1 min-w-0">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
              <CheckCircle2 className="size-3.5 text-emerald-600" /> Completed
            </span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 block">
              {completedCount}
            </span>
          </div>
          <div className="p-3.5 border border-border bg-card space-y-1 col-span-2 sm:col-span-1 min-w-0">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
              <DollarSign className="size-3.5 text-emerald-600" /> Tracked Value
            </span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 truncate block">
              ${totalValue.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pt-1 min-w-0">
          {/* Category Filter Buttons */}
          <div className="flex flex-wrap gap-2 text-xs sm:text-sm min-w-0">
            {[
              { id: "all" as CategoryFilter, label: "All Items" },
              { id: "expiry" as CategoryFilter, label: "Expiries & Renewals" },
              { id: "task" as CategoryFilter, label: "Actionable Tasks" },
              { id: "deadline" as CategoryFilter, label: "Milestones & Deadlines" },
            ].map((tab) => (
              <Button
                key={tab.id}
                variant={categoryFilter === tab.id ? "default" : "outline"}
                size="sm"
                onClick={() => setCategoryFilter(tab.id)}
                className="h-9 px-3.5 text-xs sm:text-sm font-medium rounded-none"
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto min-w-0">
            {/* Status Select Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground hidden sm:inline">Status:</span>
              <Select
                value={statusFilter}
                onValueChange={(val) => {
                  if (val) setStatusFilter(val as StatusFilter);
                }}
              >
                <SelectTrigger className="h-9 text-xs sm:text-sm rounded-none min-w-[130px]">
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
            <div className="w-full sm:w-64 min-w-0 flex-1 sm:flex-initial">
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <Search className="size-3.5 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tasks, docs, or people…"
                  className="text-xs sm:text-sm h-9"
                />
                {search && (
                  <InputGroupButton onClick={() => setSearch("")} title="Clear search">
                    <X className="size-3.5" />
                  </InputGroupButton>
                )}
              </InputGroup>
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center border border-border shrink-0">
              <Button
                type="button"
                variant={viewMode === "table" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("table")}
                className="h-9 px-2.5 text-xs font-semibold rounded-none gap-1.5"
                title="Table View (Horizontally Scrollable)"
              >
                <LayoutList className="size-3.5" />
                Table
              </Button>
              <Button
                type="button"
                variant={viewMode === "cards" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("cards")}
                className="h-9 px-2.5 text-xs font-semibold rounded-none gap-1.5"
                title="Card View"
              >
                <LayoutGrid className="size-3.5" />
                Cards
              </Button>
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
            {/* Card View */}
            {viewMode === "cards" && (
              <div className="space-y-3">
              {paginatedReminders.map((r) => {
                const daysLeft = Math.ceil(
                  (new Date(r.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                );
                const isOverdue = daysLeft < 0 && r.status === "pending";
                const isUrgent = daysLeft <= 30 && daysLeft >= 0 && r.status === "pending";

                return (
                  <Card key={r.id} className="rounded-none border-border">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <h4 className="font-bold text-sm sm:text-base leading-snug break-words text-foreground">
                            {r.title}
                          </h4>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono truncate">{r.document_name}</span>
                            {r.document_url && (
                              <a
                                href={r.document_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80 shrink-0 inline-flex items-center gap-1 font-semibold"
                                title="Open document in SharePoint"
                              >
                                <span>Open</span>
                                <ExternalLink className="size-3.5" />
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
                            "text-xs font-semibold shrink-0 rounded-none py-1 px-2",
                            r.status === "completed" &&
                              "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10",
                            isUrgent &&
                              "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 font-semibold"
                          )}
                        >
                          {r.status === "completed"
                            ? "✓ Done"
                            : isOverdue
                            ? `🚨 ${Math.abs(daysLeft)}d overdue`
                            : `⏳ ${daysLeft}d left`}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 text-xs text-muted-foreground pt-2 border-t border-border/60">
                        <div>
                          <span className="block text-xs uppercase font-semibold text-muted-foreground">Due Date</span>
                          <span className="font-mono text-sm font-semibold text-foreground">{r.target_date}</span>
                        </div>
                        <div>
                          <span className="block text-xs uppercase font-semibold text-muted-foreground">Category</span>
                          <span className="capitalize text-xs font-medium text-foreground">{r.category}</span>
                        </div>
                        {r.amount !== null && (
                          <div>
                            <span className="block text-xs uppercase font-semibold text-muted-foreground">Value</span>
                            <span className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400">
                              {r.amount.toLocaleString()} {r.currency || "USD"}
                            </span>
                          </div>
                        )}
                        <div>
                          <span className="block text-xs uppercase font-semibold text-muted-foreground">Responsible</span>
                          <span className="truncate block text-xs font-medium text-foreground" title={r.responsible_name || "Unassigned"}>
                            {r.responsible_name || "Unassigned"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-border/60">
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
                            "text-xs font-semibold capitalize rounded-none py-1 px-2.5",
                            r.status === "completed" &&
                              "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                          )}
                        >
                          {r.status === "completed" ? "✓ Completed" : r.status}
                        </Badge>

                        <div className="flex items-center gap-2">
                          {r.status === "pending" && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busyId === r.id}
                                onClick={() => void completeTask(r.id)}
                                title="Mark completed"
                                className="rounded-none h-8 px-3 text-xs font-semibold gap-1.5 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/30"
                              >
                                <Check data-icon="inline-start" className="size-3.5" />
                                Done
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={busyId === r.id}
                                onClick={() => void dismissReminder(r.id)}
                                title="Dismiss notification"
                                className="rounded-none size-8 text-destructive/80 hover:text-destructive hover:bg-destructive/15"
                              >
                                <BellOff className="size-4" />
                              </Button>
                            </>
                          )}

                          {(r.status === "completed" || r.status === "dismissed") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busyId === r.id}
                              onClick={() => void reopenTask(r.id)}
                              title="Re-open item"
                              className="rounded-none h-8 px-3 text-xs font-medium gap-1.5 text-muted-foreground hover:text-foreground"
                            >
                              <RotateCcw data-icon="inline-start" className="size-3.5" />
                              Re-open
                            </Button>
                          )}

                          {isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busyId === r.id}
                              onClick={() => void testSend(r.id)}
                              className="rounded-none h-8 px-2.5 text-xs gap-1.5"
                              title="Send test email & Teams notification"
                            >
                              <Send data-icon="inline-start" />
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
          )}

          {/* Table View (Horizontally Scrollable) */}
          {viewMode === "table" && (
            <div className="space-y-1.5 min-w-0 max-w-full">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  Showing <strong>{filtered.length === 0 ? 0 : startIndex + 1}–{endIndex}</strong> of <strong>{filtered.length}</strong> items
                </span>
                <span className="font-mono text-xs text-muted-foreground font-medium">
                  ↔ Scroll horizontally to view all columns
                </span>
              </div>
              <div className="w-full min-w-0 max-w-full [&>div]:border [&>div]:border-border [&>div]:bg-card">
                <Table className="w-full min-w-[1350px]">
                  <TableHeader>
                    <TableRow className="group/row hover:bg-transparent border-b">
                      <TableHead className="sticky left-0 z-20 bg-muted border-e border-border/70 min-w-[300px] max-w-[380px] py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Item & Category
                      </TableHead>
                      <TableHead className="min-w-[260px] max-w-[340px] py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Document & Path
                      </TableHead>
                      <TableHead className="min-w-[160px] whitespace-nowrap py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Target Date
                      </TableHead>
                      <TableHead className="min-w-[130px] whitespace-nowrap py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Value
                      </TableHead>
                      <TableHead className="min-w-[220px] whitespace-nowrap py-3 px-3.5 text-xs font-bold uppercase text-foreground/80">
                        Responsible
                      </TableHead>
                      <TableHead className="min-w-[120px] whitespace-nowrap text-center py-3 px-2 text-xs font-bold uppercase text-foreground/80">
                        Status
                      </TableHead>
                      <TableHead className="min-w-[200px] whitespace-nowrap text-end py-3 px-3.5">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedReminders.map((r) => {
                      const daysLeft = Math.ceil(
                        (new Date(r.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                      );
                      const isOverdue = daysLeft < 0 && r.status === "pending";
                      const isUrgent = daysLeft <= 30 && daysLeft >= 0 && r.status === "pending";

                      return (
                        <TableRow key={r.id} className="group/row hover:bg-muted/40 transition-colors">
                          <TableCell className="sticky left-0 z-10 bg-card group-hover/row:bg-muted/40 transition-colors border-e border-border/70 min-w-[300px] max-w-[380px] align-middle py-3.5 px-3.5">
                            <p
                              className={cn(
                                "text-sm font-semibold leading-snug whitespace-normal break-words text-foreground",
                                r.status === "completed" && "line-through text-muted-foreground"
                              )}
                              title={r.title}
                            >
                              {r.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                              <span
                                className={cn(
                                  "size-2 rounded-full shrink-0",
                                  r.category === "expiry"
                                    ? "bg-rose-500"
                                    : r.category === "renewal"
                                    ? "bg-blue-500"
                                    : r.category === "task"
                                    ? "bg-emerald-500"
                                    : "bg-amber-500"
                                )}
                              />
                              <span className="capitalize font-medium">{r.category.replace(/_/g, " ")}</span>
                              {r.notes && (
                                <span className="text-muted-foreground break-words" title={r.notes}>
                                  · {r.notes}
                                </span>
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="min-w-[280px] max-w-[360px] align-middle py-3.5 px-3.5">
                            <div className="flex items-center gap-1.5">
                              <p
                                className="font-semibold text-xs sm:text-sm leading-snug break-words whitespace-normal text-foreground"
                                title={r.document_name ?? undefined}
                              >
                                {r.document_name}
                              </p>
                              {r.document_url && (
                                <a
                                  href={r.document_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:text-primary/80 shrink-0 inline-flex items-center p-0.5"
                                  title="Open in SharePoint"
                                >
                                  <ExternalLink className="size-3.5" />
                                </a>
                              )}
                            </div>
                            <div
                              className="text-xs text-muted-foreground font-mono break-words mt-1"
                              title={r.document_path || "SharePoint"}
                            >
                              {r.document_path || "SharePoint"}
                            </div>
                          </TableCell>

                          <TableCell className="min-w-[170px] whitespace-nowrap text-xs sm:text-sm font-mono align-middle py-3.5 px-3.5">
                            <div className="font-semibold text-foreground">{r.target_date}</div>
                            <span
                              className={cn(
                                "text-xs font-semibold block mt-0.5",
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
                                ? "✓ Done"
                                : isOverdue
                                ? `🚨 ${Math.abs(daysLeft)}d overdue`
                                : `⏳ ${daysLeft}d left`}
                            </span>
                            <span className="text-xs text-muted-foreground block font-sans capitalize mt-0.5">
                              {r.lead_days === 0
                                ? "Due today"
                                : [1, 3, 5].includes(r.lead_days)
                                ? `3x final week (${r.lead_days}d)`
                                : [7, 14, 21].includes(r.lead_days)
                                ? `Weekly (${r.lead_days}d)`
                                : `Monthly (${r.lead_days}d)`}
                            </span>
                          </TableCell>

                          <TableCell className="min-w-[140px] whitespace-nowrap text-sm font-mono align-middle py-3.5 px-3.5">
                            {r.amount !== null ? (
                              <span className="font-bold text-emerald-700 dark:text-emerald-400">
                                {r.amount.toLocaleString()} {r.currency || "USD"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </TableCell>

                          <TableCell
                            className="min-w-[240px] whitespace-nowrap text-xs sm:text-sm text-foreground/80 align-middle py-3.5 px-3.5"
                            title={r.recipient_email || r.responsible_name || "Unassigned"}
                          >
                            <div className="font-semibold text-foreground">
                              {r.responsible_name || "Unassigned"}
                            </div>
                            {r.recipient_email && (
                              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                                {r.recipient_email}
                              </div>
                            )}
                          </TableCell>

                          <TableCell className="min-w-[130px] whitespace-nowrap text-center align-middle py-3.5 px-2">
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
                                "capitalize text-xs font-semibold rounded-none py-1 px-2.5",
                                r.status === "completed" &&
                                  "border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                              )}
                            >
                              {r.status === "completed" ? "✓ Done" : r.status}
                            </Badge>
                          </TableCell>

                          <TableCell className="min-w-[210px] whitespace-nowrap text-end align-middle py-3.5 px-3.5">
                            <div className="flex items-center justify-end gap-2 flex-nowrap shrink-0">
                              {r.status === "pending" && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={busyId === r.id}
                                    onClick={() => void completeTask(r.id)}
                                    title="Mark as completed"
                                    className="rounded-none h-8 px-3 text-xs font-semibold gap-1.5 shrink-0 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/30"
                                  >
                                    <Check data-icon="inline-start" />
                                    Done
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={busyId === r.id}
                                    onClick={() => void dismissReminder(r.id)}
                                    title="Dismiss item"
                                    className="rounded-none size-8 shrink-0 text-destructive/80 hover:text-destructive hover:bg-destructive/15"
                                  >
                                    <BellOff className="size-4" />
                                    <span className="sr-only">Dismiss</span>
                                  </Button>
                                </>
                              )}

                              {(r.status === "completed" || r.status === "dismissed") && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busyId === r.id}
                                  onClick={() => void reopenTask(r.id)}
                                  title="Re-open item"
                                  className="rounded-none h-8 px-3 text-xs font-medium gap-1.5 shrink-0 text-muted-foreground hover:text-foreground"
                                >
                                  <RotateCcw data-icon="inline-start" />
                                  Re-open
                                </Button>
                              )}

                              {isAdmin && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={busyId === r.id}
                                  onClick={() => void testSend(r.id)}
                                  title="Send test email & Teams notification"
                                  className="rounded-none h-8 px-2.5 text-xs gap-1.5 shrink-0"
                                >
                                  <Send data-icon="inline-start" />
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
            </div>
          )}

          {/* Pagination Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border/60">
            <p className="text-xs text-muted-foreground">
              Showing <strong>{filtered.length === 0 ? 0 : startIndex + 1}–{endIndex}</strong> of <strong>{filtered.length}</strong> items
              {totalPages > 1 && <> (Page <strong>{activePage}</strong> of <strong>{totalPages}</strong>)</>}
            </p>
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    disabled={activePage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  />
                </PaginationItem>
                {getPageItems(activePage, totalPages).map((item) => (
                  <PaginationItem key={item.key}>
                    {item.type === "ellipsis" ? (
                      <PaginationEllipsis />
                    ) : (
                      <PaginationLink
                        isActive={item.value === activePage}
                        onClick={() => setCurrentPage(item.value!)}
                      >
                        {item.value}
                      </PaginationLink>
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    disabled={activePage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
