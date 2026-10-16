import { useState, type FormEvent } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { pmError, type PmIssue } from "@/api/pm";
import { ISSUE_RELATIONSHIPS, decisionLabel, type DecisionDetailData, type DecisionIssue } from "@/api/pm-decisions";
import { FilterSelect } from "@/components/ListControls";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function DecisionIssueList({ issues, projectKey }: { issues: DecisionIssue[]; projectKey: string }) {
  return !issues.length ? <p className="text-sm text-muted-foreground">No linked issues.</p> : <ul className="flex flex-col gap-2">{issues.map((issue) => <li key={issue.id} className="border border-border p-3 text-sm">
    <Link to={`/projects/${projectKey}?tab=issues&issue=${encodeURIComponent(issue.key)}`} className="break-words font-medium underline-offset-4 hover:underline">{issue.key} · {issue.summary}</Link>
    <p className="mt-1 text-xs text-muted-foreground">{issue.issue_type} · {issue.status.split("_").join(" ")} · Assignee: {issue.assignee_name ?? "Unassigned"} · Reporter: {issue.reporter_name ?? "Former employee"}</p>
    {issue.relationship && <p className="mt-1 text-xs text-muted-foreground">Relationship: {decisionLabel(ISSUE_RELATIONSHIPS, issue.relationship)}{issue.added_by_name ? ` · Linked by ${issue.added_by_name}` : " · Original link author unavailable"}{issue.added_at ? ` · ${new Date(issue.added_at).toLocaleString()}` : ""}</p>}
  </li>)}</ul>;
}

export function DecisionLinks({ row, issues, projectKey, historical, onSaved }: {
  row: DecisionDetailData; issues: PmIssue[]; projectKey: string; historical: boolean; onSaved: (row: DecisionDetailData) => void;
}) {
  const [managing, setManaging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const draft = row.status === "draft" && !historical;
  return <section className="flex flex-col gap-3 border-t border-border pt-4" aria-label="Current issue links">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Current issue links ({row.issues.length})</h3>
      {!historical && row.can_manage_links && <Button variant="outline" size="sm" onClick={() => setManaging(true)}>Manage issue links</Button>}
    </div>
    <p className="text-xs text-muted-foreground">Track implementation work here. Link changes keep the existing approval and submitted versions.</p>
    {draft ? <DecisionIssueList issues={row.issues} projectKey={projectKey} /> : <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>{expanded ? "Hide current links" : "Show current links"}<ChevronDown data-icon="inline-end" aria-hidden="true" /></CollapsibleTrigger>
      <CollapsibleContent className="pt-2"><DecisionIssueList issues={row.issues} projectKey={projectKey} /></CollapsibleContent>
    </Collapsible>}
    {managing && <ManageLinks row={row} issues={issues} onClose={() => setManaging(false)} onSaved={onSaved} />}
  </section>;
}

function ManageLinks({ row, issues, onClose, onSaved }: { row: DecisionDetailData; issues: PmIssue[]; onClose: () => void; onSaved: (row: DecisionDetailData) => void }) {
  const [search, setSearch] = useState("");
  const [issueId, setIssueId] = useState("");
  const [relationship, setRelationship] = useState("relates_to");
  const [state, setState] = useState({ busy: false, error: "" });
  const linked = row.issues.find((issue) => issue.id === issueId);
  const choices = issues.filter((issue) => `${issue.key} ${issue.summary}`.toLowerCase().includes(search.trim().toLowerCase()));
  // Include linked issues even if the project's issue list is paged or stale.
  const options = [...choices, ...row.issues.filter((issue) => !choices.some((choice) => choice.id === issue.id))];
  async function mutate(removeId?: string) {
    setState({ busy: true, error: "" });
    try {
      const saved = await api<DecisionDetailData>(`/api/pm/decisions/${row.id}/issues${removeId ? `/${removeId}?version=${row.version}` : ""}`,
        { method: removeId ? "DELETE" : "POST", ...(removeId ? {} : { body: { version: row.version, issue_id: issueId, relationship } }) });
      onSaved(saved); setIssueId(""); setState({ busy: false, error: "" });
    } catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void mutate(); }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}><DialogContent className="flex max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] flex-col overflow-hidden sm:max-w-xl">
    <DialogHeader><DialogTitle>Manage issue links</DialogTitle><DialogDescription>{row.key} · These tracking changes do not request a new approval.</DialogDescription></DialogHeader>
    {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error} Close this dialog and reload the decision before retrying a stale save.</AlertDescription></Alert>}
    <div className="min-h-0 overflow-y-auto">
      <form id="decision-link-form" onSubmit={submit}><FieldGroup>
        <Field><FieldLabel htmlFor="decision-link-search">Find project issues</FieldLabel><Input id="decision-link-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by key or title" /></Field>
        <FilterSelect id="decision-link-issue" label="Issue" value={issueId} options={[{ value: "", label: "Choose an issue" }, ...options.map((issue) => ({ value: issue.id, label: `${issue.key} · ${issue.summary}` }))]} onChange={(value) => { setIssueId(value); setRelationship(row.issues.find((issue) => issue.id === value)?.relationship ?? "relates_to"); }} />
        <FilterSelect id="decision-link-relationship" label="Relationship" value={relationship} options={ISSUE_RELATIONSHIPS} onChange={setRelationship} />
        {!choices.length && <p className="text-sm text-muted-foreground">No matching project issues. Existing links remain available above.</p>}
      </FieldGroup></form>
      <section className="mt-5 flex flex-col gap-2" aria-label="Linked issues to manage"><h3 className="text-sm font-semibold">Linked issues ({row.issues.length}/100)</h3>
        {!row.issues.length && <p className="text-sm text-muted-foreground">No linked issues yet.</p>}
        {row.issues.map((issue) => <div key={issue.id} className="flex items-start gap-2 border border-border p-3">
          <div className="min-w-0 flex-1 text-sm"><p className="break-words font-medium">{issue.key} · {issue.summary}</p><p className="mt-1 text-xs text-muted-foreground">{decisionLabel(ISSUE_RELATIONSHIPS, issue.relationship ?? "relates_to")} · {issue.added_by_name ? `Linked by ${issue.added_by_name}` : "Original link author unavailable"}{issue.added_at ? ` · ${new Date(issue.added_at).toLocaleString()}` : ""}</p></div>
          <Button type="button" variant="ghost" size="icon-sm" disabled={state.busy} aria-label={`Unlink ${issue.key}`} onClick={() => void mutate(issue.id)}><X /></Button>
        </div>)}
      </section>
    </div>
    <DialogFooter className="shrink-0 border-t border-border pt-3"><Button type="button" variant="outline" disabled={state.busy} onClick={onClose}>Done</Button>
      <Button type="submit" form="decision-link-form" disabled={state.busy || !issueId || (!linked && row.issues.length >= 100)}><Plus data-icon="inline-start" />{state.busy ? "Saving…" : linked ? "Update relationship" : "Link issue"}</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}
