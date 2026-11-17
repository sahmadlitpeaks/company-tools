import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "@/api/client";
import { hasProjectPermission, pmError, type PmProject } from "@/api/pm";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ErrorState, Loading, Modal } from "@/components/ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFetch } from "@/hooks/useApi";

type PreviewIssue = {
  id: string; old_key: string; new_key: string; summary: string; issue_type: string; selected: boolean;
  status_from: string; status_to: string; dropped: string[]; notes: string[];
};
type Preview = {
  target: { id: string; key: string; name: string };
  issues: PreviewIssue[];
  left_behind: Array<{ id: string; summary: string }>;
  people_losing_access: string[];
  assignees_added: number;
  count: number;
};
export type MoveResult = { target: string; moved: Array<{ id: string; old_key: string; new_key: string }> };

/**
 * Move one or more issues to another project (BRD section 8). The first step
 * previews every change; nothing moves until the person confirms.
 */
export function MoveIssuesDialog({ issueIds, source, includesEpic, onClose, onMoved }: {
  issueIds: string[]; source: PmProject; includesEpic: boolean;
  onClose: () => void; onMoved: (result: MoveResult) => void;
}) {
  const projects = useFetch<PmProject[]>("/api/pm/projects");
  const targets = (projects.data ?? []).filter((p) => p.id !== source.id && hasProjectPermission(p, "issue.move_in"));
  const [target, setTarget] = useState("");
  const [moveChildren, setMoveChildren] = useState(true);
  const [assignees, setAssignees] = useState<"unassign" | "add_member">("unassign");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState({ busy: false, error: "" });
  const body = { issue_ids: issueIds, target_project_id: target, move_children: moveChildren, assignee_action: assignees };

  async function run<T>(action: () => Promise<T>) {
    setState({ busy: true, error: "" });
    try { const result = await action(); setState({ busy: false, error: "" }); return result; }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); return null; }
  }
  async function review() {
    const result = await run(() => api<Preview>("/api/pm/issues/move/preview", { method: "POST", body }));
    if (result) setPreview(result);
  }
  async function confirm() {
    const result = await run(() => api<MoveResult>("/api/pm/issues/move", { method: "POST", body }));
    if (result) onMoved(result);
  }

  const noun = issueIds.length === 1 ? "issue" : `${issueIds.length} issues`;
  return <Modal title={`Move ${noun} to another project`} maxWidth={720} onClose={() => !state.busy && onClose()}
    description="Issues get a new key in the target project. Comments, attachments, history and links stay, and old keys keep working."
    footer={<>
      <Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
      {preview
        ? <Button onClick={() => void confirm()} disabled={state.busy}>{state.busy && <Spinner data-icon="inline-start" />}Move {preview.count === 1 ? "issue" : `${preview.count} issues`}</Button>
        : <Button onClick={() => void review()} disabled={state.busy || !target}>{state.busy && <Spinner data-icon="inline-start" />}Review changes</Button>}
    </>}>
    <div className="flex flex-col gap-5">
      {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
      {projects.error ? <ErrorState message={projects.error} onRetry={projects.reload} /> : projects.loading ? <Loading /> : !targets.length
        ? <Alert><AlertDescription>There is no other active project you can move issues into. You need the “Move issues in” permission on the target project.</AlertDescription></Alert>
        : <FieldGroup>
          <TaskChoice id="pm-move-target" label="Target project" value={target}
            items={[...(target ? [] : [{ value: "", label: "Choose a project" }]), ...targets.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))]}
            onChange={(value) => { setTarget(value); setPreview(null); }} />
          {includesEpic && <Field orientation="horizontal">
            <Checkbox id="pm-move-children" checked={moveChildren} onCheckedChange={(checked) => { setMoveChildren(checked === true); setPreview(null); }} />
            <div className="flex flex-col gap-0.5">
              <FieldLabel htmlFor="pm-move-children">Move the epic's issues too</FieldLabel>
              <FieldDescription>Otherwise they stay in {source.key} and lose their epic link.</FieldDescription>
            </div>
          </Field>}
          <FieldSet>
            <FieldLegend variant="label" id="pm-move-assignees">Assignees who aren't on the target project</FieldLegend>
            <ToggleGroup variant="outline" value={[assignees]} aria-labelledby="pm-move-assignees"
              onValueChange={(values) => { if (values[0]) { setAssignees(values[0] as typeof assignees); setPreview(null); } }}>
              <ToggleGroupItem value="unassign">Unassign</ToggleGroupItem>
              <ToggleGroupItem value="add_member">Add them as Contributors</ToggleGroupItem>
            </ToggleGroup>
          </FieldSet>
        </FieldGroup>}
      {preview && <div className="flex flex-col gap-3" aria-live="polite">
        <h3 className="text-sm font-medium">What will change</h3>
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {preview.issues.map((issue) => <li key={issue.id} className="flex flex-col gap-1 py-2">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono">{issue.old_key}</span><ArrowRight aria-label="becomes" className="size-4" />
              <span className="font-mono font-medium">{issue.new_key}</span>
              <span className="min-w-0 truncate text-muted-foreground">{issue.summary}</span>
              {!issue.selected && <Badge variant="outline">Moves with its parent</Badge>}
            </p>
            {issue.status_from !== issue.status_to && <p className="text-xs text-muted-foreground">Status: {issue.status_from} → {issue.status_to}</p>}
            {issue.dropped.length > 0 && <p className="text-xs text-muted-foreground">Dropped (kept in history): {issue.dropped.join(", ")}</p>}
            {issue.notes.filter((note) => !note.startsWith("Status")).map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
          </li>)}
        </ul>
        {preview.left_behind.length > 0 && <p className="text-sm text-muted-foreground">{preview.left_behind.length} issue(s) stay in {source.key} without an epic.</p>}
        {preview.assignees_added > 0 && <p className="text-sm text-muted-foreground">{preview.assignees_added} assignee(s) will be added to {preview.target.key}.</p>}
        {preview.people_losing_access.length > 0 && <Alert>
          <AlertTitle>These people will lose access</AlertTitle>
          <AlertDescription>{preview.people_losing_access.join(", ")} can't see {preview.target.key}, so they stop watching these issues.</AlertDescription>
        </Alert>}
      </div>}
    </div>
  </Modal>;
}
