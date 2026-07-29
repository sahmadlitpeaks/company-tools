import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { ArrowRight, Plus, Trash2, Workflow } from "lucide-react";
import { api } from "../api/client";
import type { ApprovalWorkflow, WorkflowStep } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const TYPES = ["leave", "expense", "purchase", "document", "access", "general"];
const KINDS = ["manager", "hr", "admin"];

function stepLabel(s: WorkflowStep): string {
  const base = s.approver === "manager" ? "Manager" : s.approver === "hr" ? "HR" : s.approver === "admin" ? "Admin" : "User";
  return s.min_amount ? `${base} (≥ ${s.min_amount})` : base;
}

export default function ApprovalWorkflowsPage() {
  const { notify } = useToast();
  const workflows = useFetch<ApprovalWorkflow[]>("/api/approval-workflows");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApprovalWorkflow | null>(null);

  async function toggle(w: ApprovalWorkflow) {
    await api(`/api/approval-workflows/${w.id}`, { method: "PATCH", body: { active: !w.active } });
    workflows.reload();
  }
  async function del(w: ApprovalWorkflow) {
    await api(`/api/approval-workflows/${w.id}`, { method: "DELETE" });
    workflows.reload();
  }

  return (
    <div>
      <PageHead
        title="Approval Workflows"
        subtitle="Configure multi-step approval chains per request type."
        action={
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" /> New workflow
          </Button>
        }
      />
      <p className="text-sm text-muted-foreground">
        When a request of a type has an active workflow, it routes step-by-step instead of to a single approver.
        Steps with no resolvable approver (e.g. a manager step for someone with no manager) are skipped.
      </p>
      {workflows.loading ? (
        <Loading />
      ) : (workflows.data?.length ?? 0) === 0 ? (
        <Card><CardContent><Empty icon={<Workflow />} message="No workflows configured" hint="Requests use the classic single-approver flow until you add one." /></CardContent></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {workflows.data!.map((w) => (
            <Card key={w.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">{w.name} <Badge className="capitalize">{w.type}</Badge> {!w.active && <Badge variant="secondary">paused</Badge>}</CardTitle>
                <CardAction className="flex gap-2">
                  <Button aria-label="Toggle" type="button" variant="outline" size="sm" onClick={() => toggle(w)}>{w.active ? "Pause" : "Resume"}</Button>
                  <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleteTarget(w)}><Trash2 /></Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                  <div className="flex flex-wrap items-center gap-1 text-sm">
                    {w.steps.map((s, i) => (
                      <span key={`${stepLabel(s)}-${s.min_amount ?? "any"}`} className="inline-flex items-center gap-1">
                        <Badge variant="secondary">{stepLabel(s)}</Badge>
                        {i < w.steps.length - 1 && <ArrowRight className="text-muted-foreground" />}
                      </span>
                    ))}
                  </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); workflows.reload(); notify("Workflow created."); }} />}
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete workflow "${deleteTarget.name}"?`}
          message={`Delete the ${deleteTarget.type} workflow "${deleteTarget.name}"?`}
          confirmLabel="Delete workflow"
          danger
          onConfirm={() => del(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [type, setType] = useState("expense");
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<{ id: string; approver: string; min_amount: string }[]>([
    { id: crypto.randomUUID(), approver: "manager", min_amount: "" },
  ]);
  const [removeStepId, setRemoveStepId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const removeStepIndex = steps.findIndex((step) => step.id === removeStepId);
  const removeStep = removeStepIndex >= 0 ? steps[removeStepIndex] : null;

  async function save() {
    if (!name.trim() || steps.length === 0) { notify("Name and at least one step required", "error"); return; }
    setIsSubmitting(true);
    try {
      await api("/api/approval-workflows", {
        method: "POST",
        body: {
          type, name: name.trim(),
          steps: steps.map((s) => ({ approver: s.approver, min_amount: s.min_amount ? Number(s.min_amount) : null })),
        },
      });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="New approval workflow" onClose={onClose} maxWidth={520}>
      <FieldGroup>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="rd-approvalworkflowspage-109-request-type">Request type</FieldLabel>
          <Select items={TYPES.map((t) => ({ value: t, label: t }))} value={type} onValueChange={(value) => setType(value ?? "")}>
            <SelectTrigger className="w-full" id="rd-approvalworkflowspage-109-request-type"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        <Field className="sm:col-span-2"><FieldLabel htmlFor="rd-approvalworkflowspage-112-name">Name</FieldLabel><Input id="rd-approvalworkflowspage-112-name" aria-label="e.g. Expense approval" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Expense approval" /></Field>
      </div>
      <Field>
      <FieldLabel htmlFor="rd-approvalworkflowspage-114-muted-text-xs-steps-in-order">Steps (in order)</FieldLabel>
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{i + 1}.</span>
          <Select items={KINDS.map((k) => ({ value: k, label: k }))} value={s.approver} onValueChange={(value) => setSteps((a) => a.map((x, j) => j === i ? { ...x, approver: value ?? "" } : x))}>
            <SelectTrigger id={`rd-approvalworkflowspage-step-${i}-approver`} aria-label={`Approver for step ${i + 1}`}><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <Input aria-label="Min amount" className="w-32" type="number" placeholder="Min amount" value={s.min_amount} onChange={(e) => setSteps((a) => a.map((x, j) => j === i ? { ...x, min_amount: e.target.value } : x))} />
           <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setRemoveStepId(s.id)}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => setSteps((a) => [...a, { id: crypto.randomUUID(), approver: "hr", min_amount: "" }])}>+ Add step</Button>
      </Field>
      </FieldGroup>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Creating…" : "Create"}</Button>
      </div>
      {removeStep && (
        <ConfirmDialog
          title={`Remove approval step ${removeStepIndex + 1}?`}
          message={`Remove step ${removeStepIndex + 1}, assigned to ${removeStep.approver}?`}
          confirmLabel="Remove step"
          danger
          onConfirm={() => setSteps((current) => current.filter((step) => step.id !== removeStep.id))}
          onClose={() => setRemoveStepId(null)}
        />
      )}
    </Modal>
  );
}
