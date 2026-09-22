import { useId, useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock, FileText, Search } from "lucide-react";
import type {
  SharePointDocument,
  SharePointReminder,
  SharePointStatus,
} from "@/api/sharepoint";
import { readableStatus } from "@/api/sharepoint";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

export interface DocumentsHomeTabProps {
  documents: SharePointDocument[];
  reminders: SharePointReminder[];
  status: SharePointStatus | null;
  isLoadingDocs?: boolean;
  isLoadingReminders?: boolean;
  onNavigateTab: (
    tab: "home" | "documents" | "assistant" | "alerts",
    initialQuery?: string,
    docId?: string
  ) => void;
  onOpenDoc: (docId: string) => void;
  onCompleteReminder: (reminderId: string) => Promise<void>;
  onSnoozeReminder?: (reminderId: string, days: number) => Promise<void>;
}

interface AttentionItem {
  id: string;
  documentId: string;
  reminderId?: string;
  title: string;
  subtitle: string;
  sortKey: number;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return format(d, "MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

function formatRelativeModified(iso: string | null | undefined): string {
  if (!iso) return "Recently";
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return "Recently";

    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 0 || diffSec < 60) return "Just now";
    if (diffSec < 3600) {
      const mins = Math.floor(diffSec / 60);
      return `${mins} ${mins === 1 ? "minute" : "minutes"} ago`;
    }
    if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    }

    const days = Math.floor(diffSec / 86400);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) {
      const weeks = Math.floor(days / 7);
      return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
    }
    const months = Math.floor(days / 30);
    if (months < 12) {
      return `${months} ${months === 1 ? "month" : "months"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? "year" : "years"} ago`;
  } catch {
    return "Recently";
  }
}

export function DocumentsHomeTab({
  documents,
  reminders,
  status,
  isLoadingDocs = false,
  isLoadingReminders = false,
  onNavigateTab,
  onOpenDoc,
  onCompleteReminder,
  onSnoozeReminder,
}: DocumentsHomeTabProps) {
  const { user } = useAuth();
  const searchInputId = useId();
  const [searchQuery, setSearchQuery] = useState("");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [openSnoozeId, setOpenSnoozeId] = useState<string | null>(null);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);

  const handleSnooze = async (reminderId: string, days: number) => {
    setOpenSnoozeId(null);
    if (!onSnoozeReminder) return;
    setSnoozingId(reminderId);
    try {
      await onSnoozeReminder(reminderId, days);
    } finally {
      setSnoozingId(null);
    }
  };

  // Time-of-day greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const userName = useMemo(() => {
    if (user?.given_name?.trim()) return user.given_name.trim();
    if (user?.display_name?.trim()) return user.display_name.trim().split(" ")[0];
    return "there";
  }, [user]);

  // Relative sync time
  const syncTimeText = useMemo(() => {
    if (status?.active_run) {
      return "Sync in progress…";
    }
    let latest = 0;
    for (const doc of documents) {
      if (doc.processed_at) {
        const t = new Date(doc.processed_at).getTime();
        if (!isNaN(t) && t > latest) latest = t;
      }
      if (doc.modified_at) {
        const t = new Date(doc.modified_at).getTime();
        if (!isNaN(t) && t > latest) latest = t;
      }
    }
    if (latest > 0) {
      const rel = formatRelativeModified(new Date(latest).toISOString());
      return `Updated ${rel.toLowerCase()}`;
    }
    if (status?.run?.status) {
      return `Last sync: ${readableStatus(status.run.status)}`;
    }
    return "Updated recently";
  }, [documents, status]);

  const safeReminders = useMemo(() => (Array.isArray(reminders) ? reminders : []), [reminders]);
  const safeDocuments = useMemo(() => (Array.isArray(documents) ? documents : []), [documents]);

  // Attention items: overdue reminders, reminders due soon (<= 30 days), and documents requiring attention
  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];
    const now = Date.now();

    for (const r of safeReminders) {
      if (r.status === "completed" || r.status === "dismissed") continue;

      const targetTime = new Date(r.target_date).getTime();
      const daysLeft = Math.ceil((targetTime - now) / (1000 * 60 * 60 * 24));
      const isOverdue = daysLeft < 0 || r.status === "overdue";
      const isDueSoon = daysLeft >= 0 && daysLeft <= 30;

      if (isOverdue || isDueSoon) {
        let title: string;
        const isRenewal =
          r.category === "renewal" || r.title.toLowerCase().includes("renewal");

        if (isOverdue) {
          const d = Math.abs(daysLeft);
          if (isRenewal) {
            title = d > 0 ? `${r.title} renewal overdue by ${d} ${d === 1 ? "day" : "days"}` : `${r.title} renewal due`;
          } else {
            title = d > 0 ? `${r.title} overdue by ${d} ${d === 1 ? "day" : "days"}` : `${r.title} overdue`;
          }
        } else if (daysLeft === 0) {
          title = isRenewal ? `${r.title} renewal due today` : `${r.title} expires today`;
        } else if (daysLeft === 1) {
          title = isRenewal ? `${r.title} renewal due tomorrow` : `${r.title} expires tomorrow`;
        } else {
          title = isRenewal
            ? `${r.title} renewal due in ${daysLeft} days`
            : `${r.title} expires in ${daysLeft} days`;
        }

        const formattedDate = formatDate(r.target_date);
        const docName = r.document_name || "Document";
        const subtitle = `${formattedDate} · from ${docName}`;

        items.push({
          id: `reminder-${r.id}`,
          documentId: r.document_id,
          reminderId: r.id,
          title,
          subtitle,
          sortKey: isOverdue ? -1000 + daysLeft : daysLeft,
        });
      }
    }

    for (const doc of safeDocuments) {
      if (doc.requires_attention) {
        const alreadyHasReminder = items.some((item) => item.documentId === doc.id);
        if (!alreadyHasReminder) {
          items.push({
            id: `doc-${doc.id}`,
            documentId: doc.id,
            title: `${doc.name} requires attention`,
            subtitle: doc.modified_at
              ? `${formatDate(doc.modified_at)} · Requires review`
              : "Requires review",
            sortKey: 50,
          });
        }
      }
    }

    items.sort((a, b) => a.sortKey - b.sortKey);
    return items;
  }, [safeReminders, safeDocuments]);

  const topAttentionItems = useMemo(
    () => attentionItems.slice(0, 3),
    [attentionItems]
  );

  const handleCompleteReminder = async (reminderId: string) => {
    setCompletingId(reminderId);
    try {
      await onCompleteReminder(reminderId);
    } finally {
      setCompletingId(null);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query) {
      onNavigateTab("assistant", query);
    }
  };

  // Up to 4 most recently modified documents
  const recentDocs = useMemo(() => {
    return [...safeDocuments]
      .sort((a, b) => {
        const timeA = new Date(a.modified_at || a.processed_at || 0).getTime();
        const timeB = new Date(b.modified_at || b.processed_at || 0).getTime();
        return timeB - timeA;
      })
      .slice(0, 4);
  }, [safeDocuments]);

  return (
    <div className="flex flex-col gap-6 min-w-0 max-w-full">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {greeting}, {userName}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            You have access to {safeDocuments.length} documents.
          </p>
        </div>
        <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 self-start sm:self-auto">
          <Clock className="size-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
          <span>{syncTimeText}</span>
        </div>
      </div>

      {/* Attention Card ("X things need your attention") */}
      {isLoadingReminders && reminders.length === 0 ? (
        <div className="border border-destructive/40 bg-card rounded-none p-3.5 space-y-2.5">
          <Skeleton className="h-4 w-48 bg-muted" />
          <Skeleton className="h-10 w-full bg-muted" />
        </div>
      ) : attentionItems.length > 0 ? (
        <div className="border border-destructive/40 bg-card rounded-none p-0 overflow-hidden shadow-xs">
          <div className="flex items-center gap-2 p-3.5 pb-2.5 border-b border-border bg-destructive/10">
            <AlertTriangle className="size-4 text-destructive shrink-0" aria-hidden="true" />
            <h2 className="text-sm font-bold text-foreground">
              <span className="text-destructive font-bold">{attentionItems.length}</span>{" "}
              {attentionItems.length === 1 ? "thing needs" : "things need"} your attention
            </h2>
          </div>

          <div className="divide-y divide-border/60">
            {topAttentionItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-semibold text-foreground truncate" title={item.title}>
                    {item.title}
                  </div>
                  <div className="text-xs text-muted-foreground truncate" title={item.subtitle}>
                    {item.subtitle}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => onOpenDoc(item.documentId)}
                    aria-label={`View document ${item.title}`}
                    className="rounded-none h-8 px-3 text-xs"
                  >
                    Open
                  </Button>
                  {item.reminderId ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={completingId === item.reminderId || snoozingId === item.reminderId}
                        onClick={() => void handleCompleteReminder(item.reminderId!)}
                        className="rounded-none h-8 px-3 text-xs"
                      >
                        {completingId === item.reminderId ? (
                          <>
                            <Spinner data-icon="inline-start" className="size-3" />
                            <span>Done</span>
                          </>
                        ) : (
                          "Done"
                        )}
                      </Button>

                      {onSnoozeReminder && (
                        <Popover
                          open={openSnoozeId === item.reminderId}
                          onOpenChange={(open) => setOpenSnoozeId(open ? item.reminderId! : null)}
                        >
                          <PopoverTrigger
                            render={
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={completingId === item.reminderId || snoozingId === item.reminderId}
                                className="rounded-none h-8 px-2.5 text-xs font-medium"
                                aria-label={`Snooze ${item.title}`}
                              >
                                {snoozingId === item.reminderId ? (
                                  <Spinner data-icon="inline-start" className="size-3" />
                                ) : (
                                  <Clock data-icon="inline-start" className="size-3 text-muted-foreground" />
                                )}
                                <span>Snooze</span>
                              </Button>
                            }
                          />
                          <PopoverContent align="end" className="w-40 p-1.5 rounded-none">
                            <PopoverHeader className="px-2 py-1">
                              <PopoverTitle className="text-xs font-semibold">
                                Snooze reminder
                              </PopoverTitle>
                              <PopoverDescription className="sr-only">
                                Select duration to postpone this reminder
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
                                  onClick={() => void handleSnooze(item.reminderId!, days)}
                                >
                                  {days} days
                                </Button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border bg-muted/20">
            <button
              type="button"
              onClick={() => onNavigateTab("alerts")}
              className="text-xs font-semibold text-primary hover:underline p-3 flex items-center gap-1"
            >
              See all alerts and reminders →
            </button>
          </div>
        </div>
      ) : !isLoadingDocs && !isLoadingReminders ? (
        <div className="bg-card border border-border p-4.5 rounded-none shadow-xs flex items-center gap-3.5">
          <div className="size-9 bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-700 dark:text-emerald-300 shrink-0 rounded-none">
            <CheckCircle2 className="size-4.5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">You're all caught up!</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              No urgent contracts, licences, or deadlines require your attention right now. All documents are in good standing.
            </p>
          </div>
        </div>
      ) : null}

      {/* Ask About Your Documents Card */}
      <div className="bg-card border border-border p-5 rounded-none shadow-xs space-y-3.5">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Ask about your documents
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            One assistant across everything you have access to — licences, contracts, prices and deadlines.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="w-full">
          <label htmlFor={searchInputId} className="sr-only">
            Ask about your documents
          </label>
          <InputGroup className="h-10">
            <InputGroupAddon align="inline-start">
              <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id={searchInputId}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Which licences expire in the next 3 months?"
              className="text-sm h-full"
            />
            <InputGroupAddon align="inline-end">
              <Button
                type="submit"
                variant="default"
                size="sm"
                className="rounded-none h-7 px-3 text-xs"
              >
                Ask
              </Button>
            </InputGroupAddon>
          </InputGroup>
        </form>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {[
            "Which licences expire soon?",
            "Which contracts need renewal?",
            "What is the price for Product X?",
          ].map((prompt) => (
            <Button
              key={prompt}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onNavigateTab("assistant", prompt)}
              className="rounded-none h-8 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {prompt}
            </Button>
          ))}
        </div>
      </div>

      {/* Recently Updated Card */}
      <div className="bg-card border border-border rounded-none shadow-xs overflow-hidden">
        <div className="flex items-center justify-between p-3.5 border-b border-border/70 bg-muted/20">
          <h2 className="text-sm font-semibold text-foreground">Recently updated</h2>
          <button
            type="button"
            onClick={() => onNavigateTab("documents")}
            className="text-xs text-primary font-medium hover:underline"
          >
            View all
          </button>
        </div>

        {isLoadingDocs && documents.length === 0 ? (
          <div className="p-3.5 space-y-2.5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : recentDocs.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No documents available yet.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {recentDocs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => onOpenDoc(doc.id)}
                aria-label={`View document ${doc.name}`}
                className="w-full flex items-center justify-between gap-3 p-3.5 hover:bg-muted/40 transition-colors text-left focus:outline-hidden group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText
                    className="size-4 text-primary shrink-0 group-hover:text-primary/80 transition-colors"
                    aria-hidden="true"
                  />
                  <span className="text-xs sm:text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    {doc.name}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 font-mono">
                  {formatRelativeModified(doc.modified_at || doc.processed_at)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default DocumentsHomeTab;
