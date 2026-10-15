import { useState } from "react";
import { Archive, ArrowRightLeft, CheckCircle2, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { pmError, type PmIssue, type PmMember, type PmProject } from "@/api/pm";
import { DECISION_CATEGORIES, decisionLabel, type DecisionDetailData, type DecisionPage, type DecisionSnapshot } from "@/api/pm-decisions";
import { FilterSelect } from "@/components/ListControls";
import { ErrorState, Loading } from "@/components/ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useFetch } from "@/hooks/useApi";
import { DecisionForm } from "./DecisionForm";
import { DecisionStatus } from "./DecisionRegister";

const EVENT_LABELS: Record<string, string> = {
  created: "created the draft", draft_updated: "updated the draft", submitted: "submitted for approval",
  approved: "approved", rejected: "rejected", returned_to_draft: "returned to draft",
  superseded: "replaced this decision", replaces_decision: "linked a previous decision", archived: "archived",
};
type Action = "submit" | "approve" | "reject" | "revise" | "supersede" | "archive";
const ACTION_LABELS: Record<Action, string> = { submit: "Submit for approval", approve: "Approve revision", reject: "Reject revision", revise: "Return to draft", supersede: "Replace decision", archive: "Archive decision" };

export function DecisionDetail({ id, project, members, issues, onClose, onChanged }: {
  id: string; project: PmProject; members: PmMember[]; issues: PmIssue[]; onClose: () => void; onChanged: () => void;
}) {
  const detail = useFetch<DecisionDetailData>(`/api/pm/decisions/${id}`, true);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [revision, setRevision] = useState("");
  const row = detail.data;
  const historical = row?.revisions.find((r) => String(r.number) === revision);
  const snapshot: DecisionSnapshot | undefined = historical?.snapshot ?? (row ? { ...row, proposed_by_name: row.proposed_by_name } : undefined);
  const viewingPrevious = Boolean(historical && (row?.status === "draft" || historical.number !== row?.revision_number));
  function saved(savedRow: DecisionDetailData) { detail.setData(savedRow); setEditing(false); setAction(null); setRevision(""); onChanged(); }
  return <>
    <Sheet open onOpenChange={(open) => !open && onClose()}><SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
      <SheetHeader className="shrink-0 border-b border-border pr-12 sm:px-6 sm:pr-12"><SheetTitle className="break-words text-base">{row?.title ?? "Decision"}</SheetTitle><SheetDescription>{row?.key ?? "Loading decision"}</SheetDescription></SheetHeader>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
        {detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> : !row || !snapshot ? <Loading /> : <>
          <div className="flex flex-wrap items-center justify-between gap-2"><DecisionStatus status={row.status} /><Button variant="ghost" size="sm" onClick={() => void detail.reload()}>Reload decision</Button></div>
          {row.approved_revision_number && <Alert><CheckCircle2 aria-hidden="true" /><AlertTitle>Approved revision {row.approved_revision_number}</AlertTitle><AlertDescription>
            {row.approved_at && <p>Approved {new Date(row.approved_at).toLocaleString()}.</p>}
            {["draft", "pending_approval", "rejected"].includes(row.status) && <p>This proposal has not replaced the earlier approval.</p>}
            <div className="mt-2"><Button variant="outline" size="sm" onClick={() => setRevision(String(row.approved_revision_number))}>View approved version</Button></div>
          </AlertDescription></Alert>}
          {project.status === "archived" && <Alert><AlertDescription>This project is archived. Decisions and approval history remain readable.</AlertDescription></Alert>}
          <div className="flex flex-wrap gap-2">
            {viewingPrevious && <Button variant="outline" onClick={() => setRevision("")}>{row.status === "draft" ? "View current draft" : "View current content"}</Button>}
            {!viewingPrevious && row.can_edit && <Button variant="outline" onClick={() => setEditing(true)}>Edit draft</Button>}
            {!viewingPrevious && row.can_submit && <Button disabled={!row.approver_id} onClick={() => setAction("submit")}>Submit for approval</Button>}
            {!viewingPrevious && row.can_decide && <><Button onClick={() => setAction("approve")}>Approve revision {row.revision_number}</Button><Button variant="outline" onClick={() => setAction("reject")}>Reject revision {row.revision_number}</Button></>}
            {!viewingPrevious && row.can_revise && <Button variant="outline" onClick={() => setAction("revise")}>{row.status === "pending_approval" ? "Withdraw submission" : "Propose a revision"}</Button>}
            {!viewingPrevious && (row.can_supersede || row.can_archive) && <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />}>More actions<ChevronDown data-icon="inline-end" aria-hidden="true" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48"><DropdownMenuGroup>
                {row.can_supersede && <DropdownMenuItem onClick={() => setAction("supersede")}><ArrowRightLeft aria-hidden="true" />Replace decision</DropdownMenuItem>}
                {row.can_archive && <DropdownMenuItem onClick={() => setAction("archive")}><Archive aria-hidden="true" />Archive decision</DropdownMenuItem>}
              </DropdownMenuGroup></DropdownMenuContent>
            </DropdownMenu>}
          </div>
          {!viewingPrevious && row.can_submit && !row.approver_id && <p className="text-sm text-muted-foreground">Edit the draft and choose an approver before submitting.</p>}
          <dl className="grid grid-cols-2 gap-4 border-y border-border py-4 text-sm">
            <Meta label="Owner" value={snapshot.owner_name ?? "Former employee"} /><Meta label="Approver" value={snapshot.approver_name ?? "Not assigned"} />
            <Meta label="Category" value={decisionLabel(DECISION_CATEGORIES, snapshot.category)} /><Meta label="Proposed by" value={snapshot.proposed_by_name ?? "Former employee"} />
            <Meta label="Effective date" value={snapshot.effective_date ?? "Not set"} /><Meta label="Created" value={new Date(row.created_at).toLocaleString()} />
          </dl>
          {row.revisions.length > 0 && <FilterSelect id="decision-view-revision" label="Viewing version" value={revision} options={[
            { value: "", label: row.status === "draft" ? "Current draft" : `Current content · revision ${row.revision_number}` },
            ...row.revisions.map((r) => ({ value: String(r.number), label: `Submitted revision ${r.number}${r.number === row.approved_revision_number ? " · approved" : ""}` })),
          ]} onChange={setRevision} />}
          {historical && <p className="text-sm text-muted-foreground">Submitted by {historical.submitted_by_name} · {new Date(historical.created_at).toLocaleString()}<br />{historical.change_summary}</p>}
          <DecisionBody snapshot={snapshot} projectKey={project.key} historical={Boolean(historical)} />
          {row.related_decisions.length > 0 && <section className="flex flex-col gap-2"><h3 className="text-sm font-semibold">Decision relationships</h3>{row.related_decisions.map((related) => <Link key={related.id} to={`/projects/${project.key}?tab=decisions&decision=${related.id}`} className="break-words text-sm underline">{related.relationship === "replaced_by" ? "Replaced by" : "Replaces"} {related.key} · {related.title}</Link>)}</section>}
          <section className="flex flex-col gap-3 border-t border-border pt-5" aria-label="Decision history"><h3 className="text-sm font-semibold">Decision and approval history</h3>
            <ol className="flex flex-col gap-3">{row.events.map((event) => <li key={event.id} className="border-l-2 border-border pl-3 text-sm">
              <p><span className="font-medium">{event.actor_name}</span> {EVENT_LABELS[event.action] ?? event.action}{event.revision_number ? ` · revision ${event.revision_number}` : ""}</p>
              <p className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</p>
              {event.note && <p className="mt-1 whitespace-pre-wrap break-words">{event.note}</p>}
            </li>)}</ol>
          </section>
        </>}
      </div>
    </SheetContent></Sheet>
    {row && editing && <DecisionForm project={project} members={members} issues={issues} decision={row} onClose={() => { setEditing(false); void detail.reload(); }} onSaved={saved} />}
    {row && action && <DecisionAction key={action} action={action} row={row} project={project} onClose={() => setAction(null)} onSaved={saved} />}
  </>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>;
}

function DecisionBody({ snapshot, projectKey, historical }: { snapshot: DecisionSnapshot; projectKey: string; historical: boolean }) {
  return <>
    {historical && <h3 className="break-words text-base font-semibold">{snapshot.title}</h3>}
    {[["Context / problem", snapshot.context], ["Chosen approach", snapshot.approach], ["Rationale", snapshot.rationale], ["Alternatives considered", snapshot.alternatives]].filter(([, text]) => text).map(([title, text]) =>
      <section key={title} className="flex flex-col gap-2"><h3 className="text-sm font-semibold">{title}</h3><p className="whitespace-pre-wrap break-words text-sm">{text}</p></section>)}
    <section className="flex flex-col gap-2"><h3 className="text-sm font-semibold">Linked issues{historical ? " at submission" : ""}</h3>
      {!snapshot.issues.length ? <p className="text-sm text-muted-foreground">No linked issues.</p> : <ul className="flex flex-col gap-2">{snapshot.issues.map((issue) => <li key={issue.id} className="border border-border p-3 text-sm">
        <Link to={`/projects/${projectKey}?tab=issues&issue=${encodeURIComponent(issue.key)}`} className="break-words font-medium underline-offset-4 hover:underline">{issue.key} · {issue.summary}</Link>
        <p className="mt-1 text-xs text-muted-foreground">{issue.issue_type} · {issue.status.split("_").join(" ")} · Assignee: {issue.assignee_name ?? "Unassigned"} · Reporter: {issue.reporter_name ?? "Former employee"}</p>
      </li>)}</ul>}
      {historical && snapshot.issues.length > 0 && <p className="text-xs text-muted-foreground">These details were captured at submission. An issue may have changed or been removed since then.</p>}
    </section>
    <section className="flex flex-col gap-2"><h3 className="text-sm font-semibold">Evidence references</h3>
      {!snapshot.evidence.length ? <p className="text-sm text-muted-foreground">No evidence references.</p> : <ul className="flex flex-col gap-2">{snapshot.evidence.map((item) => <li key={`${item.type}-${item.label}-${item.url}`} className="break-words text-sm">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="underline">{item.label}</a>
        <p className="text-xs text-muted-foreground">{item.added_by_name}{item.added_at ? ` · ${new Date(item.added_at).toLocaleString()}` : ""}</p>
      </li>)}</ul>}
    </section>
  </>;
}

function DecisionAction({ action, row, project, onClose, onSaved }: { action: Action; row: DecisionDetailData; project: PmProject; onClose: () => void; onSaved: (row: DecisionDetailData) => void }) {
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [replacement, setReplacement] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  const choices = useFetch<DecisionPage>(action === "supersede" ? `/api/pm/projects/${project.id}/decisions?status=approved&limit=25&q=${encodeURIComponent(search)}` : null, true);
  const label = ACTION_LABELS[action];
  const required = action !== "approve";
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setState({ busy: true, error: "" });
    const body = { version: row.version, ...(action === "submit" ? { change_summary: note } :
      action === "approve" || action === "reject" ? { revision_number: row.revision_number, outcome: action === "approve" ? "approved" : "rejected", note } :
        { reason: note, ...(action === "supersede" ? { replacement_id: replacement } : {}) }) };
    try { onSaved(await api<DecisionDetailData>(`/api/pm/decisions/${row.id}/${action === "approve" || action === "reject" ? "approval" : action}`, { method: "POST", body })); }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}><DialogContent className="max-h-[90dvh] w-[calc(100%_-_2rem)] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{row.key}{action === "submit" ? " · A snapshot of this draft will be sent to the assigned approver." : action === "approve" || action === "reject" ? ` · You are deciding submitted revision ${row.revision_number}.` : " · Previous submitted versions and approvals will be retained."}</DialogDescription></DialogHeader>
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error} Close this dialog and reload the decision if it changed.</AlertDescription></Alert>}
      {action === "supersede" && <>
        <Field><FieldLabel htmlFor="replacement-search">Find replacement decision</FieldLabel><Input id="replacement-search" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setReplacement(""); }} placeholder="Search by key or title" /></Field>
        {choices.error ? <ErrorState message={choices.error} onRetry={choices.reload} /> : choices.loading ? <Loading /> : <FilterSelect id="decision-replacement" label="Approved replacement" value={replacement} options={[{ value: "", label: "Choose an approved decision" }, ...(choices.data?.items ?? []).filter((item) => item.id !== row.id).map((item) => ({ value: item.id, label: `${item.key} · ${item.title}` }))]} onChange={setReplacement} />}
      </>}
      <Field><FieldLabel htmlFor="decision-action-note">{action === "submit" ? "Summary of this submission" : action === "approve" ? "Approval note (optional)" : "Reason"}</FieldLabel><Textarea id="decision-action-note" required={required} maxLength={2000} rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <DialogFooter><Button type="button" variant="outline" disabled={state.busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={state.busy || (required && !note.trim()) || (action === "supersede" && !replacement)}>{state.busy ? "Saving…" : label}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
