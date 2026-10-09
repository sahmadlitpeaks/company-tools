import { useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import {
  canEdit, ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, issueLink, labelOf, LINK_RELATIONS, pmError,
  type IssueStatus, type PmComment, type PmHistory, type PmIssue, type PmIssueDetail, type PmLink, type PmMember, type PmProject, type PmSprint,
} from "@/api/pm";
import { dateLabel } from "@/api/tasks";
import { useAuth } from "@/auth/AuthContext";
import Attachments from "@/components/Attachments";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ErrorState, Loading } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useFetch } from "@/hooks/useApi";
import { IssueForm } from "./IssueForm";
import { IssueTypeIcon, pointsLabel, StatusBadge } from "./IssueBits";

type Props = {
  issueKey: string;
  project: PmProject;
  members: PmMember[];
  issues: PmIssue[];
  sprints: PmSprint[];
  onClose: () => void;
  onChanged: () => void;
};

/** Jira-style issue view in a side panel, opened from `?issue=KEY-N`. */
export function IssueDetail({ issueKey, project, members, issues, sprints, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const detail = useFetch<PmIssueDetail>(`/api/pm/issues/${issueKey}`, true);
  const [mode, setMode] = useState<null | "edit" | "child" | "delete">(null);
  const [state, setState] = useState({ busy: false, error: "" });
  const issue = detail.data;
  const writable = project.status !== "archived";
  const editable = writable && canEdit(issue?.my_role);

  async function mutate(run: () => Promise<unknown>) {
    setState({ busy: true, error: "" });
    try {
      await run();
      setState({ busy: false, error: "" });
      void detail.refresh();
      onChanged();
      return true;
    } catch (cause) {
      setState({ busy: false, error: pmError(cause) });
      return false;
    }
  }

  const childType = issue?.issue_type === "epic" ? "story" : "subtask";
  return <>
    <Sheet open onOpenChange={(open) => !open && !state.busy && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="flex items-start gap-2 text-base">
            {issue && <IssueTypeIcon type={issue.issue_type} className="mt-0.5" />}
            <span className="min-w-0 break-words">{issue ? issue.summary : issueKey}</span>
          </SheetTitle>
          <SheetDescription>
            {issue ? <>{issue.parent && <><Link to={issueLink(project.key, issue.parent.key)} className="underline-offset-4 hover:underline">{issue.parent.key}</Link> / </>}{issue.key} · {labelOf(ISSUE_TYPES, issue.issue_type)}</> : "Loading issue"}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-4">
          {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
          {detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> : !issue ? <Loading /> : <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44">
                <TaskChoice
                  id="pm-detail-status" label="Status" value={issue.status} items={ISSUE_STATUSES} disabled={!editable || state.busy}
                  onChange={(value) => void mutate(() => api(`/api/pm/issues/${issue.id}`, { method: "PATCH", body: { status: value as IssueStatus } }))}
                />
              </div>
              <Button
                variant="outline" disabled={!writable || state.busy}
                onClick={() => void mutate(() => issue.watching
                  ? api(`/api/pm/issues/${issue.id}/watchers/${user?.id}`, { method: "DELETE" })
                  : api(`/api/pm/issues/${issue.id}/watchers`, { method: "POST", body: { user_id: user?.id } }))}
              >
                {issue.watching ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                {issue.watching ? "Stop watching" : "Watch"}
              </Button>
              {editable && <Button variant="outline" onClick={() => setMode("edit")} disabled={state.busy}><Pencil data-icon="inline-start" />Edit</Button>}
              {editable && <Button variant="ghost" size="icon" aria-label={`Delete ${issue.key}`} onClick={() => setMode("delete")} disabled={state.busy}><Trash2 /></Button>}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Detail label="Assignee">{issue.assignee_name ?? "Unassigned"}</Detail>
              <Detail label="Reporter">{issue.reporter_name ?? "—"}</Detail>
              <Detail label="Priority">{labelOf(ISSUE_PRIORITIES, issue.priority)}</Detail>
              <Detail label="Story points">{pointsLabel(issue.story_points)}</Detail>
              {project.sprints_enabled && <Detail label="Sprint">{issue.sprint_name ?? "Backlog"}</Detail>}
              <Detail label="Start date">{issue.start_date ? dateLabel(issue.start_date) : "—"}</Detail>
              <Detail label="Due date">{issue.due_date ? dateLabel(issue.due_date) : "—"}</Detail>
              {issue.external_key && <Detail label="Jira key">{issue.external_key}</Detail>}
              <Detail label="Labels" wide>
                {issue.labels?.length ? <span className="flex flex-wrap gap-1">{issue.labels.map((label) => <Badge key={label} variant="outline">{label}</Badge>)}</span> : "None"}
              </Detail>
              <Detail label="Watchers" wide>{issue.watchers.map((w) => w.name).join(", ") || "Nobody"}</Detail>
            </dl>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Description</h3>
              {issue.description ? <p className="whitespace-pre-wrap break-words text-sm">{issue.description}</p> : <p className="text-sm text-muted-foreground">No description.</p>}
            </section>

            {issue.issue_type !== "subtask" && <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{issue.issue_type === "epic" ? "Issues in this epic" : "Sub-tasks"}</h3>
                {editable && <Button size="sm" variant="outline" onClick={() => setMode("child")}><Plus data-icon="inline-start" />{issue.issue_type === "epic" ? "Add issue" : "Add sub-task"}</Button>}
              </div>
              {issue.children.length > 0 && <Progress value={Math.round(issue.child_done / issue.child_count * 100)} aria-label={`${issue.child_done} of ${issue.child_count} done`} />}
              {issue.children.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : <ul className="flex flex-col divide-y divide-border border border-border">
                {issue.children.map((child) => <li key={child.id}>
                  <Link to={issueLink(project.key, child.key)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
                    <IssueTypeIcon type={child.issue_type} />
                    <span className="shrink-0 text-muted-foreground">{child.key}</span>
                    <span className="min-w-0 flex-1 truncate">{child.summary}</span>
                    <StatusBadge status={child.status} />
                  </Link>
                </li>)}
              </ul>}
            </section>}

            <IssueLinks issue={issue} issues={issues} projectKey={project.key} editable={editable} busy={state.busy} mutate={mutate} />

            <Attachments entityType="pm_issue" entityId={issue.id} readOnly={!editable} />

            <Tabs defaultValue="comments">
              <TabsList>
                <TabsTrigger value="comments">Comments</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>
              <TabsContent value="comments"><IssueComments issueId={issue.id} isAdmin={issue.my_role === "admin"} readOnly={!writable} onChanged={onChanged} /></TabsContent>
              <TabsContent value="history"><IssueHistory issueId={issue.id} updatedAt={issue.updated_at} /></TabsContent>
            </Tabs>

            <p className="text-xs text-muted-foreground">
              Created {new Date(issue.created_at).toLocaleString()} · Updated {new Date(issue.updated_at).toLocaleString()}
              {issue.resolved_at && <> · Resolved {new Date(issue.resolved_at).toLocaleString()}</>}
            </p>
          </>}
        </div>
      </SheetContent>
    </Sheet>

    {editable && issue && mode === "edit" && <IssueForm project={project} members={members} issues={issues} sprints={sprints} issue={issue} onClose={() => setMode(null)} onSaved={() => { setMode(null); void detail.refresh(); onChanged(); }} />}
    {editable && issue && mode === "child" && <IssueForm project={project} members={members} issues={issues} sprints={sprints} defaults={{ issue_type: childType, parent_id: issue.id }} onClose={() => setMode(null)} onSaved={() => { setMode(null); void detail.refresh(); onChanged(); }} />}
    <AlertDialog open={editable && mode === "delete"} onOpenChange={(open) => !open && !state.busy && setMode(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {issue?.key}?</AlertDialogTitle>
          <AlertDialogDescription>
            {issue?.issue_type === "epic" ? "The epic is removed; its issues stay in the project without an epic." : "This removes the issue, its sub-tasks, comments, history and attachments."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => setMode(null)} disabled={state.busy}>Cancel</Button>
          <Button variant="destructive" disabled={state.busy} onClick={() => void (async () => {
            if (!issue) return;
            setState({ busy: true, error: "" });
            try { await api(`/api/pm/issues/${issue.id}`, { method: "DELETE" }); onChanged(); onClose(); }
            catch (cause) { setState({ busy: false, error: pmError(cause) }); }
          })()}>{state.busy ? "Deleting…" : "Delete issue"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function Detail({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <div className={wide ? "col-span-2 sm:col-span-3" : undefined}>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="break-words font-medium">{children}</dd>
  </div>;
}

function IssueLinks({ issue, issues, projectKey, editable, busy, mutate }: {
  issue: PmIssueDetail; issues: PmIssue[]; projectKey: string; editable: boolean; busy: boolean;
  mutate: (run: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ relation: PmLink["relation"]; target: string }>({ relation: "blocks", target: "" });
  const targets = issues.filter((other) => other.id !== issue.id);
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!form.target) return;
    const ok = await mutate(() => api(`/api/pm/issues/${issue.id}/links`, { method: "POST", body: { relation: form.relation, target_id: form.target } }));
    if (ok) { setAdding(false); setForm({ relation: "blocks", target: "" }); }
  }
  return <section className="flex flex-col gap-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Linked issues</h3>
      {editable && !adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Link2 data-icon="inline-start" />Link issue</Button>}
    </div>
    {issue.links.length === 0 && !adding && <p className="text-sm text-muted-foreground">No linked issues.</p>}
    {issue.links.length > 0 && <ul className="flex flex-col gap-1">
      {issue.links.map((link) => <li key={link.id} className="flex items-center gap-2 text-sm">
        <span className="w-28 shrink-0 text-muted-foreground">{labelOf(LINK_RELATIONS, link.relation)}</span>
        <Link to={issueLink(projectKey, link.issue.key)} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
          <IssueTypeIcon type={link.issue.issue_type} /><span className="shrink-0">{link.issue.key}</span><span className="truncate">{link.issue.summary}</span>
        </Link>
        <StatusBadge status={link.issue.status} />
        {editable && <Button size="icon-sm" variant="ghost" aria-label={`Remove link to ${link.issue.key}`} disabled={busy} onClick={() => void mutate(() => api(`/api/pm/links/${link.id}`, { method: "DELETE" }))}><X /></Button>}
      </li>)}
    </ul>}
    {editable && adding && <form onSubmit={(event) => void add(event)} className="grid items-end gap-2 sm:grid-cols-[10rem_1fr_auto]">
      <TaskChoice id="pm-link-relation" label="This issue" value={form.relation} items={LINK_RELATIONS} onChange={(value) => setForm((c) => ({ ...c, relation: value as PmLink["relation"] }))} />
      <TaskChoice id="pm-link-target" label="Issue" value={form.target} items={[...(form.target ? [] : [{ value: "", label: "Choose an issue" }]), ...targets.map((t) => ({ value: t.id, label: `${t.key} ${t.summary}` }))]} onChange={(value) => setForm((c) => ({ ...c, target: value }))} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !form.target}>Link</Button>
        <Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
      </div>
    </form>}
  </section>;
}

function IssueComments({ issueId, isAdmin, readOnly, onChanged }: { issueId: string; isAdmin: boolean; readOnly: boolean; onChanged: () => void }) {
  const { user } = useAuth();
  const comments = useFetch<PmComment[]>(`/api/pm/issues/${issueId}/comments`);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [state, setState] = useState({ busy: false, error: "" });
  async function run(action: () => Promise<unknown>, reset?: () => void) {
    setState({ busy: true, error: "" });
    try { await action(); reset?.(); setState({ busy: false, error: "" }); void comments.refresh(); onChanged(); }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  return <div className="flex flex-col gap-3 pt-2">
    {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
    {comments.error ? <ErrorState message={comments.error} onRetry={comments.reload} /> : comments.loading && !comments.data ? <Loading /> : <>
      {comments.data?.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
      {comments.data?.map((comment) => <article key={comment.id} className="flex flex-col gap-1 border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{comment.author_name ?? "Former employee"}</span> · {new Date(comment.created_at).toLocaleString()}
            {comment.updated_at !== comment.created_at && " · edited"}
          </p>
          <span className="flex gap-1">
            {!readOnly && comment.author_id === user?.id && <Button size="icon-sm" variant="ghost" aria-label="Edit comment" onClick={() => setEditing({ id: comment.id, body: comment.body })}><Pencil /></Button>}
            {!readOnly && (comment.author_id === user?.id || isAdmin) && <Button size="icon-sm" variant="ghost" aria-label="Delete comment" disabled={state.busy} onClick={() => void run(() => api(`/api/pm/comments/${comment.id}`, { method: "DELETE" }))}><Trash2 /></Button>}
          </span>
        </div>
        {!readOnly && editing?.id === comment.id ? <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); if (editing.body.trim()) void run(() => api(`/api/pm/comments/${comment.id}`, { method: "PATCH", body: { body: editing.body.trim() } }), () => setEditing(null)); }}>
          <Field><FieldLabel htmlFor={`pm-edit-${comment.id}`} className="sr-only">Edit comment</FieldLabel><Textarea id={`pm-edit-${comment.id}`} rows={3} value={editing.body} onChange={(event) => setEditing({ id: comment.id, body: event.target.value })} /></Field>
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={state.busy || !editing.body.trim()}>Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
        </form> : <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>}
      </article>)}
    </>}
    {!readOnly && <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); if (body.trim()) void run(() => api(`/api/pm/issues/${issueId}/comments`, { method: "POST", body: { body: body.trim() } }), () => setBody("")); }}>
      <Field><FieldLabel htmlFor="pm-comment">Add a comment</FieldLabel><Textarea id="pm-comment" rows={3} value={body} onChange={(event) => setBody(event.target.value)} /></Field>
      <div><Button type="submit" disabled={state.busy || !body.trim()}>Comment</Button></div>
    </form>}
  </div>;
}

function IssueHistory({ issueId, updatedAt }: { issueId: string; updatedAt: string }) {
  // Keyed on updatedAt so a saved change shows up without a manual refresh.
  const history = useFetch<PmHistory[]>(`/api/pm/issues/${issueId}/history?v=${encodeURIComponent(updatedAt)}`);
  if (history.error) return <ErrorState message={history.error} onRetry={history.reload} />;
  if (history.loading && !history.data) return <Loading />;
  if (!history.data?.length) return <p className="pt-2 text-sm text-muted-foreground">No changes since the issue was created.</p>;
  return <ol className="flex flex-col gap-2 pt-2">
    {history.data.map((entry) => <li key={entry.id} className="text-sm">
      <span className="font-medium">{entry.actor_name ?? "Someone"}</span> changed <span className="font-medium">{entry.field}</span>
      {entry.field !== "description" && <> from <span className="text-muted-foreground">{historyValue(entry.field, entry.old_value)}</span> to <span className="text-muted-foreground">{historyValue(entry.field, entry.new_value)}</span></>}
      <span className="block text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</span>
    </li>)}
  </ol>;
}

const HISTORY_VOCABULARY: Record<string, Array<{ value: string; label: string }>> = {
  status: ISSUE_STATUSES, priority: ISSUE_PRIORITIES, type: ISSUE_TYPES,
};

function historyValue(field: string, value: string | null) {
  if (value === null) return "none";
  return HISTORY_VOCABULARY[field]?.find((item) => item.value === value)?.label ?? value;
}
