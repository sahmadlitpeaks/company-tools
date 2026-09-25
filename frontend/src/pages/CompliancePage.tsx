import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Bell, CalendarClock, Check,
  ChevronRight, CircleCheck, FileCheck2, FileText, ListFilter, RefreshCw,
  Search, ShieldCheck, UsersRound, X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import {
  type ComplianceDashboard, type ComplianceDocument, type ComplianceOptions,
  type ComplianceTask, type OwnerRule, DOCUMENT_TYPES, documentTypeLabel, factValue,
} from "@/api/compliance";
import { formatDateTime, type SharePointDocument, type SharePointReminder, type SharePointStatus } from "@/api/sharepoint";
import { useAuth } from "@/auth/AuthContext";
import { useToast, PageHead } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type View = "overview" | "documents" | "tasks" | "review" | "governance";
type Metric = "expiring_60" | "expiring_30" | "due_this_week" | "overdue" | "needs_review" | "unassigned";
type Filter = { search: string; company: string; type: string; owner: string; department: string; status: string; from: string; to: string };
type FilterMode = "documents" | "tasks";
const emptyFilter: Filter = { search: "", company: "all", type: "all", owner: "all", department: "all", status: "all", from: "", to: "" };

const statusNames: Record<string, string> = {
  active: "Active", completed: "Completed", needs_review: "Needs review",
  pending: "Processing", superseded: "Replaced", failed: "Processing failed",
};
const reasonNames: Record<string, string> = {
  company: "Company not matched", owner: "Owner needed", action_date: "Action date unclear",
  document_type: "Document type unclear", notice_period: "Notice period unclear",
  reference_number: "Reference number unclear", issue_date: "Issue date unclear",
  effective_date: "Effective date unclear", expiry_date: "Expiry date unclear",
  renewal_date: "Renewal date unclear", termination_notice: "Termination notice unclear",
  required_actions: "Action details unclear", parties: "Parties could not be verified",
  obligations: "Document condition could not be verified",
};
const workflowErrors: Record<string, string> = {
  assignment_rule_already_exists: "A rule already covers this folder, company, and document type. Edit that rule instead.",
  department_has_no_active_member: "This department needs an active member with a work email before it can own tasks.",
  owner_not_active: "Choose an active person with a work email.",
  owner_unchanged: "Choose a different person or department.",
  task_not_active: "Only active tasks can be reassigned.",
  reviewer_required: "Only a compliance reviewer or administrator can change this owner.",
};

function workflowError(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback;
  return workflowErrors[cause.message] ?? cause.message;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

function isoDate(daysFromToday: number) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + daysFromToday);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function dueText(value: string) {
  const days = Math.round((new Date(`${value}T12:00:00`).getTime() - new Date(`${isoDate(0)}T12:00:00`).getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

type HistoryEvent = { id: string; action: string; at: string; details: Record<string, unknown> | null };

function historyPresentation(item: HistoryEvent, document: ComplianceDocument) {
  const details = item.details ?? {};
  const reasons = Array.isArray(details.reasons) ? details.reasons.filter((reason): reason is string => typeof reason === "string") : [];
  switch (item.action) {
    case "detected": return { title: "Found in SharePoint", description: "Document added to the compliance workflow.", tone: "text-muted-foreground", icon: FileText };
    case "company_matched": return { title: "Company matched", description: document.company || "Matched to a company in the group.", tone: "text-success", icon: CircleCheck };
    case "extracted": return { title: "Document analyzed", description: `${documentTypeLabel(String(details.document_type || document.document_type))} details extracted.`, tone: "text-success", icon: CircleCheck };
    case "task_created": return { title: "Action created", description: typeof details.due_date === "string" ? `Due ${formatDate(details.due_date)}.` : "An owned task was created.", tone: "text-success", icon: CircleCheck };
    case "task_reassigned": return { title: "Owner changed", description: `${String(details.from_owner_name || "Previous owner")} → ${String(details.to_owner_name || "New owner")}${details.changed_by ? ` by ${String(details.changed_by)}` : ""}.${details.note ? ` Reason: ${String(details.note)}` : ""}`, tone: "text-info", icon: UsersRound };
    case "task_reactivated": return { title: "Action reopened", description: "The task is active again.", tone: "text-warning", icon: CalendarClock };
    case "task_completed": return { title: "Action completed", description: "Future reminders stopped.", tone: "text-success", icon: CircleCheck };
    case "task_superseded": return { title: "Previous action replaced", description: "The earlier task is no longer active.", tone: "text-muted-foreground", icon: Check };
    case "needs_review": return { title: "Review required", description: reasons.length ? reasons.map((reason) => reasonNames[reason] ?? reason.replace(/_/g, " ")).join(" · ") : "Some details need verification.", tone: "text-warning", icon: AlertTriangle };
    case "reviewed": return { title: "Details verified", description: typeof details.note === "string" && details.note.trim() ? details.note : "A reviewer confirmed the document details.", tone: "text-success", icon: CircleCheck };
    case "processing_failed": return { title: "Analysis failed", description: "Processing needs another attempt.", tone: "text-destructive", icon: AlertTriangle };
    case "version_archived": return { title: "Previous version saved", description: "The earlier document version remains in the audit record.", tone: "text-muted-foreground", icon: FileText };
    case "source_updated": return { title: "SharePoint file updated", description: "A new source version was detected.", tone: "text-muted-foreground", icon: FileText };
    case "document_superseded": return { title: "Document renewed", description: "A verified replacement took its place.", tone: "text-success", icon: CircleCheck };
    case "reminder_sent": return { title: "Reminder sent", description: "The owner was notified.", tone: "text-success", icon: Bell };
    case "in_app_reminder": return { title: "In-app reminder created", description: "A reminder appeared in the workspace.", tone: "text-muted-foreground", icon: Bell };
    default: return { title: item.action.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()), description: "Recorded in the audit trail.", tone: "text-muted-foreground", icon: FileText };
  }
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "active" ? "success" : status === "completed" ? "secondary" : status === "needs_review" ? "warning" : status === "superseded" ? "outline" : "info";
  return <Badge variant={variant} className="text-xs">{statusNames[status] ?? status.replace(/_/g, " ")}</Badge>;
}

function Choice({ id, label, value, onChange, items }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  items: Array<{ value: string; label: string }>;
}) {
  return <Field className="min-w-0">
    <FieldLabel htmlFor={id} className="text-sm font-medium">{label}</FieldLabel>
    <Select items={items} value={value} onValueChange={(next) => onChange(next ?? "all")}>
      <SelectTrigger id={id} className="h-10 w-full bg-background px-3 text-sm md:text-sm"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{items.map((item) => <SelectItem className="py-2.5 text-sm" key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </Field>;
}

function Filters({ value, onChange, data, mode }: { value: Filter; onChange: (next: Filter) => void; data: ComplianceDashboard; mode: FilterMode }) {
  const [advanced, setAdvanced] = useState(Boolean(value.from || value.to || value.company !== "all" || value.type !== "all" || value.status !== "all"));
  const companies = [...new Map(data.documents.filter((doc) => doc.company_id).map((doc) => [doc.company_id, doc.company])).entries()];
  const owners = [...new Map(data.tasks.filter((task) => task.owner_user_id).map((task) => [task.owner_user_id, task.owner])).entries()];
  const departments = [...new Map(data.tasks.filter((task) => task.owner_department_id).map((task) => [task.owner_department_id, task.owner])).entries()];
  const set = (key: keyof Filter, next: string) => onChange({ ...value, [key]: next });
  const activeCount = Object.entries(value).filter(([key, current]) => key === "search" || key === "from" || key === "to" ? Boolean(current) : current !== "all").length;
  const statusItems = mode === "documents"
    ? ["active", "needs_review", "completed", "superseded", "pending"]
    : ["active", "completed", "superseded"];
  return <Card className="bg-muted/30">
    <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
      <div><CardTitle className="text-base">Find {mode === "documents" ? "documents" : "tasks"}</CardTitle><CardDescription className="mt-1 text-sm">Search first, then narrow the results when needed.</CardDescription></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="lg" className="bg-background text-sm" aria-expanded={advanced} aria-controls={`compliance-${mode}-advanced`} onClick={() => setAdvanced(!advanced)}><ListFilter data-icon="inline-start" />More filters{activeCount > 0 ? ` (${activeCount})` : ""}</Button>
        <Button variant="outline" size="lg" className="border-foreground/50 bg-background text-sm font-semibold text-foreground hover:bg-muted" disabled={activeCount === 0} onClick={() => onChange({ ...emptyFilter })}><X data-icon="inline-start" />Clear filters</Button>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <Field><FieldLabel htmlFor={`compliance-${mode}-search`} className="text-sm font-medium">Search {mode}</FieldLabel><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id={`compliance-${mode}-search`} className="h-10 bg-background pl-9 text-sm md:text-sm" placeholder={mode === "documents" ? "Name, reference, company or type" : "Action, document, owner or company"} value={value.search} onChange={(event) => set("search", event.target.value)} /></div></Field>
      {advanced && <FieldGroup id={`compliance-${mode}-advanced`} className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-3">
        <Choice id={`compliance-${mode}-company`} label="Company" value={value.company} onChange={(v) => set("company", v)} items={[{ value: "all", label: "All companies" }, ...companies.map(([id, name]) => ({ value: id!, label: name }))]} />
        <Choice id={`compliance-${mode}-type`} label="Document type" value={value.type} onChange={(v) => set("type", v)} items={[{ value: "all", label: "All document types" }, ...DOCUMENT_TYPES.map(([key, label]) => ({ value: key, label }))]} />
        <Choice id={`compliance-${mode}-status`} label="Status" value={value.status} onChange={(v) => set("status", v)} items={[{ value: "all", label: "All statuses" }, ...statusItems.map((key) => ({ value: key, label: statusNames[key] }))]} />
        {mode === "tasks" && <Choice id="compliance-task-owner" label="Owner" value={value.owner} onChange={(v) => set("owner", v)} items={[{ value: "all", label: "All owners" }, ...owners.map(([id, name]) => ({ value: id!, label: name }))]} />}
        {mode === "tasks" && <Choice id="compliance-task-department" label="Department" value={value.department} onChange={(v) => set("department", v)} items={[{ value: "all", label: "All departments" }, ...departments.map(([id, name]) => ({ value: id!, label: name }))]} />}
        <Field><FieldLabel htmlFor={`compliance-${mode}-from`} className="text-sm font-medium">{mode === "documents" ? "Expiry from" : "Due from"}</FieldLabel><Input className="h-10 bg-background text-sm md:text-sm" id={`compliance-${mode}-from`} type="date" value={value.from} onChange={(e) => set("from", e.target.value)} /></Field>
        <Field><FieldLabel htmlFor={`compliance-${mode}-to`} className="text-sm font-medium">{mode === "documents" ? "Expiry to" : "Due to"}</FieldLabel><Input className="h-10 bg-background text-sm md:text-sm" id={`compliance-${mode}-to`} type="date" value={value.to} onChange={(e) => set("to", e.target.value)} /></Field>
      </FieldGroup>}
      {activeCount > 0 && <p className="text-sm text-muted-foreground">{activeCount} filter{activeCount === 1 ? "" : "s"} applied</p>}
    </CardContent>
  </Card>;
}

function Overview({ data, onOpen, onView, onMetric }: {
  data: ComplianceDashboard; onOpen: (id: string) => void;
  onView: (view: View) => void; onMetric: (metric: Metric) => void;
}) {
  const metrics = [
    { key: "expiring_60", label: "Expiring in 60 days", count: data.summary.expiring_60, icon: CalendarClock, tone: "border-border" },
    { key: "expiring_30", label: "Expiring in 30 days", count: data.summary.expiring_30, icon: CalendarClock, tone: "border-border" },
    { key: "due_this_week", label: "Due this week", count: data.summary.due_this_week, icon: Bell, tone: "border-border" },
    { key: "overdue", label: "Overdue", count: data.summary.overdue, icon: AlertTriangle, tone: data.summary.overdue ? "border-destructive" : "border-border" },
    { key: "needs_review", label: "Needs review", count: data.summary.needs_review, icon: ShieldCheck, tone: data.summary.needs_review ? "border-warning" : "border-border" },
    { key: "unassigned", label: "Unassigned", count: data.summary.unassigned, icon: UsersRound, tone: "border-border" },
  ] as const;
  const review = data.documents.find((doc) => doc.status === "needs_review");
  const upcoming = data.tasks.filter((task) => task.status === "active").sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  const companies = Object.entries(data.summary.documents_by_company);
  const owners = Object.entries(data.summary.tasks_by_owner);
  return <div className="space-y-5">
    {review && <Card className="border-l-2 border-warning">
      <CardHeader className="gap-2 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><Badge variant="warning">Action needed</Badge><CardTitle className="mt-2 text-lg">A document is waiting for review</CardTitle><CardDescription className="mt-1 text-sm text-foreground/75">{review.name}</CardDescription></div>
        <Button className="w-full text-sm sm:w-auto" onClick={() => onView("review")}>Open review queue<ArrowRight data-icon="inline-end" /></Button>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">{review.review_reasons.map((reason) => <Badge key={reason} variant="outline" className="bg-background text-xs">{reasonNames[reason] ?? reason.replace(/_/g, " ")}</Badge>)}</CardContent>
    </Card>}
    <section aria-label="Compliance at a glance" className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">At a glance</h2><p className="text-sm text-muted-foreground">Select a number to see its records</p></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{metrics.map(({ key, label, count, icon: Icon, tone }) =>
        <Card key={key} className={`${tone} py-0`}><CardContent className="p-0"><Button variant="ghost" className="flex h-auto min-h-24 w-full flex-col items-start justify-between gap-2 p-4 text-left text-sm hover:bg-muted/40" onClick={() => onMetric(key)}>
          <span className="flex w-full items-center justify-between gap-2 font-medium"><span className="whitespace-normal">{label}</span><Icon data-icon="inline-end" aria-hidden="true" /></span>
          <span className="text-3xl font-semibold tabular-nums leading-none">{count}</span>
        </Button></CardContent></Card>)}</div>
    </section>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(17rem,1fr)]">
      <Card><CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Upcoming actions</CardTitle><CardDescription className="mt-1 text-sm">The next deadlines that need an owner’s attention</CardDescription></div><Button variant="outline" className="w-full bg-background sm:w-auto" onClick={() => onView("tasks")}>View tasks<ChevronRight data-icon="inline-end" /></Button></CardHeader><CardContent>
        {upcoming.length ? <div className="divide-y divide-border border-t border-border">{upcoming.map((task) => <div key={task.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-medium text-sm">{task.title}</p><p className="mt-1 text-sm text-muted-foreground">{task.company} · {task.owner}</p></div><div className="flex items-center justify-between gap-2 sm:justify-end"><Badge variant={task.due_date < isoDate(0) ? "destructive" : "warning"}>{dueText(task.due_date)}</Badge><Button variant="outline" size="sm" className="bg-background" onClick={() => onOpen(task.document_id)}>Details</Button></div></div>)}</div> : <Empty className="py-7"><EmptyHeader><EmptyTitle>No active tasks yet</EmptyTitle><EmptyDescription>{review ? "Verify the document above to create its owned actions." : "New SharePoint files will create tasks when their details are clear."}</EmptyDescription></EmptyHeader></Empty>}
      </CardContent></Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"><Card><CardHeader><CardTitle className="text-base">Documents by company</CardTitle></CardHeader><CardContent className="space-y-1">{companies.length ? companies.map(([name, count]) => <div key={name} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0"><span className="truncate">{name}</span><Badge variant="secondary">{count}</Badge></div>) : <p className="text-sm text-muted-foreground">No documents available.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Tasks by owner</CardTitle></CardHeader><CardContent className="space-y-1">{owners.length ? owners.map(([name, count]) => <div key={name} className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0"><span className="truncate">{name}</span><Badge variant="success">{count}</Badge></div>) : <p className="text-sm text-muted-foreground">Owners appear here when tasks are active.</p>}</CardContent></Card></div>
    </div>
  </div>;
}

function DocumentRegister({ documents, totalCount, onOpen }: { documents: ComplianceDocument[]; totalCount: number; onOpen: (id: string) => void }) {
  return <Card><CardHeader className="border-b border-border"><CardTitle className="text-base">Document register · {documents.length}</CardTitle><CardDescription className="text-sm">Files remain in SharePoint. Open a record for extracted details and its audit history.</CardDescription></CardHeader><CardContent>
    {!documents.length ? <Empty><EmptyHeader><EmptyTitle>{totalCount ? "No documents match" : "No documents yet"}</EmptyTitle><EmptyDescription>{totalCount ? "Try another search or change the filters." : "New files in the connected SharePoint folder will appear here automatically."}</EmptyDescription></EmptyHeader></Empty> : <>
      <div className="space-y-3 lg:hidden">{documents.map((doc) => <Card key={doc.id} size="sm" className="bg-muted/25"><CardContent className="space-y-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Button variant="link" className="h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left text-sm font-semibold" onClick={() => onOpen(doc.id)}>{doc.name}</Button><p className="mt-1 text-sm text-muted-foreground">{doc.company} · {documentTypeLabel(doc.document_type)}</p></div><StatusBadge status={doc.status} /></div><div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm"><span>Reference <strong>{doc.reference_number || "Not found"}</strong></span><span className="text-right">Expires <strong>{formatDate(doc.expiry_date)}</strong></span></div></CardContent></Card>)}</div>
      <TableSurface className="hidden lg:block"><Table className="table-fixed"><TableHeader><TableRow><TableHead className="w-[48%]">Document</TableHead><TableHead className="w-[17%]">Reference</TableHead><TableHead className="w-[19%]">Expiry</TableHead><TableHead className="w-[16%]">Status</TableHead></TableRow></TableHeader><TableBody>{documents.map((doc) => <TableRow key={doc.id}><TableCell className="whitespace-normal"><Button variant="link" className="h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left text-sm font-semibold" onClick={() => onOpen(doc.id)}>{doc.name}</Button><p className="mt-1 text-sm text-muted-foreground">{doc.company} · {documentTypeLabel(doc.document_type)}</p></TableCell><TableCell className="whitespace-normal text-sm">{doc.reference_number || "—"}</TableCell><TableCell className="whitespace-normal text-sm">{formatDate(doc.expiry_date)}</TableCell><TableCell><StatusBadge status={doc.status} /></TableCell></TableRow>)}</TableBody></Table></TableSurface>
    </>}
  </CardContent></Card>;
}

function TaskList({ tasks, totalCount, onOpen, onComplete, onAssign, canAssign, busy }: { tasks: ComplianceTask[]; totalCount: number; onOpen: (id: string) => void; onComplete: (id: string) => void; onAssign: (id: string) => void; canAssign: boolean; busy: string | null }) {
  const groups = [
    { title: "Overdue", description: "Act now or update the owner", tone: "border-destructive", items: tasks.filter((task) => task.status === "active" && task.due_date < isoDate(0)) },
    { title: "Due this week", description: "The next seven days", tone: "border-warning", items: tasks.filter((task) => task.status === "active" && task.due_date >= isoDate(0) && task.due_date <= isoDate(7)) },
    { title: "Coming up", description: "Actions beyond this week", tone: "border-border", items: tasks.filter((task) => task.status === "active" && task.due_date > isoDate(7)) },
    { title: "Closed", description: "Completed or replaced actions", tone: "border-border", items: tasks.filter((task) => task.status !== "active") },
  ];
  return <div className="space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Compliance tasks · {tasks.length}</h2><p className="text-sm text-muted-foreground">Grouped by urgency so the next action stays visible.</p></div></div>
    {!tasks.length ? <Card><CardContent><Empty><EmptyHeader><EmptyTitle>{totalCount ? "No tasks match" : "No compliance tasks yet"}</EmptyTitle><EmptyDescription>{totalCount ? "Try another search or change the filters." : "A verified document will create its required actions and reminders automatically."}</EmptyDescription></EmptyHeader></Empty></CardContent></Card> : groups.filter((group) => group.items.length).map((group) => <Card key={group.title} className="gap-0"><CardHeader className={`border-l-2 ${group.tone} py-3`}><CardTitle className="flex items-center justify-between gap-2 text-base"><span>{group.title}</span><Badge variant="outline" className="bg-background">{group.items.length}</Badge></CardTitle><CardDescription className="text-sm">{group.description}</CardDescription></CardHeader><CardContent className="divide-y divide-border">{group.items.sort((a, b) => a.due_date.localeCompare(b.due_date)).map((task) => <div key={task.id} className="flex flex-col gap-3 py-4 first:pt-3 last:pb-1 sm:flex-row sm:items-center">
      <div className="flex w-14 shrink-0 flex-col items-center border border-border bg-muted/40 py-1" aria-label={formatDate(task.due_date)}><span className="text-xs font-semibold uppercase">{new Date(`${task.due_date}T12:00:00`).toLocaleString("en", { month: "short" })}</span><strong className="text-lg tabular-nums">{task.due_date.slice(8, 10)}</strong></div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{task.title}</p>{task.status !== "active" && <StatusBadge status={task.status} />}</div><Button variant="link" className="mt-1 h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left text-sm" onClick={() => onOpen(task.document_id)}>{task.document_name}</Button><p className="mt-1 text-sm text-muted-foreground">{task.company || "Unclassified"} · Owner: {task.owner} · {dueText(task.due_date)}</p></div>
      {task.status === "active" && <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">{canAssign && <Button variant="outline" className="bg-background text-sm" onClick={() => onAssign(task.id)}>Change owner</Button>}<Button variant="outline" className="bg-background text-sm" disabled={busy === task.id} onClick={() => onComplete(task.id)}><Check data-icon="inline-start" />Complete</Button></div>}
    </div>)}</CardContent></Card>)}
  </div>;
}

function AssignDialog({ task, options, onClose, onSaved }: { task: ComplianceTask; options: ComplianceOptions; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState(task.owner_department_id ? "department" : "user");
  const [ownerId, setOwnerId] = useState(task.owner_department_id ?? task.owner_user_id ?? "none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { notify } = useToast();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (ownerId === "none") { setError("Choose a person or department."); return; }
    if (ownerId === (task.owner_user_id ?? task.owner_department_id)) { setError("Choose a different owner."); return; }
    setBusy(true); setError("");
    try {
      await api(`/api/sharepoint/compliance/tasks/${task.id}/assign`, { method: "POST", body: {
        owner_user_id: kind === "user" ? ownerId : null,
        owner_department_id: kind === "department" ? ownerId : null,
        note,
      } });
      notify("Task owner changed. Pending reminders now follow the new owner.");
      onSaved();
    } catch (cause) { setError(workflowError(cause, "Could not change owner")); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Change task owner</DialogTitle><DialogDescription>Assign {task.title} to a person or department. The reason and owner change are recorded in audit history.</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={(event) => void submit(event)}><p className="text-sm text-muted-foreground">Current owner: <strong className="text-foreground">{task.owner}</strong></p><FieldGroup className="grid gap-4 sm:grid-cols-2">
      <Choice id="assign-kind" label="Assign to" value={kind} onChange={(next) => { setKind(next); setOwnerId("none"); }} items={[{ value: "user", label: "Person" }, { value: "department", label: "Department" }]} />
      <Choice id="assign-owner" label="New owner" value={ownerId} onChange={setOwnerId} items={[{ value: "none", label: "Choose owner" }, ...(kind === "user" ? options.users : options.departments).map((item) => ({ value: item.id, label: item.name }))]} />
      <Field className="sm:col-span-2"><FieldLabel htmlFor="assign-note">Reason for change</FieldLabel><Textarea id="assign-note" required minLength={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why is this person or department responsible?" /></Field>
    </FieldGroup>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save owner"}</Button></div></form>
  </DialogContent></Dialog>;
}

function ReviewQueue({ documents, canReview, canRetry, onOpen, onReview, onRetry, busy }: {
  documents: ComplianceDocument[]; canReview: boolean; canRetry: boolean;
  onOpen: (id: string) => void; onReview: (id: string) => void;
  onRetry: (id: string) => void; busy: string | null;
}) {
  return <div className="space-y-4">
    <Card className="border-l-2 border-warning"><CardHeader><Badge variant="warning" className="mb-1">Human check</Badge><CardTitle className="text-xl">Needs review · {documents.length}</CardTitle><CardDescription className="max-w-2xl text-sm">The system found information it could not verify. Check the SharePoint original, correct the details, and confirm the owner before reminders start.</CardDescription></CardHeader></Card>
    {!documents.length ? <Card><CardContent><Empty><EmptyHeader><EmptyTitle>Review queue is clear</EmptyTitle><EmptyDescription>Uncertain documents will appear here automatically.</EmptyDescription></EmptyHeader></Empty></CardContent></Card> : <div className="grid gap-3">{documents.map((doc) => <Card key={doc.id} className="border-l-2 border-warning"><CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 space-y-3"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={doc.status} /><span className="text-sm text-muted-foreground">{documentTypeLabel(doc.document_type)}</span></div><h3 className="break-words text-base font-semibold">{doc.name}</h3><div className="flex flex-wrap gap-2">{doc.review_reasons.length ? doc.review_reasons.map((reason) => <Badge key={reason} variant="warning">{reasonNames[reason] ?? reason.replace(/_/g, " ")}</Badge>) : <Badge variant="warning">Processing needs attention</Badge>}</div><p className="text-sm text-muted-foreground">Reference: {doc.reference_number || "Not found"} · Expiry: {formatDate(doc.expiry_date)}</p></div><div className="flex shrink-0 gap-2"><Button variant="outline" className="bg-background text-sm" onClick={() => onOpen(doc.id)}>Details</Button>{doc.processing_status === "failed" ? canRetry && <Button className="text-sm" disabled={busy === doc.id} onClick={() => onRetry(doc.id)}>Retry processing</Button> : canReview && <Button className="text-sm" onClick={() => onReview(doc.id)}>Verify<ArrowRight data-icon="inline-end" /></Button>}</div></CardContent></Card>)}</div>}
  </div>;
}

function DetailDialog({ document, onClose }: { document: ComplianceDocument; onClose: () => void }) {
  const detail = useFetch<SharePointDocument>(`/api/sharepoint/documents/${document.id}`);
  const history = useFetch<{ versions: Array<{ source_version: string; modified_at: string | null; status: string }>; events: Array<{ id: string; action: string; at: string; details: Record<string, unknown> | null }> }>(`/api/sharepoint/compliance/documents/${document.id}/history`);
  const facts = detail.data?.compliance ?? detail.data?.analysis?.sections?.[0]?.compliance;
  const fields = [
    ["Company", document.company_id ? document.company : factValue(facts?.company) || "Unclassified"],
    ["Document type", documentTypeLabel(document.document_type)],
    ["Reference", factValue(facts?.reference_number) || document.reference_number || "Not found"],
    ["Expiry", formatDate(factValue(facts?.expiry_date) || document.expiry_date)],
    ["Renewal", formatDate(factValue(facts?.renewal_date) || document.renewal_date)],
    ["Termination notice", facts?.termination_notice?.days ? `${facts.termination_notice.days} days` : "Not stated"],
  ];
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><div className="mb-2"><StatusBadge status={document.status} /></div><DialogTitle className="break-words text-lg">{document.name}</DialogTitle><DialogDescription className="text-sm">Extracted information, original source, and audit history</DialogDescription></DialogHeader>
    {detail.loading ? <Skeleton className="h-48 w-full" /> : detail.error ? <Alert variant="destructive"><AlertDescription>{detail.error}</AlertDescription></Alert> : <div className="space-y-5">
      <Card className="bg-muted/30"><CardHeader><CardTitle className="text-base">Document facts</CardTitle></CardHeader><CardContent><dl className="grid gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0 border-t border-border pt-2"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm font-semibold">{value}</dd></div>)}</dl></CardContent></Card>
      {facts?.obligations?.length ? <Card><CardHeader><CardTitle className="text-base">Requirements in this document</CardTitle><CardDescription>Conditions stated in the source that may affect compliance.</CardDescription></CardHeader><CardContent><ul className="list-disc space-y-2 ps-5 text-sm">{[...new Set(facts.obligations.map((item) => item.value))].map((value) => <li key={value}>{value}</li>)}</ul></CardContent></Card> : null}
      <div className="flex flex-col gap-3 border-y border-border py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="text-muted-foreground">Uploaded by {document.uploaded_by_email || "an unknown user"}{document.uploaded_at ? ` · ${new Date(document.uploaded_at).toLocaleString()}` : ""}</p>{document.url && <Button variant="outline" nativeButton={false} className="bg-background text-sm" render={<a aria-label="Open original in SharePoint" href={document.url} target="_blank" rel="noreferrer" />}>Open in SharePoint<ArrowUpRight data-icon="inline-end" /></Button>}</div>
      <section className="space-y-3"><h3 className="text-base font-semibold">Audit history</h3>{history.loading ? <Skeleton className="h-20" /> : history.error ? <Alert variant="destructive"><AlertDescription>{history.error}</AlertDescription></Alert> : history.data?.events.length ? <ol className="border border-border bg-card">{history.data.events.map((item, index) => {
        const presentation = historyPresentation(item, document);
        const Icon = presentation.icon;
        const at = new Date(item.at);
        return <li key={item.id} className="relative flex gap-3 px-4 py-3.5 text-sm [&+li]:border-t [&+li]:border-border/70">
          <span className={`relative z-10 flex size-7 shrink-0 items-center justify-center border border-current bg-background ${presentation.tone}`}><Icon className="size-4" aria-hidden="true" /></span>
          {index < history.data!.events.length - 1 && <span className="absolute bottom-0 left-[29px] top-10 w-px bg-border" aria-hidden="true" />}
          <div className="min-w-0 flex-1 sm:flex sm:items-start sm:justify-between sm:gap-4"><div><p className="font-semibold text-foreground">{presentation.title}</p><p className="mt-0.5 break-words text-muted-foreground">{presentation.description}</p></div><time dateTime={item.at} className="mt-1 block shrink-0 text-xs text-muted-foreground sm:mt-0">{Number.isNaN(at.getTime()) ? item.at : new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(at)}</time></div>
        </li>;
      })}</ol> : <p className="text-sm text-muted-foreground">No recorded actions yet.</p>}</section>
      {history.data?.versions.length ? <section className="space-y-3"><h3 className="text-base font-semibold">Previous versions</h3><ul className="divide-y divide-border border border-border">{history.data.versions.map((item) => <li key={item.source_version} className="flex items-center justify-between gap-3 p-3 text-sm"><span>{formatDateTime(item.modified_at || item.source_version)}</span><StatusBadge status={item.status} /></li>)}</ul></section> : null}
    </div>}
  </DialogContent></Dialog>;
}

function ReviewDialog({ document, options, onClose, onSaved }: { document: ComplianceDocument; options: ComplianceOptions; onClose: () => void; onSaved: () => void }) {
  const detail = useFetch<SharePointDocument>(`/api/sharepoint/documents/${document.id}`);
  const facts = detail.data?.compliance ?? detail.data?.analysis?.sections?.[0]?.compliance;
  const [companyId, setCompanyId] = useState(document.company_id ?? "none");
  const [documentType, setDocumentType] = useState(document.document_type === "unknown" ? "none" : document.document_type);
  const [reference, setReference] = useState(document.reference_number ?? "");
  const [expiry, setExpiry] = useState(document.expiry_date ?? "");
  const [renewal, setRenewal] = useState(document.renewal_date ?? "");
  const [notice, setNotice] = useState(document.notice_days ? String(document.notice_days) : "");
  const [ownerKind, setOwnerKind] = useState("user");
  const [ownerId, setOwnerId] = useState("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { notify } = useToast();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (companyId === "none") { setError("Choose a company before creating tasks."); return; }
    if (documentType === "none") { setError("Choose the correct document type."); return; }
    setBusy(true); setError("");
    try {
      await api(`/api/sharepoint/compliance/documents/${document.id}/review`, { method: "POST", body: {
        company_id: companyId, document_type: documentType,
        reference_number: reference || null, expiry_date: expiry || null,
        renewal_date: renewal || null, termination_notice_days: notice ? Number(notice) : null,
        owner_user_id: ownerKind === "user" && ownerId !== "none" ? ownerId : null,
        owner_department_id: ownerKind === "department" && ownerId !== "none" ? ownerId : null,
        review_note: note,
      } });
      notify("Document verified and tasks created."); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review failed"); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><Badge variant="warning" className="mb-2">Verification required</Badge><DialogTitle className="break-words text-lg">Review {document.name}</DialogTitle><DialogDescription className="text-sm">Confirm the facts against the SharePoint original. Your changes enter the audit history.</DialogDescription></DialogHeader>
    <Alert className="border-warning/40 bg-warning/10"><AlertTriangle className="size-4" /><AlertDescription className="text-sm">Check: {document.review_reasons.map((reason) => reasonNames[reason] ?? reason.replace(/_/g, " ")).join(", ") || "uncertain extraction"}.</AlertDescription></Alert>
    {!document.company_id && factValue(facts?.company) && <Alert><AlertDescription className="text-sm">The file names <strong>{factValue(facts?.company)}</strong>, but this company is not in the registry. <Link className="font-semibold underline" to="/companies">Add it in Companies</Link>, then return to verify this record.</AlertDescription></Alert>}
    {detail.loading ? <Skeleton className="h-24" /> : detail.error ? <Alert variant="destructive"><AlertDescription>{detail.error}</AlertDescription></Alert> : <form onSubmit={(event) => void submit(event)} className="space-y-5">
      {document.url && <Button variant="outline" nativeButton={false} className="bg-background text-sm" render={<a aria-label="Check original in SharePoint" href={document.url} target="_blank" rel="noreferrer" />}>Check original in SharePoint<ArrowUpRight data-icon="inline-end" /></Button>}
      <section className="space-y-3"><div><h3 className="text-base font-semibold">Document details</h3><p className="text-sm text-muted-foreground">Correct the extracted values before an action is created.</p></div><FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Choice id="review-company" label="Company" value={companyId} onChange={setCompanyId} items={[{ value: "none", label: "Choose company" }, ...options.companies.map((item) => ({ value: item.id, label: item.name }))]} />
        <Choice id="review-type" label="Document type" value={documentType} onChange={setDocumentType} items={[{ value: "none", label: "Choose document type" }, ...DOCUMENT_TYPES.map(([value, label]) => ({ value, label }))]} />
        <Field><FieldLabel htmlFor="review-reference" className="text-sm">Reference number</FieldLabel><Input className="h-10 text-sm md:text-sm" id="review-reference" value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="review-expiry" className="text-sm">Expiry date</FieldLabel><Input className="h-10 text-sm md:text-sm" id="review-expiry" type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="review-renewal" className="text-sm">Renewal date</FieldLabel><Input className="h-10 text-sm md:text-sm" id="review-renewal" type="date" value={renewal} onChange={(event) => setRenewal(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="review-notice" className="text-sm">Termination notice days</FieldLabel><Input className="h-10 text-sm md:text-sm" id="review-notice" type="number" min="1" max="730" value={notice} onChange={(event) => setNotice(event.target.value)} /></Field>
      </FieldGroup>{facts?.termination_notice?.days && <p className="text-sm text-muted-foreground">AI found a {facts.termination_notice.days}-day notice period. Confirm it against the contract.</p>}</section>
      <section className="space-y-3 border-t border-border pt-4"><div><h3 className="text-base font-semibold">Ownership and review</h3><p className="text-sm text-muted-foreground">Choose an owner, or use the configured assignment rules and fallback.</p></div><FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Choice id="review-owner-kind" label="Assign to" value={ownerKind} onChange={(next) => { setOwnerKind(next); setOwnerId("none"); }} items={[{ value: "user", label: "Person" }, { value: "department", label: "Department" }]} /><Choice id="review-owner" label="Owner" value={ownerId} onChange={setOwnerId} items={[{ value: "none", label: "Use assignment rule" }, ...(ownerKind === "user" ? options.users : options.departments).map((item) => ({ value: item.id, label: item.name }))]} /><Field className="sm:col-span-2"><FieldLabel htmlFor="review-note" className="text-sm">Review note</FieldLabel><Textarea className="min-h-24 text-sm md:text-sm" id="review-note" placeholder="What did you verify in the original document?" required minLength={3} value={note} onChange={(event) => setNote(event.target.value)} /></Field></FieldGroup></section>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end"><Button type="button" variant="outline" className="text-sm" onClick={onClose}>Cancel</Button><Button type="submit" className="text-sm" disabled={busy}>{busy ? "Saving…" : "Verify and create tasks"}</Button></div>
    </form>}
  </DialogContent></Dialog>;
}

function Governance({ options, status, onReload }: { options: ComplianceOptions; status: SharePointStatus; onReload: () => void }) {
  const formRef = useRef<HTMLDivElement>(null);
  const rules = useFetch<OwnerRule[]>("/api/sharepoint/compliance/rules");
  const reminders = useFetch<SharePointReminder[]>("/api/sharepoint/reminders?category=compliance_task");
  const [company, setCompany] = useState("all");
  const [type, setType] = useState("all");
  const [folder, setFolder] = useState("");
  const [ownerKind, setOwnerKind] = useState("user");
  const [owner, setOwner] = useState("none");
  const [priority, setPriority] = useState(100);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [leads, setLeads] = useState("60, 30, 28, 21, 14, 7, 6, 5, 4, 3, 2, 1, 0, -1");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const { notify } = useToast();
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (owner === "none") { setError("Choose an owner."); return; }
    if (folder.includes("/") || folder.includes("\\")) { setError("Enter a single folder name, such as Finance or Admin."); return; }
    const schedule = leads.split(",").map((item) => Number(item.trim()));
    if (!leads.trim() || schedule.length > 100 || schedule.some((value) => !Number.isInteger(value) || value < -365 || value > 730) || new Set(schedule).size !== schedule.length) {
      setError("Enter unique whole numbers from -365 to 730, separated by commas."); return;
    }
    setBusy(true); setError("");
    try {
      await api(editingId ? `/api/sharepoint/compliance/rules/${editingId}` : "/api/sharepoint/compliance/rules", { method: editingId ? "PUT" : "POST", body: {
        company_id: company === "all" ? null : company,
        document_type: type === "all" ? null : type,
        folder_name: folder.trim() || null,
        owner_user_id: ownerKind === "user" ? owner : null,
        owner_department_id: ownerKind === "department" ? owner : null,
        reminder_leads: schedule, priority,
      } });
      notify(editingId ? "Assignment rule updated." : "Assignment rule added.");
      resetForm(); void rules.reload(); onReload();
    } catch (cause) { setError(workflowError(cause, "Could not save rule")); }
    finally { setBusy(false); }
  }
  function resetForm() {
    setEditingId(null); setCompany("all"); setType("all"); setFolder("");
    setOwnerKind("user"); setOwner("none"); setPriority(100);
    setLeads("60, 30, 28, 21, 14, 7, 6, 5, 4, 3, 2, 1, 0, -1"); setError("");
  }
  function editRule(rule: OwnerRule) {
    setEditingId(rule.id); setCompany(rule.company_id ?? "all"); setType(rule.document_type ?? "all");
    setFolder(rule.folder_name ?? ""); setOwnerKind(rule.owner_department_id ? "department" : "user");
    setOwner(rule.owner_department_id ?? rule.owner_user_id ?? "none"); setPriority(rule.priority);
    setLeads(rule.reminder_leads.join(", ")); setError("");
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("rule-folder")?.focus({ preventScroll: true });
    });
  }
  async function remove(id: string) {
    setBusy(true);
    try { await api(`/api/sharepoint/compliance/rules/${id}`, { method: "DELETE" }); notify("Rule removed."); setRemoveId(null); if (editingId === id) resetForm(); void rules.reload(); onReload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove rule"); }
    finally { setBusy(false); }
  }
  const name = (items: ComplianceOptions[keyof ComplianceOptions], id: string | null) => id ? items.find((item) => item.id === id)?.name ?? "Unknown" : "Any";
  const activity = [...(reminders.data ?? [])].filter((item) => item.status === "sent" || item.status === "failed")
    .sort((a, b) => (b.sent_at ?? b.reminder_date).localeCompare(a.sent_at ?? a.reminder_date)).slice(0, 5);
  return <div className="space-y-4">
    <h1 className="sr-only">Compliance governance</h1>
    <Card><CardHeader><Badge variant="outline" className="mb-1">Administrator settings</Badge><CardTitle className="text-xl">Ownership and reminders</CardTitle><CardDescription className="max-w-2xl text-sm">Route documents by SharePoint folder, company, and document type. Finance and Admin folders use their matching active departments by default. A folder rule overrides that default. Existing tasks keep their owner until changed in Tasks.</CardDescription></CardHeader></Card>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(19rem,1fr)]"><Card><CardHeader><CardTitle className="text-base">Assignment rules · {rules.data?.length ?? 0}</CardTitle><CardDescription className="text-sm">Rules determine future task ownership.</CardDescription></CardHeader><CardContent className="space-y-3">
      {rules.error && <Alert variant="destructive"><AlertDescription>{rules.error}</AlertDescription></Alert>}
      {rules.loading && !rules.data ? <Skeleton className="h-24" /> : rules.data?.length ? rules.data.map((rule) => <Card key={rule.id} size="sm" className="bg-muted/30"><CardContent className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold">{rule.folder_name ? `${rule.folder_name} folder · ` : ""}{name(options.companies, rule.company_id)} · {rule.document_type ? documentTypeLabel(rule.document_type) : "Any document type"}</p><p className="mt-1 text-sm text-muted-foreground">Assigned to {name(rule.owner_user_id ? options.users : options.departments, rule.owner_user_id ?? rule.owner_department_id)}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => editRule(rule)}>Edit</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => setRemoveId(rule.id)}>Remove</Button></div></div><div className="flex flex-wrap gap-1 border-t border-border pt-3"><Badge variant="outline" className="bg-background">{rule.reminder_leads.length} reminder stages</Badge><span className="text-sm text-muted-foreground">{rule.reminder_leads.join(", ")} days</span></div></CardContent></Card>) : <Empty><EmptyHeader><EmptyTitle>No rules configured</EmptyTitle><EmptyDescription>Create a rule to route future documents to the right person or department.</EmptyDescription></EmptyHeader></Empty>}
    </CardContent></Card>
    <Card ref={formRef}><CardHeader><CardTitle className="text-base">{editingId ? "Edit assignment rule" : "Add an assignment rule"}</CardTitle><CardDescription className="text-sm">Choose a SharePoint folder, company, or document type, then the responsible person or department.</CardDescription></CardHeader><CardContent><form onSubmit={(event) => void save(event)} className="space-y-5"><FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Choice id="rule-company" label="Company" value={company} onChange={setCompany} items={[{ value: "all", label: "Any company" }, ...options.companies.map((item) => ({ value: item.id, label: item.name }))]} />
      <Choice id="rule-type" label="Document type" value={type} onChange={setType} items={[{ value: "all", label: "Any document type" }, ...DOCUMENT_TYPES.map(([value, label]) => ({ value, label }))]} />
      <Field className="sm:col-span-2"><FieldLabel htmlFor="rule-folder">SharePoint folder name</FieldLabel><Input id="rule-folder" className="h-10 text-sm md:text-sm" placeholder="Finance or Admin (optional)" value={folder} onChange={(event) => setFolder(event.target.value)} /><p className="mt-1 text-sm text-muted-foreground">Match a folder in the document path. Leave blank to apply across folders.</p></Field>
      <Choice id="rule-owner-kind" label="Assign to" value={ownerKind} onChange={(next) => { setOwnerKind(next); setOwner("none"); }} items={[{ value: "user", label: "Person" }, { value: "department", label: "Department" }]} />
      <Choice id="rule-owner" label="Responsible owner" value={owner} onChange={setOwner} items={[{ value: "none", label: "Choose owner" }, ...(ownerKind === "user" ? options.users : options.departments).map((item) => ({ value: item.id, label: item.name }))]} />
      <Field><FieldLabel htmlFor="rule-priority">Priority</FieldLabel><Input id="rule-priority" className="h-10 text-sm md:text-sm" type="number" min="0" max="1000" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /><p className="mt-1 text-sm text-muted-foreground">Lower number wins when scopes are equally specific.</p></Field>
      <Field className="sm:col-span-2"><FieldLabel htmlFor="rule-leads" className="text-sm">Reminder days before the due date</FieldLabel><Input className="h-10 text-sm md:text-sm" id="rule-leads" value={leads} onChange={(event) => setLeads(event.target.value)} /><p className="mt-1 text-sm text-muted-foreground">Comma-separated days. Use 0 for the due date and -1 for manager escalation one day overdue.</p></Field>
    </FieldGroup>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<div className="flex gap-2"><Button className="text-sm" disabled={busy} type="submit">{busy ? "Saving…" : editingId ? "Save changes" : "Add rule"}</Button>{editingId && <Button type="button" variant="outline" onClick={resetForm}>Cancel edit</Button>}</div></form></CardContent></Card></div>
    <Card><CardHeader><CardTitle className="text-base">Reminder delivery</CardTitle><CardDescription className="text-sm">Configuration and recorded results for compliance task reminders on documents you can access. Uploading a file schedules future reminders; it does not send them immediately.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2"><Badge variant={status.teams_configured ? "success" : "warning"}>Teams {status.teams_configured ? "configured" : "off"}</Badge><Badge variant={status.email_configured ? "success" : "secondary"}>Email {status.email_configured ? "configured" : "off"}</Badge><Badge variant={status.scheduler_enabled ? "success" : "warning"}>Scheduler {status.scheduler_enabled ? "on" : "off"}</Badge></div>
      {reminders.loading && !reminders.data ? <Skeleton className="h-20" /> : reminders.error ? <Alert variant="destructive"><AlertDescription>{reminders.error} <Button variant="link" onClick={() => void reminders.reload()}>Retry</Button></AlertDescription></Alert> : <>
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground"><span>{reminders.data?.filter((item) => item.status === "sent").length ?? 0} sent stages</span><span>{reminders.data?.filter((item) => item.status === "pending" && item.reminder_date <= isoDate(0)).length ?? 0} due now</span><span>{reminders.data?.filter((item) => item.status === "failed").length ?? 0} failed</span></div>
        {activity.length ? <div className="divide-y divide-border border-t border-border">{activity.map((item) => <div key={item.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title} · {item.document_name}</p><p className="text-xs text-muted-foreground">{item.recipient_email || "No recipient"} · {item.sent_at ? formatDateTime(item.sent_at) : formatDate(item.reminder_date)}</p>{item.status === "failed" && item.last_error && <p className="text-xs text-destructive">{item.last_error}</p>}</div><Badge variant={item.status === "sent" ? "success" : "destructive"}>{item.status === "sent" ? item.delivery_channels?.length ? `Sent via ${item.delivery_channels.join(" + ")}` : "Sent · channel not recorded" : "Failed"}</Badge></div>)}</div> : <p className="text-sm text-muted-foreground">No sent or failed compliance task reminders are recorded in the visible history.</p>}
        {(reminders.data?.length ?? 0) >= 150 && <p className="text-xs text-muted-foreground">Showing the first 150 accessible reminder stages. Open Alerts for the full filtered list.</p>}
      </>}
    </CardContent></Card>
    <AlertDialog open={removeId !== null} onOpenChange={(open) => { if (!open) setRemoveId(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">Remove this assignment rule?</AlertDialogTitle><AlertDialogDescription className="text-sm">Future documents will use another matching rule or the fallback owner. Existing tasks keep their current owner.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => { if (removeId) void remove(removeId); }}>Remove rule</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

export default function CompliancePage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [view, setView] = useState<View>("overview");
  const [documentFilter, setDocumentFilter] = useState<Filter>({ ...emptyFilter });
  const [taskFilter, setTaskFilter] = useState<Filter>({ ...emptyFilter });
  const [selected, setSelected] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const status = useFetch<SharePointStatus>("/api/sharepoint/status");
  const dashboard = useFetch<ComplianceDashboard>(status.data?.connected ? "/api/sharepoint/compliance/dashboard" : null);
  const canReview = Boolean(user?.is_admin || status.data?.can_review);
  const options = useFetch<ComplianceOptions>(status.data?.connected && canReview ? "/api/sharepoint/compliance/options" : null);
  const data = dashboard.data;
  const filteredDocuments = useMemo(() => data?.documents.filter((doc) => {
    const query = documentFilter.search.trim().toLowerCase();
    if (query && ![doc.name, doc.company, documentTypeLabel(doc.document_type), doc.reference_number || ""].some((value) => value.toLowerCase().includes(query))) return false;
    if (documentFilter.company !== "all" && doc.company_id !== documentFilter.company) return false;
    if (documentFilter.type !== "all" && doc.document_type !== documentFilter.type) return false;
    if (documentFilter.status !== "all" && doc.status !== documentFilter.status) return false;
    if (documentFilter.from && (!doc.expiry_date || doc.expiry_date < documentFilter.from)) return false;
    if (documentFilter.to && (!doc.expiry_date || doc.expiry_date > documentFilter.to)) return false;
    return true;
  }) ?? [], [data, documentFilter]);
  const filteredTasks = useMemo(() => data?.tasks.filter((task) => {
    const query = taskFilter.search.trim().toLowerCase();
    if (query && ![task.title, task.document_name, task.owner, task.company || ""].some((value) => value.toLowerCase().includes(query))) return false;
    if (taskFilter.company !== "all" && !data.documents.some((doc) => doc.id === task.document_id && doc.company_id === taskFilter.company)) return false;
    if (taskFilter.type !== "all" && task.document_type !== taskFilter.type) return false;
    if (taskFilter.owner !== "all" && task.owner_user_id !== taskFilter.owner) return false;
    if (taskFilter.department !== "all" && task.owner_department_id !== taskFilter.department) return false;
    if (taskFilter.status !== "all" && task.status !== taskFilter.status) return false;
    if (taskFilter.from && task.due_date < taskFilter.from) return false;
    if (taskFilter.to && task.due_date > taskFilter.to) return false;
    return true;
  }) ?? [], [data, taskFilter]);
  const selectedDoc = data?.documents.find((doc) => doc.id === selected);
  const reviewDoc = data?.documents.find((doc) => doc.id === reviewing);
  const assignTask = data?.tasks.find((task) => task.id === assigning);
  function openMetric(metric: Metric) {
    if (metric === "needs_review" || metric === "unassigned") { setView("review"); return; }
    if (metric === "expiring_60" || metric === "expiring_30") {
      setDocumentFilter({ ...emptyFilter, from: isoDate(0), to: isoDate(metric === "expiring_60" ? 60 : 30) });
      setView("documents");
      return;
    }
    setTaskFilter({ ...emptyFilter, ...(metric === "overdue" ? { to: isoDate(-1) } : { from: isoDate(0), to: isoDate(7) }), status: "active" });
    setView("tasks");
  }
  async function complete(taskId: string) {
    setBusy(taskId);
    try { await api(`/api/sharepoint/compliance/tasks/${taskId}`, { method: "PATCH", body: { status: "completed" } }); notify("Task completed; future reminders stopped."); void dashboard.reload(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not complete task", "error"); }
    finally { setBusy(null); }
  }
  async function sync() {
    setBusy("sync");
    try { await api("/api/sharepoint/sync", { method: "POST" }); notify("SharePoint sync queued."); void status.reload(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not sync", "error"); }
    finally { setBusy(null); }
  }
  async function retry(documentId: string) {
    setBusy(documentId);
    try { await api(`/api/sharepoint/documents/${documentId}/retry`, { method: "POST" }); notify("Document retry queued."); void dashboard.reload(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not retry document", "error"); }
    finally { setBusy(null); }
  }
  return <div className="space-y-5"><PageHead title="Document Compliance" subtitle="Know what expires, who owns it, and what needs your review." action={<div className="flex flex-wrap gap-2">{user?.is_admin && <Button variant="outline" className="bg-background text-sm" disabled={busy === "sync"} onClick={() => void sync()}><RefreshCw data-icon="inline-start" />Sync now</Button>}<Button nativeButton={false} variant="secondary" className="border border-border text-sm" render={<Link to="/sharepoint/assistant" />}><Bell data-icon="inline-start" />Ask the assistant</Button></div>} />
    {status.loading && !status.data ? <Skeleton className="h-40" /> : status.error ? <Alert variant="destructive"><AlertDescription>{status.error}</AlertDescription></Alert> : !status.data?.enabled || !status.data.configured ? <Alert><AlertDescription>SharePoint must be configured by an administrator before compliance processing can begin.</AlertDescription></Alert> : !status.data.connected ? <Card><CardHeader><CardTitle className="text-lg">Connect Microsoft 365</CardTitle><CardDescription className="text-sm">Connect your work account to see only the documents you can access in SharePoint.</CardDescription></CardHeader><CardContent><Button nativeButton={false} className="text-sm" render={<a aria-label="Connect Microsoft" href="/api/sharepoint/connect" />}>Connect Microsoft<ArrowRight data-icon="inline-end" /></Button></CardContent></Card> : <>
      <Card className="py-3"><CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="flex items-start gap-2 text-sm sm:items-center"><CircleCheck className="mt-0.5 size-4 shrink-0 text-success sm:mt-0" aria-hidden="true" /><span><strong>Connected to SharePoint.</strong> New files are analyzed automatically; originals stay in SharePoint.</span></p><Badge variant="success" className="self-start sm:self-auto">{status.data.active_run ? "Sync in progress" : "Automatic sync on"}</Badge></CardContent></Card>
      {dashboard.loading && !data ? <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div> : dashboard.error ? <Alert variant="destructive"><AlertDescription>{dashboard.error} <Button variant="link" onClick={() => void dashboard.reload()}>Retry</Button></AlertDescription></Alert> : data && <Tabs value={view} onValueChange={(next) => setView(next as View)} className="min-w-0">
        <div className="sm:hidden"><Choice id="compliance-view" label="Browse compliance" value={view} onChange={(next) => setView(next as View)} items={[{ value: "overview", label: "Overview" }, { value: "documents", label: "Documents" }, { value: "tasks", label: "Tasks" }, { value: "review", label: data.summary.needs_review ? `Review (${data.summary.needs_review})` : "Review" }, ...(user?.is_admin ? [{ value: "governance", label: "Governance" }] : [])]} /></div>
        <TabsList variant="line" className="hidden group-data-horizontal/tabs:h-12 w-full justify-start gap-4 border-b border-border px-0 py-0 sm:flex" aria-label="Compliance views"><TabsTrigger className="h-9 flex-none px-1 text-sm font-medium data-active:border-transparent data-active:bg-transparent" value="overview"><FileCheck2 data-icon="inline-start" />Overview</TabsTrigger><TabsTrigger className="h-9 flex-none px-1 text-sm font-medium data-active:border-transparent data-active:bg-transparent" value="documents"><FileText data-icon="inline-start" />Documents</TabsTrigger><TabsTrigger className="h-9 flex-none px-1 text-sm font-medium data-active:border-transparent data-active:bg-transparent" value="tasks"><Bell data-icon="inline-start" />Tasks</TabsTrigger><TabsTrigger className="h-9 flex-none px-1 text-sm font-medium data-active:border-transparent data-active:bg-transparent" value="review"><AlertTriangle data-icon="inline-start" />Review{data.summary.needs_review > 0 && <Badge aria-hidden="true" variant="warning" className="ms-1">{data.summary.needs_review}</Badge>}</TabsTrigger>{user?.is_admin && <TabsTrigger className="h-9 flex-none px-1 text-sm font-medium data-active:border-transparent data-active:bg-transparent sm:ml-auto" value="governance"><ShieldCheck data-icon="inline-start" />Governance</TabsTrigger>}</TabsList>
        <TabsContent value="overview" className="mt-4 text-sm"><Overview data={data} onOpen={setSelected} onView={setView} onMetric={openMetric} /></TabsContent>
        <TabsContent value="documents" className="mt-4 space-y-4 text-sm"><Filters mode="documents" value={documentFilter} onChange={setDocumentFilter} data={data} /><DocumentRegister documents={filteredDocuments} totalCount={data.documents.length} onOpen={setSelected} /></TabsContent>
        <TabsContent value="tasks" className="mt-4 space-y-4 text-sm"><Filters mode="tasks" value={taskFilter} onChange={setTaskFilter} data={data} /><TaskList tasks={filteredTasks} totalCount={data.tasks.length} onOpen={setSelected} onComplete={(id) => void complete(id)} onAssign={setAssigning} canAssign={canReview} busy={busy} /></TabsContent>
        <TabsContent value="review" className="mt-4 text-sm"><ReviewQueue documents={data.documents.filter((doc) => doc.status === "needs_review")} canReview={canReview} canRetry={Boolean(user?.is_admin)} onOpen={setSelected} onReview={setReviewing} onRetry={(id) => void retry(id)} busy={busy} /></TabsContent>
        {user?.is_admin && <TabsContent value="governance" className="mt-4 text-sm">{options.data ? <Governance options={options.data} status={status.data} onReload={() => void dashboard.reload()} /> : options.error ? <Alert variant="destructive"><AlertDescription>{options.error}</AlertDescription></Alert> : <Skeleton className="h-48" />}</TabsContent>}
      </Tabs>}
      {selectedDoc && <DetailDialog document={selectedDoc} onClose={() => setSelected(null)} />}
      {reviewDoc && options.data && <ReviewDialog document={reviewDoc} options={options.data} onClose={() => setReviewing(null)} onSaved={() => { setReviewing(null); void dashboard.reload(); }} />}
      {assignTask && options.data && <AssignDialog task={assignTask} options={options.data} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); void dashboard.reload(); }} />}
    </>}
  </div>;
}
