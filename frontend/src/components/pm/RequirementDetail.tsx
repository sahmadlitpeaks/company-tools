import { useState } from "react";
import { Link } from "react-router-dom";
import { Link2, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { api } from "@/api/client";
import { canEdit, pmError, type PmIssue, type PmMember, type PmProject, type PmSprint } from "@/api/pm";
import type { DecisionPage } from "@/api/pm-decisions";
import { REQUIREMENT_SECTIONS, requirementLabel, type RequirementDetailData } from "@/api/pm-requirements";
import Attachments from "@/components/Attachments";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ErrorState, Loading } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFetch } from "@/hooks/useApi";
import { DecisionForm } from "./DecisionForm";
import { DecisionStatus } from "./DecisionRegister";
import { IssueForm } from "./IssueForm";
import { MarkdownContent } from "./MarkdownField";
import { RequirementForm } from "./RequirementForm";
import { StatusBadge } from "./IssueBits";

type Props = { id: string; project: PmProject; members: PmMember[]; issues: PmIssue[]; sprints: PmSprint[]; onClose: () => void; onChanged: () => void };
export function RequirementDetail({ id, project, members, issues, sprints, onClose, onChanged }: Props) {
  const detail = useFetch<RequirementDetailData>(`/api/pm/requirements/${id}`, true);
  const [mode, setMode] = useState<"edit" | "task" | "decision" | "issues" | "decisions" | null>(null);
  const [state, setState] = useState({ busy: false, error: "" });
  const contextError = detail.data && detail.data.project_id !== project.id ? "This requirement belongs to a different project. Open it from Requirements." : null;
  const row = contextError ? null : detail.data;
  const editable = canEdit(project.my_role) && project.status === "active";
  const writable = editable && row?.status !== "archived";
  function changed() { void detail.refresh(); onChanged(); }
  async function unlink(kind: "issues" | "decisions", target: string) {
    setState({ busy: true, error: "" });
    try { await api(`/api/pm/requirements/${id}/links/${kind}/${target}`, { method: "DELETE" }); setState({ busy: false, error: "" }); changed(); }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  return <>
    <Sheet open onOpenChange={(open) => !open && onClose()}><SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
      <SheetHeader className="shrink-0 border-b border-border p-4 pr-12 sm:px-6"><SheetTitle className="break-words">{row?.title ?? "Requirement"}</SheetTitle><SheetDescription>{row ? `${row.key} · ${project.name}` : "Loading requirement"}</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6">
        {detail.error || contextError ? <ErrorState message={detail.error || contextError!} onRetry={detail.reload} /> : !row ? <Loading /> : <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{requirementLabel(row.status)}</Badge><span className="text-sm text-muted-foreground">Owner: {row.owner_name ?? "Unassigned"}</span></div><div className="flex gap-2"><Button size="sm" variant="outline" aria-label="Refresh requirement" onClick={changed}><RefreshCw /></Button>{editable && <Button size="sm" variant="outline" onClick={() => setMode("edit")}><Pencil data-icon="inline-start" />{row.status === "archived" ? "Restore / edit" : "Edit brief"}</Button>}</div></div>
          {row.status === "archived" && <Alert><AlertDescription>This requirement is archived. Its brief, files and links are read-only until restored.</AlertDescription></Alert>}
          {state.error && <Alert role="alert" variant="destructive"><AlertDescription>{state.error}</AlertDescription></Alert>}
          <div className="border border-border bg-muted/30 p-4"><div className="mb-3 flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">Implementation progress</span><span>{row.task_done} of {row.task_count} tasks done · {row.decision_count} {row.decision_count === 1 ? "decision" : "decisions"}</span></div><Progress value={row.task_count ? row.task_done / row.task_count * 100 : 0} aria-label={`${row.task_done} of ${row.task_count} tasks done`} /><p className="mt-2 text-xs text-muted-foreground">Progress follows linked task statuses. Mark the requirement delivered after reviewing its acceptance criteria.</p></div>
          <Tabs defaultValue="brief"><TabsList className="w-full"><TabsTrigger value="brief">Brief</TabsTrigger><TabsTrigger value="implementation">Work & decisions</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
            <TabsContent value="brief" className="flex flex-col gap-6 pt-5">
              {REQUIREMENT_SECTIONS.map((section) => <section key={section.key} className="flex flex-col gap-2"><h3 className="text-sm font-semibold">{section.label}</h3>{row[section.key] ? <MarkdownContent text={row[section.key]} /> : <p className="text-sm text-muted-foreground">Not documented yet.</p>}</section>)}
              <Attachments entityType="pm_requirement" entityId={id} heading="Supporting documents" readOnly={!writable} onChanged={changed} />
            </TabsContent>
            <TabsContent value="implementation" className="flex flex-col gap-6 pt-5">
              <section aria-label="Implementation tasks" className="flex flex-col gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Implementation tasks</h3>{writable && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setMode("issues")}><Link2 data-icon="inline-start" />Link existing task</Button><Button size="sm" onClick={() => setMode("task")}><Plus data-icon="inline-start" />Create task</Button></div>}</div>
                {!row.issues.length ? <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">Break this requirement into tasks for the frontend, backend, database or other work. Each task stays linked to this brief.</p> : <ul className="divide-y divide-border border border-border">{row.issues.map((issue) => <li key={issue.id} className="flex items-center gap-2 p-3"><Link to={`/projects/${project.key}?tab=requirements&requirement=${id}&issue=${issue.key}`} className="min-w-0 flex-1 text-sm hover:underline"><span className="block text-xs text-muted-foreground">{issue.key}</span><span className="break-words font-medium">{issue.summary}</span></Link><StatusBadge status={issue.status as PmIssue["status"]} />{writable && <Button size="icon-sm" variant="ghost" aria-label={`Unlink ${issue.key}`} disabled={state.busy} onClick={() => void unlink("issues", issue.id)}><X /></Button>}</li>)}</ul>}
              </section>
              <section aria-label="Supporting decisions" className="flex flex-col gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Supporting decisions</h3>{writable && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setMode("decisions")}><Link2 data-icon="inline-start" />Link existing decision</Button><Button size="sm" onClick={() => setMode("decision")}><Plus data-icon="inline-start" />Record decision</Button></div>}</div>
                {!row.decisions.length ? <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">Record decisions when an approach needs explanation, such as the database architecture or a feature trade-off.</p> : <ul className="divide-y divide-border border border-border">{row.decisions.map((decision) => <li key={decision.id} className="flex items-center gap-2 p-3"><Link to={`/projects/${project.key}?tab=requirements&requirement=${id}&decision=${decision.id}`} className="min-w-0 flex-1 text-sm hover:underline"><span className="block text-xs text-muted-foreground">{decision.key}</span><span className="break-words font-medium">{decision.title}</span></Link><DecisionStatus status={decision.status} />{writable && <Button size="icon-sm" variant="ghost" aria-label={`Unlink ${decision.key}`} disabled={state.busy} onClick={() => void unlink("decisions", decision.id)}><X /></Button>}</li>)}</ul>}
              </section>
            </TabsContent>
            <TabsContent value="history" className="pt-5"><RequirementHistory row={row} /></TabsContent>
          </Tabs>
        </div>}
      </div>
    </SheetContent></Sheet>
    {row && editable && mode === "edit" && <RequirementForm project={project} members={members} requirement={row} onClose={() => setMode(null)} onSaved={(saved) => { detail.setData(saved); setMode(null); onChanged(); }} />}
    {row && writable && mode === "task" && <IssueForm project={project} members={members} issues={issues} sprints={sprints} requirement={row} onClose={() => setMode(null)} onSaved={() => { setMode(null); changed(); }} />}
    {row && writable && mode === "decision" && <DecisionForm project={project} members={members} issues={issues} requirement={row} onClose={() => setMode(null)} onSaved={() => { setMode(null); changed(); }} />}
    {row && writable && (mode === "issues" || mode === "decisions") && <RequirementLinkDialog row={row} kind={mode} project={project} issues={issues} onClose={() => setMode(null)} onSaved={(saved) => { detail.setData(saved); setMode(null); onChanged(); }} />}
  </>;
}

function RequirementHistory({ row }: { row: RequirementDetailData }) {
  return <ol className="flex flex-col gap-4">{[...row.events].reverse().map((event) => {
    const before = event.details.before as Record<string, unknown> | undefined;
    const after = event.details.after as Record<string, unknown> | undefined;
    const changed = before && after ? Object.keys(after).filter((key) => before[key] !== after[key]) : [];
    return <li key={event.id} className="border-l-2 border-border pl-3 text-sm"><p><span className="font-medium">{event.actor_name}</span> · {event.action.replace(/_/g, " ")}</p><p className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</p>
      {typeof event.details.title === "string" && <p className="mt-1 break-words text-muted-foreground">{event.details.title}</p>}
      {typeof event.details.name === "string" && <p className="mt-1 break-words text-muted-foreground">{event.details.name}</p>}
      {changed.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-muted-foreground">View changes ({changed.length})</summary><dl className="mt-2 flex flex-col gap-3">{changed.map((key) => <div key={key}><dt className="font-medium">{REQUIREMENT_SECTIONS.find((s) => s.key === key)?.label ?? key.replace(/_/g, " ")}</dt><dd className="mt-1 grid gap-2 sm:grid-cols-2"><div className="min-w-0 border border-border p-2"><p className="text-xs text-muted-foreground">Before</p><p className="whitespace-pre-wrap break-words">{String(before![key] ?? "Not set")}</p></div><div className="min-w-0 border border-border p-2"><p className="text-xs text-muted-foreground">After</p><p className="whitespace-pre-wrap break-words">{String(after![key] ?? "Not set")}</p></div></dd></div>)}</dl></details>}
    </li>;
  })}</ol>;
}

function RequirementLinkDialog({ row, kind, project, issues, onClose, onSaved }: {
  row: RequirementDetailData; kind: "issues" | "decisions"; project: PmProject; issues: PmIssue[];
  onClose: () => void; onSaved: (saved: RequirementDetailData) => void;
}) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  const decisions = useFetch<DecisionPage>(kind === "decisions" ? `/api/pm/projects/${project.id}/decisions?limit=100&q=${encodeURIComponent(query)}` : null);
  const choices = kind === "issues" ? issues.filter((issue) => !row.issues.some((link) => link.id === issue.id) && `${issue.key} ${issue.summary}`.toLowerCase().includes(query.toLowerCase())).map((issue) => ({ value: issue.id, label: `${issue.key} · ${issue.summary}` })) : (decisions.data?.items ?? []).filter((decision) => !row.decisions.some((link) => link.id === decision.id)).map((decision) => ({ value: decision.id, label: `${decision.key} · ${decision.title}` }));
  async function save() {
    setState({ busy: true, error: "" });
    try { onSaved(await api<RequirementDetailData>(`/api/pm/requirements/${row.id}/links/${kind}`, { method: "POST", body: { target_id: target } })); }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}><DialogContent><DialogHeader><DialogTitle>Link existing {kind === "issues" ? "task" : "decision"}</DialogTitle><DialogDescription>Choose a record from {project.name}. Its content stays in its own module.</DialogDescription></DialogHeader>
    {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
    <Field><FieldLabel htmlFor="requirement-link-search">Find record</FieldLabel><Input id="requirement-link-search" value={query} onChange={(e) => { setQuery(e.target.value); setTarget(""); }} /></Field>
    {decisions.error ? <ErrorState message={decisions.error} onRetry={decisions.reload} /> : kind === "decisions" && !decisions.data ? <Loading /> : choices.length ? <TaskChoice id="requirement-link-target" label="Record" value={target} items={[{ value: "", label: "Choose a record" }, ...choices]} onChange={setTarget} /> : <p className="text-sm text-muted-foreground">No matching unlinked records. Try another search or create a new record.</p>}
    {decisions.data && decisions.data.total > 100 && <p className="text-sm text-muted-foreground">Showing the first 100 results. Search to find a specific decision.</p>}
    <DialogFooter><Button variant="outline" disabled={state.busy} onClick={onClose}>Cancel</Button><Button disabled={state.busy || !target} onClick={() => void save()}>{state.busy ? "Linking…" : "Link record"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
