import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileDown,
  MinusCircle,
  RefreshCw,
  ShieldCheck,
  Ticket as TicketIcon,
  UserRoundCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { api, apiUrl } from "../api/client";
import type {
  ChecklistRun,
  ChecklistRunDetail,
  ChecklistTemplate,
  ComplianceSummary,
  RunItem,
  RunItemStatus,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorState, Loading, Modal, PageHead, useToast } from "../components/ui";
import Attachments from "../components/Attachments";

type RunView = "mine" | "team" | "compliance";
type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "info" | "outline";

const RUN_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  todo: { label: "Not started", variant: "outline" },
  in_progress: { label: "In progress", variant: "warning" },
  submitted: { label: "Awaiting verification", variant: "info" },
  done: { label: "Verified", variant: "success" },
};
/** Left-edge stripe marking a checkpoint as dealt with. */
const ITEM_STRIPE: Record<RunItemStatus, string> = {
  pending: "border-l-transparent",
  ok: "border-l-success",
  issue: "border-l-destructive",
  na: "border-l-muted-foreground",
  done: "border-l-success",
};
/** Answers that let the checker move on. An issue needs its note written first. */
const ADVANCING: RunItemStatus[] = ["ok", "na", "done"];

const ITEM_STATUS: Record<RunItemStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Pending", variant: "outline" },
  ok: { label: "OK", variant: "success" },
  issue: { label: "Issue", variant: "destructive" },
  na: { label: "N/A", variant: "secondary" },
  done: { label: "Done", variant: "success" },
};

const RESPONSE_CHOICES: {
  key: Extract<RunItemStatus, "ok" | "issue" | "na">;
  label: string;
  icon: ComponentType;
}[] = [
  { key: "ok", label: "OK", icon: CheckCircle2 },
  { key: "issue", label: "Issue", icon: XCircle },
  { key: "na", label: "N/A", icon: MinusCircle },
];

const EMPTY_RUNS: ChecklistRun[] = [];
const EMPTY_TEMPLATES: ChecklistTemplate[] = [];

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(value?: string | null) {
  return value
    ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";
}

function duration(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function RunStatusBadge({ status }: { status: string }) {
  const meta = RUN_STATUS[status] ?? { label: titleCase(status), variant: "outline" as const };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function ItemStatusBadge({ status }: { status: RunItemStatus }) {
  const meta = ITEM_STATUS[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function MetricGrid({
  items,
}: {
  items: { label: string; value: string | number; description?: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} size="sm">
          <CardHeader>
            <CardTitle className="text-xl font-semibold tabular-nums">{item.value}</CardTitle>
            <CardDescription>{item.label}</CardDescription>
          </CardHeader>
          {item.description ? (
            <CardContent className="text-xs text-muted-foreground">{item.description}</CardContent>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

export default function RoutineChecksPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_admin || user?.role === "manager");
  const { notify } = useToast();
  const [view, setView] = useState<RunView>(isManager ? "team" : "mine");
  const [templateId, setTemplateId] = useState("");
  const [team, setTeam] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [params, setParams] = useSearchParams();

  const query = useMemo(() => {
    const next = new URLSearchParams();
    if (view === "mine") next.set("mine", "true");
    if (templateId) next.set("template_id", templateId);
    if (team) next.set("team", team);
    if (status) next.set("status", status);
    if (fromDate) next.set("from", fromDate);
    if (toDate) next.set("to", toDate);
    return next.toString();
  }, [fromDate, status, team, templateId, toDate, view]);

  const runsPath = view === "compliance" ? null : `/api/checklist-runs${query ? `?${query}` : ""}`;
  const runs = useFetch<ChecklistRun[]>(runsPath);
  const templates = useFetch<ChecklistTemplate[]>("/api/checklist-templates?active=true");
  const runParam = params.get("run");

  useEffect(() => {
    if (!runParam) return;
    setOpenId(runParam);
    setParams({}, { replace: true });
  }, [runParam, setParams]);

  const list = runs.data ?? EMPTY_RUNS;
  const templateList = templates.data ?? EMPTY_TEMPLATES;
  const teams = useMemo(
    () => [...new Set(templateList.map((template) => template.team).filter(Boolean))].sort(),
    [templateList],
  );
  const metrics = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [
      {
        value: list.filter((run) => run.status === "todo" || run.status === "in_progress").length,
        label: "Open rounds",
      },
      {
        value: list.filter((run) => run.status === "submitted").length,
        label: "Awaiting verification",
      },
      {
        value: list
          .filter((run) => run.run_date === today)
          .reduce((total, run) => total + run.issues, 0),
        label: "Issues today",
      },
      { value: list.filter((run) => run.is_late).length, label: "Late" },
    ];
  }, [list]);

  async function generateNow() {
    setIsGenerating(true);
    try {
      const result = await api<{ created: number }>("/api/checklist-templates/generate-due", {
        method: "POST",
        body: {},
      });
      notify(
        result.created
          ? `${result.created} round(s) generated.`
          : "Nothing due. Today's rounds already exist.",
      );
      await runs.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to generate due rounds.", "error");
    } finally {
      setIsGenerating(false);
    }
  }

  function clearFilters() {
    setTemplateId("");
    setTeam("");
    setStatus("");
    setFromDate("");
    setToDate("");
  }

  const hasFilters = Boolean(templateId || team || status || fromDate || toDate);

  return (
    <div>
      <PageHead
        title="Routine Checks"
        subtitle="Daily field rounds with accountable responses, photo evidence, and manager sign-off."
        action={
          <>
            {view !== "compliance" ? (
              <Button
                type="button"
                variant="outline"
                disabled={runs.loading}
                onClick={() => void runs.reload()}
              >
                {runs.loading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                Refresh
              </Button>
            ) : null}
            {isManager ? (
              <Button
                type="button"
                disabled={isGenerating}
                title="Generate any rounds due today. The scheduler also checks hourly."
                onClick={() => void generateNow()}
              >
                {isGenerating ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                {isGenerating ? "Generating…" : "Generate due"}
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs
        value={view}
        onValueChange={(value) => {
          if (value === "mine" || value === "team" || value === "compliance") setView(value);
        }}
      >
        <TabsList variant="line" className="mb-4 w-full justify-start overflow-x-auto">
          <TabsTrigger value="mine">
            <UserRoundCheck data-icon="inline-start" /> My rounds
          </TabsTrigger>
          {isManager ? (
            <TabsTrigger value="team">
              <Users data-icon="inline-start" /> Team rounds
            </TabsTrigger>
          ) : null}
          {isManager ? (
            <TabsTrigger value="compliance">
              <ShieldCheck data-icon="inline-start" /> Compliance
            </TabsTrigger>
          ) : null}
        </TabsList>

        {view === "compliance" && isManager ? (
          <TabsContent value="compliance">
            <Compliance teams={teams} />
          </TabsContent>
        ) : (
          <TabsContent value={view}>
            <div className="flex flex-col gap-4">
              <MetricGrid items={metrics} />

              <Card>
                <CardHeader>
                  <CardTitle>Filter rounds</CardTitle>
                  <CardDescription>Narrow the field list by schedule, team, checklist, or state.</CardDescription>
                  {hasFilters ? (
                    <CardAction>
                      <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>
                        Clear
                      </Button>
                    </CardAction>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <Field>
                      <FieldLabel htmlFor="routine-filter-from">From date</FieldLabel>
                      <Input
                        id="routine-filter-from"
                        type="date"
                        value={fromDate}
                        max={toDate || undefined}
                        onChange={(event) => setFromDate(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="routine-filter-to">To date</FieldLabel>
                      <Input
                        id="routine-filter-to"
                        type="date"
                        value={toDate}
                        min={fromDate || undefined}
                        onChange={(event) => setToDate(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="routine-filter-team">Team</FieldLabel>
                      <Select
                        items={[
                          { value: null, label: "All teams" },
                          ...teams.map((value) => ({ value, label: titleCase(value) })),
                        ]}
                        value={team || null}
                        onValueChange={(value) => setTeam(value ?? "")}
                      >
                        <SelectTrigger id="routine-filter-team" className="w-full">
                          <SelectValue placeholder="All teams" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={null}>All teams</SelectItem>
                            {teams.map((value) => (
                              <SelectItem key={value} value={value}>{titleCase(value)}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="routine-filter-template">Checklist</FieldLabel>
                      <Select
                        items={[
                          { value: null, label: "All checklists" },
                          ...templateList.map((template) => ({ value: template.id, label: template.name })),
                        ]}
                        value={templateId || null}
                        onValueChange={(value) => setTemplateId(value ?? "")}
                      >
                        <SelectTrigger id="routine-filter-template" className="w-full">
                          <SelectValue placeholder="All checklists" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={null}>All checklists</SelectItem>
                            {templateList.map((template) => (
                              <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="routine-filter-status">Status</FieldLabel>
                      <Select
                        items={[
                          { value: null, label: "All statuses" },
                          ...Object.entries(RUN_STATUS).map(([value, meta]) => ({ value, label: meta.label })),
                        ]}
                        value={status || null}
                        onValueChange={(value) => setStatus(value ?? "")}
                      >
                        <SelectTrigger id="routine-filter-status" className="w-full">
                          <SelectValue placeholder="All statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={null}>All statuses</SelectItem>
                            {Object.entries(RUN_STATUS).map(([value, meta]) => (
                              <SelectItem key={value} value={value}>{meta.label}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </FieldGroup>
                </CardContent>
              </Card>

              {templates.error ? (
                <Alert variant="destructive">
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>Checklist filters could not be loaded</AlertTitle>
                  <AlertDescription>{templates.error}</AlertDescription>
                  <AlertAction>
                    <Button type="button" size="sm" variant="outline" onClick={() => void templates.reload()}>
                      Retry
                    </Button>
                  </AlertAction>
                </Alert>
              ) : null}

              <Card className="py-0">
                <CardHeader className="border-b py-4">
                  <CardTitle>{view === "mine" ? "My rounds" : "Team rounds"}</CardTitle>
                  <CardDescription>
                    {list.length} {list.length === 1 ? "round" : "rounds"} in the current view
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {runs.error ? (
                    <ErrorState message={runs.error} onRetry={() => void runs.reload()} />
                  ) : runs.loading ? (
                    <div className="p-4"><Loading /></div>
                  ) : list.length === 0 ? (
                    <Empty
                      icon={<ClipboardCheck />}
                      message={hasFilters ? "No rounds match these filters" : "No rounds yet"}
                      hint={
                        hasFilters
                          ? "Clear or adjust the filters to widen the result set."
                          : isManager
                            ? "Create a checklist under Checklists, then generate today's rounds."
                            : "Nothing is assigned or available to claim right now."
                      }
                      action={
                        hasFilters ? (
                          <Button type="button" variant="outline" onClick={clearFilters}>Clear filters</Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <RunList runs={list} onOpen={setOpenId} />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {openId ? (
        <RunModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => { void runs.reload(); }}
        />
      ) : null}
    </div>
  );
}

function RunList({ runs, onOpen }: { runs: ChecklistRun[]; onOpen: (id: string) => void }) {
  return (
    <>
      <div className="grid gap-3 p-3 md:hidden">
        {runs.map((run) => {
          const pct = run.items_total ? Math.round((run.items_answered / run.items_total) * 100) : 0;
          return (
            <Card key={run.id} size="sm">
              <CardHeader>
                <CardTitle>{run.template_name ?? run.title}</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  {run.team ? <span>{titleCase(run.team)}</span> : null}
                  <span>{fmtDate(run.run_date)}</span>
                </CardDescription>
                <CardAction><RunStatusBadge status={run.status} /></CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {run.is_late ? <Badge variant="destructive">Late</Badge> : null}
                  <Badge variant="outline">Due {fmtDate(run.due_date ?? run.run_date)}</Badge>
                  {run.issues > 0 ? <Badge variant="destructive">{run.issues} issue(s)</Badge> : null}
                  {!run.assignee_name ? <Badge variant="warning">Unclaimed</Badge> : null}
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{run.assignee_name ?? "Available to claim"}</span>
                  <span className="font-medium tabular-nums">{run.items_answered}/{run.items_total}</span>
                </div>
                <Progress value={pct} aria-label={`${pct}% complete`} />
              </CardContent>
              <CardFooter className="justify-end">
                <Button type="button" className="min-h-11 w-full" onClick={() => onOpen(run.id)}>
                  Open round <ChevronRight data-icon="inline-end" />
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Checklist</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Issues</TableHead>
              <TableHead>Status</TableHead>
              <TableHead><span className="sr-only">Open</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="max-w-72 whitespace-normal">
                  <div className="font-medium">{run.template_name ?? run.title}</div>
                  {run.team ? <div className="text-xs text-muted-foreground">{titleCase(run.team)}</div> : null}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>{fmtDate(run.due_date ?? run.run_date)}</span>
                    {run.is_late ? <Badge variant="destructive">Late</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{run.assignee_name ?? <Badge variant="warning">Unclaimed</Badge>}</TableCell>
                <TableCell>
                  <span className="tabular-nums">{run.items_answered}/{run.items_total}</span>
                </TableCell>
                <TableCell>
                  {run.issues > 0 ? <Badge variant="destructive">{run.issues}</Badge> : "—"}
                </TableCell>
                <TableCell><RunStatusBadge status={run.status} /></TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Open ${run.template_name ?? run.title}`}
                    onClick={() => onOpen(run.id)}
                  >
                    Open <ChevronRight data-icon="inline-end" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function RunModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const { notify } = useToast();
  const detail = useFetch<ChecklistRunDetail>(`/api/checklist-runs/${id}`);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busyAction, setBusyAction] = useState<"claim" | "submit" | "verify" | "reject" | null>(null);
  // The checkpoint to scroll to once it has rendered (set by auto-advance).
  const [focusId, setFocusId] = useState<string | null>(null);

  // Runs after the section has been expanded, so the row exists in the DOM.
  // "nearest" keeps the view still when the next checkpoint is already on
  // screen and scrolls the minimum when it isn't — tapping down a long round
  // shouldn't shift the list under your thumb on every answer.
  useEffect(() => {
    if (!focusId) return;
    document
      .getElementById(`chk-${focusId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setFocusId(null);
  }, [focusId]);

  const run = detail.data;
  const locked = Boolean(run && (run.status === "submitted" || run.status === "done"));
  const isReviewer = Boolean(run && (user?.is_admin || run.reviewer_id === user?.id));
  const canVerify = Boolean(run && run.status === "submitted" && isReviewer);

  const sections = useMemo(() => {
    const groups: { key: string; name: string; items: RunItem[] }[] = [];
    for (const item of run?.items ?? []) {
      const name = item.section || "Checks";
      const previous = groups[groups.length - 1];
      if (previous?.name === name) previous.items.push(item);
      else groups.push({ key: `${name}:${item.id}`, name, items: [item] });
    }
    return groups;
  }, [run?.items]);

  /** Reveal a checkpoint: open its section, expand it and scroll it into view. */
  function focusItem(next: RunItem) {
    const sectionKey = sections.find((section) =>
      section.items.some((item) => item.id === next.id),
    )?.key;
    if (sectionKey) {
      setCollapsed((current) =>
        current[sectionKey] ? { ...current, [sectionKey]: false } : current,
      );
    }
    setExpandedItem(next.id);
    setFocusId(next.id);
  }

  async function respond(item: RunItem, body: Record<string, unknown>) {
    // Snapshot before the reload; only `item` changes, so "what's still
    // unanswered" can be worked out from it without waiting for the round-trip.
    const items = run?.items ?? [];
    try {
      await api(`/api/checklist-runs/items/${item.id}`, { method: "PATCH", body });
      await detail.reload();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The response could not be saved.", "error");
      return;
    }

    const status = body.status as RunItemStatus | undefined;
    if (!status || !ADVANCING.includes(status)) return;

    // A checkpoint owing photo evidence keeps the checker where they are.
    if (item.photo_required && status !== "na" && item.photo_count === 0) {
      setExpandedItem(item.id);
      setFocusId(item.id);
      notify("This checkpoint needs a photo before you move on.", "info");
      return;
    }

    const idx = items.findIndex((i) => i.id === item.id);
    const stillPending = (i: RunItem) => i.status === "pending" && i.id !== item.id;
    // Next one below, else wrap back to anything skipped earlier.
    const next = items.slice(idx + 1).find(stillPending) ?? items.find(stillPending);
    if (next) focusItem(next);
    else notify("All checkpoints answered — ready to submit.");
  }

  async function submit() {
    setBusyAction("submit");
    try {
      await api(`/api/checklist-runs/${id}/submit`, { method: "POST" });
      notify("Round submitted for verification.");
      await detail.reload();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The round could not be submitted.", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function claim() {
    setBusyAction("claim");
    try {
      await api(`/api/checklist-runs/${id}/claim`, { method: "POST" });
      notify("Round claimed.");
      await detail.reload();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The round could not be claimed.", "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function verify(decision: "verify" | "reject") {
    if (decision === "reject" && !reviewNote.trim()) {
      notify("Explain what needs redoing before sending the round back.", "error");
      return;
    }
    setBusyAction(decision);
    try {
      await api(`/api/checklist-runs/${id}/verify`, {
        method: "POST",
        body: { decision, note: reviewNote || null },
      });
      notify(decision === "verify" ? "Round verified and signed off." : "Round reopened and sent back.");
      await detail.reload();
      onChanged();
    } catch (error) {
      notify(error instanceof Error ? error.message : "The review decision could not be saved.", "error");
    } finally {
      setBusyAction(null);
    }
  }

  if (!run) {
    return (
      <Modal title="Round" description="Loading field round details" onClose={onClose} maxWidth={920}>
        {detail.error ? <ErrorState message={detail.error} onRetry={() => void detail.reload()} /> : <Loading />}
      </Modal>
    );
  }

  const answered = run.items.filter((item) => item.status !== "pending").length;
  const progress = run.items.length ? Math.round((answered / run.items.length) * 100) : 0;
  const missingPhotos = run.items.filter(
    (item) => item.photo_required && item.status !== "na" && item.photo_count === 0,
  ).length;
  const allAnswered = run.items.length > 0 && answered === run.items.length;
  const took = duration(run.started_at, run.submitted_at);

  return (
    <Modal
      title={run.template_name ?? run.title}
      description={run.description ?? "Complete each checkpoint, add evidence, then submit the round."}
      onClose={onClose}
      maxWidth={920}
    >
      {detail.error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Latest round data could not be loaded</AlertTitle>
          <AlertDescription>{detail.error}</AlertDescription>
          <AlertAction>
            <Button type="button" size="sm" variant="outline" onClick={() => void detail.reload()}>Retry</Button>
          </AlertAction>
        </Alert>
      ) : null}

      <Card
        size="sm"
        className={allAnswered ? "[&_[data-slot=progress-indicator]]:bg-success" : undefined}
      >
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} />
            {run.is_late ? <Badge variant="destructive">Late</Badge> : null}
          </CardTitle>
          <CardDescription>
            Due {fmtDate(run.due_date ?? run.run_date)}
            {detail.loading ? " · Refreshing…" : ""}
          </CardDescription>
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                window.open(
                  apiUrl(`/api/checklist-runs/${id}/report.pdf`),
                  "_blank",
                  "noopener",
                )
              }
            >
              <FileDown data-icon="inline-start" /> Export PDF
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Round date</dt>
              <dd className="mt-0.5 font-medium">{fmtDate(run.run_date)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Checked by</dt>
              <dd className="mt-0.5 font-medium">{run.assignee_name ?? "Unclaimed"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reviewer</dt>
              <dd className="mt-0.5 font-medium">{run.verified_by_name ?? run.reviewer_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Elapsed</dt>
              <dd className="mt-0.5 flex items-center gap-1 font-medium">
                <Clock aria-hidden="true" /> {took ?? "—"}
              </dd>
            </div>
          </dl>
          <Separator />
          <Progress value={progress}>
            <ProgressLabel>{answered}/{run.items.length} checks completed</ProgressLabel>
            <ProgressValue />
          </Progress>
          <div className="flex flex-wrap gap-2">
            {run.issues > 0 ? <Badge variant="destructive">{run.issues} issue(s)</Badge> : null}
            {missingPhotos > 0 ? <Badge variant="warning">{missingPhotos} photo(s) needed</Badge> : null}
            {run.verified_at ? <Badge variant="success">Signed off {fmtDate(run.verified_at)} at {fmtTime(run.verified_at)}</Badge> : null}
          </div>
        </CardContent>
      </Card>

      {allAnswered && !locked ? (
        <Alert className="border-success/40 bg-success/10">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>All {run.items.length} checkpoints answered</AlertTitle>
          <AlertDescription>
            {missingPhotos > 0
              ? `${missingPhotos} still need${missingPhotos === 1 ? "s" : ""} a photo before you can submit.`
              : "This round is complete and ready to submit."}
          </AlertDescription>
        </Alert>
      ) : null}

      {run.review_note ? (
        <Alert>
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>Reviewer note</AlertTitle>
          <AlertDescription>{run.review_note}</AlertDescription>
        </Alert>
      ) : null}

      {!run.assignee_id ? (
        <Alert>
          <UserRoundCheck aria-hidden="true" />
          <AlertTitle>This round is unclaimed</AlertTitle>
          <AlertDescription>Claim it before starting so the team knows who is carrying out the checks.</AlertDescription>
          <AlertAction>
            <Button type="button" disabled={busyAction !== null} onClick={() => void claim()}>
              {busyAction === "claim" ? <Spinner data-icon="inline-start" /> : null}
              {busyAction === "claim" ? "Claiming…" : "Claim round"}
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        {sections.map((section) => {
          const complete = section.items.filter((item) => item.status !== "pending").length;
          const isCollapsed = Boolean(collapsed[section.key]);
          return (
            <Collapsible
              key={section.key}
              open={!isCollapsed}
              onOpenChange={(open) => setCollapsed((current) => ({ ...current, [section.key]: !open }))}
            >
              {/* overflow-visible so the header can stick to the dialog scrollport. */}
              <Card className="gap-0 overflow-visible py-0">
                <CardHeader className="sticky top-0 z-10 border-b bg-card p-0">
                  <CollapsibleTrigger
                    type="button"
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-between px-4 py-3 text-left"
                      />
                    }
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {isCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                      <span className="truncate font-semibold">{section.name}</span>
                    </span>
                    <Badge variant={complete === section.items.length ? "success" : "outline"}>
                      {complete}/{section.items.length}
                    </Badge>
                  </CollapsibleTrigger>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="p-0">
                    {section.items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        locked={locked}
                        expanded={expandedItem === item.id}
                        onToggleExpand={() => setExpandedItem((current) => current === item.id ? null : item.id)}
                        onRespond={(body) => respond(item, body)}
                        onPhotoChanged={() => {
                          void detail.reload();
                          onChanged();
                        }}
                      />
                    ))}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>

      {!locked ? (
        <div className="sticky bottom-0 -mx-4 flex justify-end border-t bg-background px-4 py-3">
          <Button
            type="button"
            className="min-h-11 w-full sm:w-auto"
            disabled={busyAction !== null}
            onClick={() => void submit()}
          >
            {busyAction === "submit" ? <Spinner data-icon="inline-start" /> : <CheckCircle2 data-icon="inline-start" />}
            {busyAction === "submit" ? "Submitting…" : "Submit for verification"}
          </Button>
        </div>
      ) : null}

      {canVerify ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" /> Verification
            </CardTitle>
            <CardDescription>Review the completed checks, issue evidence, and required photos before signing off.</CardDescription>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor="routine-review-note">Review note</FieldLabel>
              <Textarea
                id="routine-review-note"
                rows={3}
                value={reviewNote}
                placeholder="For example: the server-room photo needs to be retaken."
                onChange={(event) => setReviewNote(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Required when reopening and sending the round back.</p>
            </Field>
          </CardContent>
          <CardFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              disabled={busyAction !== null}
              onClick={() => void verify("reject")}
            >
              {busyAction === "reject" ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              {busyAction === "reject" ? "Sending back…" : "Reopen & send back"}
            </Button>
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              disabled={busyAction !== null}
              onClick={() => void verify("verify")}
            >
              {busyAction === "verify" ? <Spinner data-icon="inline-start" /> : <ShieldCheck data-icon="inline-start" />}
              {busyAction === "verify" ? "Signing off…" : "Verify & sign off"}
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </Modal>
  );
}

function ItemRow({
  item,
  locked,
  expanded,
  onToggleExpand,
  onRespond,
  onPhotoChanged,
}: {
  item: RunItem;
  locked: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onRespond: (body: Record<string, unknown>) => Promise<void>;
  onPhotoChanged: () => void;
}) {
  const [note, setNote] = useState(item.note ?? "");
  const [value, setValue] = useState(item.value ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setNote(item.note ?? ""), [item.note]);
  useEffect(() => setValue(item.value ?? ""), [item.value]);

  const needsPhoto = item.photo_required && item.status !== "na" && item.photo_count === 0;
  const showDetail = expanded || item.status === "issue" || needsPhoto;
  const responseDisabled = locked || isSaving;

  async function save(body: Record<string, unknown>) {
    setIsSaving(true);
    try {
      await onRespond(body);
    } finally {
      setIsSaving(false);
    }
  }

  function saveReading() {
    if (value !== (item.value ?? "")) void save({ value });
  }

  function saveNote() {
    if (note !== (item.note ?? "")) void save({ note });
  }

  // Crossed off the list, the way the paper form was ticked through.
  const struck = item.status === "ok" || item.status === "na" || item.status === "done";

  return (
    <article
      id={`chk-${item.id}`}
      className={cn(
        "flex flex-col gap-3 border-b border-l-4 p-3 last:border-b-0 sm:p-4",
        ITEM_STRIPE[item.status],
        expanded && "bg-muted/40",
      )}
      aria-labelledby={`routine-item-${item.id}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4
                id={`routine-item-${item.id}`}
                className={cn(
                  "m-0 text-sm font-medium",
                  struck && "text-muted-foreground line-through",
                )}
              >
                {item.title}
              </h4>
              {item.asset_name ? <p className="mt-0.5 text-xs text-muted-foreground">{item.asset_name}</p> : null}
            </div>
            <ItemStatusBadge status={item.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {item.photo_required ? (
              <Badge variant={item.status === "na" ? "secondary" : needsPhoto ? "warning" : "success"}>
                <Camera data-icon="inline-start" />
                {item.status === "na"
                  ? "Photo waived"
                  : needsPhoto
                    ? "Photo required"
                    : `${item.photo_count} photo${item.photo_count === 1 ? "" : "s"}`}
              </Badge>
            ) : null}
            {item.ticket_number ? (
              <Badge variant="info">
                <TicketIcon data-icon="inline-start" /> Ticket #{item.ticket_number}
              </Badge>
            ) : null}
            {item.responded_by_name && item.status !== "pending" ? (
              <span className="text-xs text-muted-foreground">
                {item.responded_by_name} · {fmtTime(item.responded_at)}
              </span>
            ) : null}
            {isSaving ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><Spinner /> Saving…</span> : null}
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-72 lg:items-end">
          {item.response_type === "ok_issue" ? (
            <FieldSet className="w-full">
              <FieldLegend className="sr-only">Response for {item.title}</FieldLegend>
              <ToggleGroup
                aria-label={`Response for ${item.title}`}
                value={item.status === "ok" || item.status === "issue" || item.status === "na" ? [item.status] : []}
                disabled={responseDisabled}
                variant="outline"
                spacing={0}
                className="grid w-full grid-cols-3 lg:flex"
                onValueChange={(next) => {
                  const selected = next[0] as Extract<RunItemStatus, "ok" | "issue" | "na"> | undefined;
                  if (selected) void save({ status: selected });
                }}
              >
                {RESPONSE_CHOICES.map((choice) => {
                  const Icon = choice.icon;
                  return (
                    <ToggleGroupItem
                      key={choice.key}
                      value={choice.key}
                      aria-label={`${choice.label}: ${item.title}`}
                      className={cn(
                        "min-h-11 min-w-0 lg:min-h-9 lg:min-w-20",
                        // "Issue" reads as a problem: red outline always, solid
                        // red when it's the selected response.
                        choice.key === "issue" &&
                          "border-destructive/50 text-destructive data-[state=on]:border-destructive data-[state=on]:bg-destructive data-[state=on]:text-destructive-foreground",
                      )}
                    >
                      <Icon data-icon="inline-start" /> {choice.label}
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </FieldSet>
          ) : null}

          {item.response_type === "done" ? (
            <FieldSet className="w-full">
              <FieldLegend className="sr-only">Completion for {item.title}</FieldLegend>
              <ToggleGroup
                aria-label={`Completion for ${item.title}`}
                value={item.status === "done" ? ["done"] : []}
                disabled={responseDisabled}
                variant="outline"
                className="w-full"
                onValueChange={(next) => void save({ status: next.includes("done") ? "done" : "pending" })}
              >
                <ToggleGroupItem value="done" className="min-h-11 w-full lg:min-h-9 lg:w-auto lg:min-w-28">
                  <CheckCircle2 data-icon="inline-start" /> Done
                </ToggleGroupItem>
              </ToggleGroup>
            </FieldSet>
          ) : null}

          {item.response_type === "text" || item.response_type === "number" ? (
            <Field className="w-full lg:max-w-72">
              <FieldLabel htmlFor={`routine-reading-${item.id}`}>
                {item.response_type === "number" ? "Numeric reading" : "Reading"}
              </FieldLabel>
              <Input
                id={`routine-reading-${item.id}`}
                disabled={responseDisabled}
                type={item.response_type === "number" ? "number" : "text"}
                value={value}
                placeholder="Enter the observed value"
                onChange={(event) => setValue(event.target.value)}
                onBlur={saveReading}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </Field>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-9 w-full justify-between lg:w-auto"
            aria-expanded={showDetail}
            aria-controls={`routine-item-detail-${item.id}`}
            onClick={onToggleExpand}
          >
            {showDetail ? "Hide notes & photos" : "Notes & photos"}
            {showDetail ? <ChevronDown data-icon="inline-end" /> : <ChevronRight data-icon="inline-end" />}
          </Button>
        </div>
      </div>

      {showDetail ? (
        <div id={`routine-item-detail-${item.id}`} className="flex flex-col gap-3 bg-muted/40 p-3">
          <Field>
            <FieldLabel htmlFor={`routine-note-${item.id}`}>
              {item.status === "issue" ? "Issue details" : "Item note"}
            </FieldLabel>
            <Textarea
              id={`routine-note-${item.id}`}
              rows={3}
              disabled={responseDisabled}
              value={note}
              placeholder={item.status === "issue" ? "Describe what is wrong and what you observed." : "Add optional context for this checkpoint."}
              onChange={(event) => setNote(event.target.value)}
              onBlur={saveNote}
            />
          </Field>
          <Separator />
          <Attachments
            entityType="task_item"
            entityId={item.id}
            compact
            camera
            accept="image/*"
            capture="environment"
            heading={item.photo_required ? "Photo evidence" : "Photos"}
            label="+ From file"
            onChanged={onPhotoChanged}
          />
          {item.status === "issue" && !item.ticket_number ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>No ticket was raised</AlertTitle>
              <AlertDescription>This checkpoint is recorded as an issue but has no linked issue ticket.</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Compliance({ teams }: { teams: string[] }) {
  const [days, setDays] = useState(30);
  const [team, setTeam] = useState("");
  const query = useMemo(() => {
    const to = new Date();
    const from = new Date(Date.now() - (days - 1) * 86400000);
    const params = new URLSearchParams({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    if (team) params.set("team", team);
    return params.toString();
  }, [days, team]);
  const summary = useFetch<ComplianceSummary>(`/api/checklist-runs/summary?${query}`);
  const data = summary.data;

  if (summary.error && !data) return <ErrorState message={summary.error} onRetry={() => void summary.reload()} />;
  if (summary.loading && !data) return <Loading />;
  if (!data) return <ErrorState message="Compliance data was not returned." onRetry={() => void summary.reload()} />;

  return (
    <div className="flex flex-col gap-4">
      {summary.error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Compliance data could not be refreshed</AlertTitle>
          <AlertDescription>{summary.error}</AlertDescription>
          <AlertAction>
            <Button type="button" size="sm" variant="outline" onClick={() => void summary.reload()}>Retry</Button>
          </AlertAction>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Reporting period</CardTitle>
          <CardDescription>Verified completion, lateness, and recurring failures across routine checks.</CardDescription>
          <CardAction>
            <Button type="button" size="sm" variant="outline" disabled={summary.loading} onClick={() => void summary.reload()}>
              {summary.loading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
              Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="routine-compliance-period">Period</FieldLabel>
              <Select
                items={[
                  { value: "7", label: "Last 7 days" },
                  { value: "30", label: "Last 30 days" },
                  { value: "90", label: "Last 90 days" },
                ]}
                value={String(days)}
                onValueChange={(value) => setDays(Number(value ?? 30))}
              >
                <SelectTrigger id="routine-compliance-period" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="routine-compliance-team">Team</FieldLabel>
              <Select
                items={[
                  { value: null, label: "All teams" },
                  ...teams.map((value) => ({ value, label: titleCase(value) })),
                ]}
                value={team || null}
                onValueChange={(value) => setTeam(value ?? "")}
              >
                <SelectTrigger id="routine-compliance-team" className="w-full"><SelectValue placeholder="All teams" /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={null}>All teams</SelectItem>
                    {teams.map((value) => <SelectItem key={value} value={value}>{titleCase(value)}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <MetricGrid
        items={[
          { value: data.runs, label: "Rounds" },
          { value: `${data.completion_rate}%`, label: "Verified on record" },
          { value: data.late, label: "Late or missed" },
          { value: data.issues, label: "Issues found" },
        ]}
      />

      <Card className="py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>By checklist</CardTitle>
          <CardDescription>{fmtDate(data.from_date)} to {fmtDate(data.to_date)}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.by_template.length === 0 ? (
            <Empty icon={<CalendarDays />} message="No rounds in this period" hint="Try a longer period or a different team." />
          ) : (
            <>
              <div className="grid gap-3 p-3 md:hidden">
                {data.by_template.map((row) => (
                  <Card key={row.template_id} size="sm">
                    <CardHeader>
                      <CardTitle>{row.template_name}</CardTitle>
                      <CardDescription>{titleCase(row.team)} · {row.runs} rounds</CardDescription>
                      <CardAction>
                        <Badge variant={row.completion_rate === 100 ? "success" : "outline"}>
                          {row.completion_rate}%
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <Progress value={row.completion_rate} aria-label={`${row.completion_rate}% complete`} />
                      <dl className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <dt className="text-muted-foreground">Verified</dt>
                          <dd className="mt-0.5 font-medium tabular-nums">{row.verified}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Awaiting</dt>
                          <dd className="mt-0.5 font-medium tabular-nums">{row.submitted}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Open</dt>
                          <dd className="mt-0.5 font-medium tabular-nums">{row.open}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Issues / late</dt>
                          <dd className="mt-0.5 flex flex-wrap gap-1.5">
                            <Badge variant={row.issues > 0 ? "destructive" : "outline"}>{row.issues} issues</Badge>
                            <Badge variant={row.late > 0 ? "warning" : "outline"}>{row.late} late</Badge>
                          </dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Checklist</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Rounds</TableHead>
                      <TableHead>Verified</TableHead>
                      <TableHead>Awaiting</TableHead>
                      <TableHead>Open</TableHead>
                      <TableHead>Late</TableHead>
                      <TableHead>Issues</TableHead>
                      <TableHead className="min-w-40">Completion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.by_template.map((row) => (
                      <TableRow key={row.template_id}>
                        <TableCell className="font-medium">{row.template_name}</TableCell>
                        <TableCell>{titleCase(row.team)}</TableCell>
                        <TableCell className="tabular-nums">{row.runs}</TableCell>
                        <TableCell className="tabular-nums">{row.verified}</TableCell>
                        <TableCell className="tabular-nums">{row.submitted}</TableCell>
                        <TableCell className="tabular-nums">{row.open}</TableCell>
                        <TableCell>{row.late > 0 ? <Badge variant="destructive">{row.late}</Badge> : "—"}</TableCell>
                        <TableCell className="tabular-nums">{row.issues}</TableCell>
                        <TableCell>
                          <Progress value={row.completion_rate} aria-label={`${row.completion_rate}% complete`}>
                            <ProgressValue />
                          </Progress>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>Repeat offenders</CardTitle>
          <CardDescription>
            Checkpoints failing most often reveal recurring operational problems, not isolated misses.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.hotspots.length === 0 ? (
            <Empty icon={<CheckCircle2 />} message="No repeat issues" hint="No checkpoint issues were recorded in this period." />
          ) : (
            <>
              <div className="grid gap-3 p-3 md:hidden">
                {data.hotspots.map((hotspot) => (
                  <Card
                    key={`${hotspot.title}:${hotspot.section ?? ""}:${hotspot.asset_id ?? "no-asset"}`}
                    size="sm"
                  >
                    <CardHeader>
                      <CardTitle>{hotspot.title}</CardTitle>
                      <CardDescription>
                        {[hotspot.section, hotspot.asset_name].filter(Boolean).join(" · ") || "No location or asset"}
                      </CardDescription>
                      <CardAction><Badge variant="destructive">{hotspot.issue_count} times</Badge></CardAction>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      Last seen {fmtDate(hotspot.last_seen)}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Checkpoint</TableHead>
                      <TableHead>Where</TableHead>
                      <TableHead>Asset</TableHead>
                      <TableHead>Times</TableHead>
                      <TableHead>Last seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.hotspots.map((hotspot) => (
                      <TableRow key={`${hotspot.title}:${hotspot.section ?? ""}:${hotspot.asset_id ?? "no-asset"}`}>
                        <TableCell className="font-medium">{hotspot.title}</TableCell>
                        <TableCell>{hotspot.section ?? "—"}</TableCell>
                        <TableCell>{hotspot.asset_name ?? "—"}</TableCell>
                        <TableCell><Badge variant="destructive">{hotspot.issue_count}</Badge></TableCell>
                        <TableCell>{fmtDate(hotspot.last_seen)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
