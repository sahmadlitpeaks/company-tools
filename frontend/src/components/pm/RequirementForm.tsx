import { useState, type FormEvent } from "react";
import { api } from "@/api/client";
import { pmError, type PmMember, type PmProject } from "@/api/pm";
import { REQUIREMENT_SECTIONS, REQUIREMENT_STATUSES, type RequirementContent, type RequirementDetailData } from "@/api/pm-requirements";
import { useAuth } from "@/auth/AuthContext";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function RequirementForm({ project, members, requirement, onClose, onSaved }: {
  project: PmProject; members: PmMember[]; requirement?: RequirementDetailData;
  onClose: () => void; onSaved: (row: RequirementDetailData) => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<RequirementContent>(() => ({
    title: requirement?.title ?? "", original_request: requirement?.original_request ?? "", context: requirement?.context ?? "",
    functional_requirements: requirement?.functional_requirements ?? "", technical_requirements: requirement?.technical_requirements ?? "",
    scope: requirement?.scope ?? "", expected_outcome: requirement?.expected_outcome ?? "", acceptance_criteria: requirement?.acceptance_criteria ?? "",
    supporting_information: requirement?.supporting_information ?? "", status: requirement?.status ?? "draft",
    owner_id: requirement ? requirement.owner_id : members.some((m) => m.user_id === user?.id && m.role !== "viewer") ? user!.id : null,
  }));
  const [state, setState] = useState({ busy: false, error: "" });
  async function save(event: FormEvent) {
    event.preventDefault(); setState({ busy: true, error: "" });
    try {
      const row = await api<RequirementDetailData>(requirement ? `/api/pm/requirements/${requirement.id}` : `/api/pm/projects/${project.id}/requirements`, {
        method: requirement ? "PATCH" : "POST", body: { ...form, ...(requirement ? { version: requirement.version } : {}) },
      });
      onSaved(row);
    } catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}>
    <DialogContent className="flex max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border p-4 pr-12 sm:px-6"><DialogTitle>{requirement ? `Edit ${requirement.key}` : "Create requirement"}</DialogTitle>
        <DialogDescription>{project.name} · Capture the request here, then break it into linked tasks.</DialogDescription></DialogHeader>
      <form onSubmit={(event) => void save(event)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 overflow-y-auto p-4 sm:px-6"><FieldGroup>
          {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error} Your changes have not been saved. {requirement && "Close this form and refresh the requirement if it changed elsewhere."}</AlertDescription></Alert>}
          <Field><FieldLabel htmlFor="requirement-title">Title</FieldLabel><Input id="requirement-title" required maxLength={255} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <TaskChoice id="requirement-owner" label="Owner" value={form.owner_id ?? ""} items={[{ value: "", label: "Unassigned" }, ...members.filter((m) => m.role !== "viewer").map((m) => ({ value: m.user_id, label: m.name }))]} onChange={(value) => setForm({ ...form, owner_id: value || null })} />
            <TaskChoice id="requirement-status" label="Requirement status" value={form.status} items={[...REQUIREMENT_STATUSES]} onChange={(value) => setForm({ ...form, status: value as RequirementContent["status"] })} />
          </div>
          <FieldDescription>Save an incomplete brief as a draft. Before marking it ready, complete the original request, context, functional requirements, scope, expected outcome and acceptance criteria.</FieldDescription>
          {REQUIREMENT_SECTIONS.map((section) => <Field key={section.key}>
            <FieldLabel htmlFor={`requirement-${section.key}`}>{section.label}</FieldLabel>
            <Textarea id={`requirement-${section.key}`} rows={3} maxLength={50000} value={form[section.key]} onChange={(e) => setForm({ ...form, [section.key]: e.target.value })} />
            <FieldDescription>{section.hint}</FieldDescription>
          </Field>)}
        </FieldGroup></div>
        <DialogFooter className="shrink-0 border-t border-border bg-muted/30 p-4 sm:px-6"><Button type="button" variant="outline" disabled={state.busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={state.busy || !form.title.trim()}>{state.busy ? "Saving…" : "Save requirement"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
