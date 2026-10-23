import { useState, type FormEvent } from "react";
import { api } from "@/api/client";
import { pmError, type PmPerson, type PmProject } from "@/api/pm";
import { useAuth } from "@/auth/AuthContext";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { ErrorState } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useFetch } from "@/hooks/useApi";

export function CreateProject({ onClose, onCreated }: { onClose: () => void; onCreated: (project: PmProject) => void }) {
  const { user } = useAuth();
  const people = useFetch<PmPerson[]>("/api/pm/people");
  const [form, setForm] = useState({ key: "", name: "", description: "", lead: user?.id ?? "", start: "", target: "", mode: "scrum" });
  const [state, setState] = useState({ busy: false, error: "" });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      const project = await api<PmProject>("/api/pm/projects", { method: "POST", body: {
        key: form.key.trim().toUpperCase(), name: form.name.trim(), description: form.description.trim() || null,
        lead_id: form.lead || null, start_date: form.start || null, target_date: form.target || null,
        sprints_enabled: form.mode === "scrum",
      } });
      onCreated(project);
    } catch (cause) {
      setState({ busy: false, error: pmError(cause) });
    }
  }

  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>The lead becomes the project administrator and can add the team.</DialogDescription>
      </DialogHeader>
      <form id="pm-project-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
        <FieldGroup className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field>
            <FieldLabel htmlFor="pm-project-key">Key</FieldLabel>
            <Input id="pm-project-key" value={form.key} required maxLength={10} pattern="[A-Za-z][A-Za-z0-9]{1,9}" placeholder="LIMS"
              onChange={(event) => set("key", event.target.value.toUpperCase())} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pm-project-name">Name</FieldLabel>
            <Input id="pm-project-name" value={form.name} required maxLength={255} onChange={(event) => set("name", event.target.value)} />
          </Field>
          <FieldDescription className="sm:col-span-2">The key prefixes every issue, for example {(form.key || "LIMS")}-12. It can't be changed later.</FieldDescription>
          <div className="sm:col-span-2"><TaskChoice id="pm-project-mode" label="Starting board" value={form.mode} items={[{ value: "scrum", label: "Scrum · sprints and backlog" }, { value: "kanban", label: "Kanban · continuous flow" }]} onChange={(value) => set("mode", value)} /></div>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="pm-project-description">Description</FieldLabel>
            <Textarea id="pm-project-description" rows={3} value={form.description} onChange={(event) => set("description", event.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            {people.error ? <ErrorState message={people.error} onRetry={people.reload} /> :
              <TaskChoice id="pm-project-lead" label="Project lead" value={form.lead} disabled={people.loading}
                items={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} onChange={(value) => set("lead", value)} />}
          </div>
          <Field>
            <FieldLabel htmlFor="pm-project-start">Start date</FieldLabel>
            <Input id="pm-project-start" type="date" value={form.start} onChange={(event) => set("start", event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pm-project-target">Target date</FieldLabel>
            <Input id="pm-project-target" type="date" value={form.target} onChange={(event) => set("target", event.target.value)} />
          </Field>
        </FieldGroup>
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button>
        <Button type="submit" form="pm-project-form" disabled={state.busy}>{state.busy && <Spinner data-icon="inline-start" />}Create project</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
