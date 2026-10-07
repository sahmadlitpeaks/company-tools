import { useState, type FormEvent, type ReactNode } from "react";
import { addDays, format } from "date-fns";
import { api } from "@/api/client";
import { pmError, type PmProject, type PmSprint } from "@/api/pm";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const iso = (value: Date) => format(value, "yyyy-MM-dd");

function useSubmit(onDone: (sprint: PmSprint) => void) {
  const [state, setState] = useState({ busy: false, error: "" });
  async function run(request: () => Promise<PmSprint>) {
    setState({ busy: true, error: "" });
    try { onDone(await request()); }
    catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  return { state, run };
}

function Shell({ id, title, description, busy, error, submitLabel, onClose, children }: {
  id: string; title: string; description: string; busy: boolean; error: string; submitLabel: string;
  onClose: () => void; children: ReactNode;
}) {
  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {children}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" form={id} disabled={busy}>{busy && <Spinner data-icon="inline-start" />}{submitLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Create a sprint, or edit an existing one's name, goal and dates. */
export function SprintDialog({ project, sprint, onClose, onSaved }: {
  project: PmProject; sprint?: PmSprint; onClose: () => void; onSaved: (sprint: PmSprint) => void;
}) {
  const [form, setForm] = useState({ name: sprint?.name ?? "", goal: sprint?.goal ?? "", start: sprint?.start_date ?? "", end: sprint?.end_date ?? "" });
  const { state, run } = useSubmit(onSaved);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    const body = { name: form.name.trim() || null, goal: form.goal.trim() || null, start_date: form.start || null, end_date: form.end || null };
    void run(() => sprint
      ? api<PmSprint>(`/api/pm/sprints/${sprint.id}`, { method: "PATCH", body: { ...body, name: form.name.trim() || sprint.name } })
      : api<PmSprint>(`/api/pm/projects/${project.id}/sprints`, { method: "POST", body }));
  }
  return <Shell id="pm-sprint-form" title={sprint ? `Edit ${sprint.name}` : "Create sprint"} description={`${project.key} · plan the work for one time-box.`}
    busy={state.busy} error={state.error} submitLabel={sprint ? "Save sprint" : "Create sprint"} onClose={onClose}>
    <form id="pm-sprint-form" onSubmit={submit}>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="pm-sprint-name">Sprint name</FieldLabel>
          <Input id="pm-sprint-name" value={form.name} maxLength={120} placeholder={sprint ? undefined : `${project.key} Sprint …`} onChange={(event) => set("name", event.target.value)} />
          {!sprint && <FieldDescription>Leave empty to number it automatically.</FieldDescription>}
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="pm-sprint-goal">Sprint goal</FieldLabel>
          <Textarea id="pm-sprint-goal" rows={2} value={form.goal} onChange={(event) => set("goal", event.target.value)} />
        </Field>
        <Field><FieldLabel htmlFor="pm-sprint-start">Start date</FieldLabel><Input id="pm-sprint-start" type="date" value={form.start} onChange={(event) => set("start", event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="pm-sprint-end">End date</FieldLabel><Input id="pm-sprint-end" type="date" value={form.end} onChange={(event) => set("end", event.target.value)} /></Field>
      </FieldGroup>
    </form>
  </Shell>;
}

export function StartSprintDialog({ sprint, onClose, onStarted }: {
  sprint: PmSprint; onClose: () => void; onStarted: (sprint: PmSprint) => void;
}) {
  const today = new Date();
  const [form, setForm] = useState({
    start: sprint.start_date ?? iso(today),
    end: sprint.end_date ?? iso(addDays(today, 14)),
    goal: sprint.goal ?? "",
  });
  const { state, run } = useSubmit(onStarted);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(() => api<PmSprint>(`/api/pm/sprints/${sprint.id}/start`, { method: "POST", body: { start_date: form.start, end_date: form.end, goal: form.goal.trim() || null } }));
  }
  return <Shell id="pm-sprint-start" title={`Start ${sprint.name}`} description={`${sprint.issue_count} issues · ${sprint.points} story points will be committed.`}
    busy={state.busy} error={state.error} submitLabel="Start sprint" onClose={onClose}>
    <form id="pm-sprint-start" onSubmit={submit}>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="pm-start-start">Start date</FieldLabel><Input id="pm-start-start" type="date" required value={form.start} onChange={(event) => set("start", event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="pm-start-end">End date</FieldLabel><Input id="pm-start-end" type="date" required value={form.end} onChange={(event) => set("end", event.target.value)} /></Field>
        <Field className="sm:col-span-2"><FieldLabel htmlFor="pm-start-goal">Sprint goal</FieldLabel><Textarea id="pm-start-goal" rows={2} value={form.goal} onChange={(event) => set("goal", event.target.value)} /></Field>
      </FieldGroup>
    </form>
  </Shell>;
}

export function CompleteSprintDialog({ sprint, futureSprints, onClose, onCompleted }: {
  sprint: PmSprint; futureSprints: PmSprint[]; onClose: () => void; onCompleted: (sprint: PmSprint) => void;
}) {
  const [moveTo, setMoveTo] = useState("backlog");
  const { state, run } = useSubmit(onCompleted);
  const open = sprint.issue_count - sprint.done_count;
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(() => api<PmSprint>(`/api/pm/sprints/${sprint.id}/complete`, { method: "POST", body: { move_to: moveTo } }));
  }
  return <Shell id="pm-sprint-complete" title={`Complete ${sprint.name}`} description={`${sprint.done_count} done · ${open} unfinished · ${sprint.done_points} of ${sprint.points} points completed.`}
    busy={state.busy} error={state.error} submitLabel="Complete sprint" onClose={onClose}>
    <form id="pm-sprint-complete" onSubmit={submit} className="flex flex-col gap-3">
      {open > 0 ? <TaskChoice id="pm-complete-move" label="Move unfinished issues to" value={moveTo}
        items={[{ value: "backlog", label: "Backlog" }, ...futureSprints.map((s) => ({ value: s.id, label: s.name }))]} onChange={setMoveTo} />
        : <p className="text-sm text-muted-foreground">Every issue in this sprint is done.</p>}
    </form>
  </Shell>;
}
