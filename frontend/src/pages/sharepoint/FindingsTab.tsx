import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckSquare,
  Clock,
  ExternalLink,
  FileCode,
  Search,
  ShieldAlert,
  Sparkles,
  User,
  Users,
  X,
} from "lucide-react";
import { readableStatus, type AnalysisSection, type Evidence, type Finding } from "@/api/sharepoint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

type CategoryKey = "all" | "tasks" | "deadlines" | "risks" | "blockers" | "contacts";

function EvidenceQuotes({
  entries,
  onViewSource,
}: {
  entries: Evidence[];
  onViewSource: (segmentId: string) => void;
}) {
  if (!entries.length) return null;
  return (
    <div className="space-y-2 pt-2 border-t border-border/60">
      <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider flex items-center gap-1.5">
        <FileCode className="size-3.5 text-primary" /> Cited Sources
      </div>
      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={`${entry.segment_id}:${entry.quote.slice(0, 30)}`}
            className="text-xs border-s-2 border-primary/50 ps-3 py-1 bg-muted/20"
          >
            <p dir="auto" className="break-words text-foreground/85 leading-relaxed italic text-xs">
              "{entry.quote}"
            </p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onViewSource(entry.segment_id)}
              className="mt-1.5 h-6 px-2 text-xs font-mono font-semibold gap-1 text-primary hover:text-primary hover:bg-primary/10 rounded-none"
              title="Jump to source excerpt"
            >
              <ExternalLink className="size-3" />
              Source #{entry.segment_id}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const p = priority.toLowerCase();
  if (p === "high" || p === "critical") {
    return (
      <Badge variant="destructive" className="capitalize text-xs py-0.5 px-2 font-semibold rounded-none">
        {priority}
      </Badge>
    );
  }
  if (p === "medium") {
    return (
      <Badge
        variant="outline"
        className="capitalize text-xs py-0.5 px-2 font-semibold bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 rounded-none"
      >
        {priority}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="capitalize text-xs py-0.5 px-2 font-semibold rounded-none">
      {priority}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "done" || s === "resolved" || s === "completed") {
    return (
      <Badge
        variant="outline"
        className="capitalize text-xs py-0.5 px-2 font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 rounded-none"
      >
        ✓ {readableStatus(status)}
      </Badge>
    );
  }
  if (s === "in_progress" || s === "active") {
    return (
      <Badge
        variant="outline"
        className="capitalize text-xs py-0.5 px-2 font-semibold bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30 rounded-none"
      >
        {readableStatus(status)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="capitalize text-xs py-0.5 px-2 font-semibold rounded-none">
      {readableStatus(status)}
    </Badge>
  );
}

export function FindingsTab({
  section,
  onViewSource,
}: {
  section: AnalysisSection;
  onViewSource: (segmentId: string) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("all");
  const [filterQuery, setFilterQuery] = useState("");

  const tasks = section.tasks || [];
  const deadlines = section.deadlines || [];
  const risks = section.risks || [];
  const blockers = section.blockers || [];
  const contacts = section.contacts || [];

  const counts = {
    all: tasks.length + deadlines.length + risks.length + blockers.length + contacts.length,
    tasks: tasks.length,
    deadlines: deadlines.length,
    risks: risks.length,
    blockers: blockers.length,
    contacts: contacts.length,
  };

  const allItemsWithCategory = useMemo(() => {
    const list: Array<{ item: Finding; category: CategoryKey; icon: typeof CheckSquare }> = [];
    (section.tasks || []).forEach((item) => list.push({ item, category: "tasks", icon: CheckSquare }));
    (section.deadlines || []).forEach((item) => list.push({ item, category: "deadlines", icon: Clock }));
    (section.risks || []).forEach((item) => list.push({ item, category: "risks", icon: AlertTriangle }));
    (section.blockers || []).forEach((item) => list.push({ item, category: "blockers", icon: ShieldAlert }));
    (section.contacts || []).forEach((item) => list.push({ item, category: "contacts", icon: Users }));
    return list;
  }, [section]);

  const filteredItems = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return allItemsWithCategory.filter(({ item, category }) => {
      if (activeCategory !== "all" && category !== activeCategory) {
        return false;
      }
      if (q) {
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchOwner = item.owner?.toLowerCase().includes(q);
        const matchDeadline = item.deadline?.toLowerCase().includes(q);
        if (!matchTitle && !matchOwner && !matchDeadline) return false;
      }
      return true;
    });
  }, [allItemsWithCategory, activeCategory, filterQuery]);

  return (
    <div className="space-y-4">
      {/* Executive Summary Card */}
      {section.summary && (
        <Card className="border-border bg-card">
          <CardHeader className="p-3.5 pb-2.5 border-b border-border/70 bg-muted/20">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <Sparkles className="size-4 text-primary" />
                Executive Summary
              </CardTitle>
              {section.project_status && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground font-medium">Status:</span>
                  <Badge variant="outline" className="font-semibold text-xs py-0.5 px-2 rounded-none">
                    {section.project_status}
                  </Badge>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <p dir="auto" className="whitespace-pre-wrap break-words text-sm sm:text-base leading-relaxed text-foreground">
              {section.summary}
            </p>
            {section.summary_evidence && section.summary_evidence.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-border/50 text-xs">
                <span className="text-muted-foreground mr-1 font-medium">Summary sources:</span>
                {section.summary_evidence.map((ev) => (
                  <Button
                    key={ev.segment_id}
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => onViewSource(ev.segment_id)}
                    className="h-6 px-2 text-xs font-mono font-semibold gap-1 text-primary hover:bg-primary/10 rounded-none"
                    title={`"${ev.quote}"`}
                  >
                    <FileCode className="size-3" />
                    #{ev.segment_id}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Category Filter & Search Bar */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant={activeCategory === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveCategory("all")}
              className="h-9 px-3 text-xs sm:text-sm font-medium rounded-none"
            >
              All ({counts.all})
            </Button>
            {counts.tasks > 0 && (
              <Button
                variant={activeCategory === "tasks" ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveCategory("tasks")}
                className="h-9 px-3 text-xs sm:text-sm font-medium gap-1.5 rounded-none"
              >
                <CheckSquare className="size-3.5" />
                Tasks ({counts.tasks})
              </Button>
            )}
            {counts.deadlines > 0 && (
              <Button
                variant={activeCategory === "deadlines" ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveCategory("deadlines")}
                className="h-9 px-3 text-xs sm:text-sm font-medium gap-1.5 rounded-none"
              >
                <Clock className="size-3.5" />
                Deadlines ({counts.deadlines})
              </Button>
            )}
            {counts.risks > 0 && (
              <Button
                variant={activeCategory === "risks" ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveCategory("risks")}
                className="h-9 px-3 text-xs sm:text-sm font-medium gap-1.5 rounded-none"
              >
                <AlertTriangle className="size-3.5" />
                Risks ({counts.risks})
              </Button>
            )}
            {counts.blockers > 0 && (
              <Button
                variant={activeCategory === "blockers" ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveCategory("blockers")}
                className="h-9 px-3 text-xs sm:text-sm font-medium gap-1.5 rounded-none"
              >
                <ShieldAlert className="size-3.5" />
                Blockers ({counts.blockers})
              </Button>
            )}
            {counts.contacts > 0 && (
              <Button
                variant={activeCategory === "contacts" ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveCategory("contacts")}
                className="h-9 px-3 text-xs sm:text-sm font-medium gap-1.5 rounded-none"
              >
                <Users className="size-3.5" />
                Contacts ({counts.contacts})
              </Button>
            )}
          </div>

          <div className="w-full sm:w-60">
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <Search className="size-3.5 text-muted-foreground" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Filter findings…"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="text-xs sm:text-sm h-9"
              />
              {filterQuery && (
                <InputGroupButton onClick={() => setFilterQuery("")} title="Clear filter">
                  <X className="size-3.5" />
                </InputGroupButton>
              )}
            </InputGroup>
          </div>
        </div>
      </div>

      {/* Findings Grid */}
      {filteredItems.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-border p-6 space-y-1.5">
          <p className="text-sm font-semibold text-foreground">No findings match the active criteria</p>
          <p className="text-xs text-muted-foreground">
            Try switching categories or clearing your search term.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredItems.map(({ item, category, icon: Icon }) => (
            <Card
              key={`${category}:${item.title}:${item.evidence.map((e) => e.segment_id).join(",")}`}
              className="border-border hover:border-border/80 transition-colors flex flex-col justify-between"
            >
              <div>
                <CardHeader className="p-3.5 pb-2.5 border-b border-border/50 bg-muted/20">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-start gap-2 min-w-0">
                      <Icon className="size-4 text-primary shrink-0 mt-0.5" />
                      <CardTitle dir="auto" className="text-sm sm:text-base font-bold leading-snug break-words text-foreground">
                        {item.title}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.priority && item.priority !== "unknown" && <PriorityBadge priority={item.priority} />}
                      {item.status && item.status !== "unknown" && <StatusBadge status={item.status} />}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-3.5 space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2 text-xs text-foreground/80 font-medium">
                    {item.owner && (
                      <div className="flex items-center gap-1.5 truncate" title={item.owner}>
                        <User className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate" dir="auto">
                          {item.owner}
                        </span>
                      </div>
                    )}
                    {item.deadline && (
                      <div className="flex items-center gap-1.5 font-mono text-foreground font-semibold">
                        <Calendar className="size-3.5 shrink-0 text-muted-foreground" />
                        <span>{item.deadline}</span>
                      </div>
                    )}
                  </div>

                  <EvidenceQuotes entries={item.evidence} onViewSource={onViewSource} />
                </CardContent>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
