import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState } from "react";
import { FileText, HeartPulse, Plus, Trash2, Users } from "lucide-react";
import { api } from "../api/client";
import type { BenefitEnrollment, BenefitPlan, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const CATEGORIES = [
  "health", "dental", "vision", "life", "disability", "retirement", "wellness", "other",
];
const COVERAGE = ["employee", "employee_spouse", "employee_children", "family"];
const STATUSES = ["enrolled", "pending", "waived", "terminated"];

function money(v: string | number | null | undefined, ccy?: string) {
  if (v == null) return "—";
  return `${ccy ?? ""} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

export default function BenefitsPage() {
  const { notify } = useToast();
  const plans = useFetch<BenefitPlan[]>("/api/benefits/plans?include_inactive=true");
  const [tab, setTab] = useState<"plans" | "enrollments">("plans");
  const [editPlan, setEditPlan] = useState<BenefitPlan | "new" | null>(null);
  const [deletePlanTarget, setDeletePlanTarget] = useState<BenefitPlan | null>(null);

  async function delPlan(p: BenefitPlan) {
    try {
      await api(`/api/benefits/plans/${p.id}`, { method: "DELETE" });
      plans.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <div>
      <PageHead
        title="Benefits"
        subtitle="Plans, employee enrollments and dependents."
        action={
          tab === "plans" ? (
            <Button type="button" onClick={() => setEditPlan("new")}><Plus data-icon="inline-start" /> New plan</Button>
          ) : undefined
        }
      />

      <ToggleGroup className="mb-4" value={[tab]} onValueChange={(value) => value[0] && setTab(value[0] as "plans" | "enrollments")}><ToggleGroupItem value="plans">Plans</ToggleGroupItem><ToggleGroupItem value="enrollments">Enrollments</ToggleGroupItem></ToggleGroup>

      {tab === "plans" ? (
        plans.loading ? (
          <Loading />
        ) : (plans.data?.length ?? 0) === 0 ? (
          <Card><CardContent><Empty icon={<HeartPulse />} message="No benefit plans yet" hint="Add a plan employees can enroll in." /></CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {plans.data!.map((p) => (
              <Card key={p.id}>
                <CardHeader><CardTitle>{p.name} {!p.active && <Badge variant="secondary">inactive</Badge>}</CardTitle><div className="text-sm capitalize text-muted-foreground">{p.category}{p.carrier ? ` · ${p.carrier}` : ""}</div><CardAction className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setEditPlan(p)}>Edit</Button><Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeletePlanTarget(p)}><Trash2 /></Button></CardAction></CardHeader>
                {p.description && <CardContent className="text-sm text-muted-foreground">{p.description}</CardContent>}
                <CardFooter className="flex flex-wrap gap-4 text-sm">
                  <span>Employee: <strong>{money(p.employee_cost, p.currency)}</strong>/mo</span>
                  <span>Employer: <strong>{money(p.employer_cost, p.currency)}</strong>/mo</span>
                  <span className="inline-flex items-center gap-1"><Users /> {p.enrolled_count} enrolled</span>
                </CardFooter>
              </Card>
            ))}
          </div>
        )
      ) : (
        <EnrollmentsTab plans={plans.data ?? []} />
      )}

      {editPlan && (
        <PlanModal
          plan={editPlan === "new" ? null : editPlan}
          onClose={() => setEditPlan(null)}
          onSaved={() => { setEditPlan(null); plans.reload(); }}
        />
      )}
      {deletePlanTarget && (
        <ConfirmDialog
          title={`Delete benefit plan "${deletePlanTarget.name}"?`}
          message={`Delete "${deletePlanTarget.name}" and all of its enrollments?`}
          confirmLabel="Delete plan"
          danger
          onConfirm={() => delPlan(deletePlanTarget)}
          onClose={() => setDeletePlanTarget(null)}
        />
      )}
    </div>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: BenefitPlan | null; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [f, setF] = useState({
    name: plan?.name ?? "",
    category: plan?.category ?? "health",
    carrier: plan?.carrier ?? "",
    description: plan?.description ?? "",
    currency: plan?.currency ?? "USD",
    employee_cost: String(plan?.employee_cost ?? "0"),
    employer_cost: String(plan?.employer_cost ?? "0"),
    active: plan?.active ?? true,
    enrollment_open: plan?.enrollment_open ?? true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function save() {
    if (!f.name.trim()) return;
    setIsSubmitting(true);
    try {
      const body = { ...f, name: f.name.trim() };
      if (plan) await api(`/api/benefits/plans/${plan.id}`, { method: "PATCH", body });
      else await api("/api/benefits/plans", { method: "POST", body });
      notify("Plan saved.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={plan ? "Edit plan" : "New benefit plan"} onClose={onClose} maxWidth={560}>
      <FieldGroup>
      <Field><FieldLabel htmlFor="rd-benefitspage-130-name">Name</FieldLabel><Input id="rd-benefitspage-130-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="rd-benefitspage-133-category">Category</FieldLabel><Select items={CATEGORIES.map((c) => ({ value: c, label: c }))} value={f.category} onValueChange={(value) => setF({ ...f, category: value ?? "" })}><SelectTrigger className="w-full" id="rd-benefitspage-133-category"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="rd-benefitspage-138-carrier">Carrier</FieldLabel><Input id="rd-benefitspage-138-carrier" value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })} /></Field>
      </div>
      <Field><FieldLabel htmlFor="rd-benefitspage-140-description">Description</FieldLabel><Textarea id="rd-benefitspage-140-description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field><FieldLabel htmlFor="rd-benefitspage-142-employee-cost-mo">Employee cost/mo</FieldLabel><Input id="rd-benefitspage-142-employee-cost-mo" type="number" step="0.01" value={f.employee_cost} onChange={(e) => setF({ ...f, employee_cost: e.target.value })} /></Field>
        <Field><FieldLabel htmlFor="rd-benefitspage-143-employer-cost-mo">Employer cost/mo</FieldLabel><Input id="rd-benefitspage-143-employer-cost-mo" type="number" step="0.01" value={f.employer_cost} onChange={(e) => setF({ ...f, employer_cost: e.target.value })} /></Field>
        <Field><FieldLabel htmlFor="rd-benefitspage-144-currency">Currency</FieldLabel><Input id="rd-benefitspage-144-currency" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <FieldLabel className="flex items-center gap-2"><Checkbox checked={f.active} onCheckedChange={(checked) => setF({ ...f, active: checked })} /> Active</FieldLabel>
        <FieldLabel className="flex items-center gap-2"><Checkbox checked={f.enrollment_open} onCheckedChange={(checked) => setF({ ...f, enrollment_open: checked })} /> Enrollment open</FieldLabel>
      </div>
      </FieldGroup>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

function EnrollmentsTab({ plans }: { plans: BenefitPlan[] }) {
  const { notify } = useToast();
  const enrollments = useFetch<BenefitEnrollment[]>("/api/benefits/enrollments");
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BenefitEnrollment | null>(null);

  async function update(e: BenefitEnrollment, status: string) {
    try {
      await api(`/api/benefits/enrollments/${e.id}`, { method: "PATCH", body: { status } });
      enrollments.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(e: BenefitEnrollment) {
    try {
      await api(`/api/benefits/enrollments/${e.id}`, { method: "DELETE" });
      enrollments.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <Card className="py-0">
      <CardHeader className="py-(--card-spacing)"><CardTitle>Enrollments</CardTitle><CardAction><Button type="button" size="sm" onClick={() => setAdding(true)}><Plus data-icon="inline-start" /> Enroll employee</Button></CardAction></CardHeader>
      {enrollments.loading ? (
        <CardContent><Loading /></CardContent>
      ) : (enrollments.data?.length ?? 0) === 0 ? (
        <CardContent><Empty icon={<FileText />} message="No enrollments yet" hint="Enroll an employee into a plan." /></CardContent>
      ) : (
        <CardContent className="p-0"><Table>
          <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Plan</TableHead><TableHead>Coverage</TableHead><TableHead className="text-right">Cost/mo</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {enrollments.data!.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.employee_name}</TableCell>
                <TableCell>{e.plan_name} <span className="capitalize text-muted-foreground">· {e.category}</span></TableCell>
                <TableCell className="capitalize">{e.coverage_level.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-right tabular-nums">{money(e.elected_cost, e.currency ?? undefined)}</TableCell>
                <TableCell><Select items={STATUSES.map((s) => ({ value: s, label: s }))} value={e.status} onValueChange={(value) => value !== null && update(e, value)}><SelectTrigger aria-label={`Status for ${e.employee_name}`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectGroup></SelectContent></Select></TableCell>
                <TableCell className="text-right"><Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleteTarget(e)}><Trash2 /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></CardContent>
      )}
      {adding && <EnrollModal plans={plans} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); enrollments.reload(); }} />}
      {deleteTarget && (
        <ConfirmDialog
          title={`Remove ${deleteTarget.employee_name} from "${deleteTarget.plan_name}"?`}
          message={`Remove ${deleteTarget.employee_name}'s enrollment in "${deleteTarget.plan_name}"?`}
          confirmLabel="Remove enrollment"
          danger
          onConfirm={() => del(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </Card>
  );
}

function EnrollModal({ plans, onClose, onSaved }: { plans: BenefitPlan[]; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const people = useFetch<User[]>("/api/users");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [userId, setUserId] = useState("");
  const [coverage, setCoverage] = useState("employee");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function save() {
    if (!planId || !userId) { notify("Pick a plan and employee", "error"); return; }
    setIsSubmitting(true);
    try {
      await api("/api/benefits/enrollments", { method: "POST", body: { plan_id: planId, user_id: userId, coverage_level: coverage } });
      notify("Employee enrolled.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Enroll employee" onClose={onClose} maxWidth={480}>
      <FieldGroup>
      <Field><FieldLabel htmlFor="rd-benefitspage-241-plan">Plan</FieldLabel><Select items={plans.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} value={planId || null} onValueChange={(value) => setPlanId(value ?? "")}><SelectTrigger className="w-full" id="rd-benefitspage-241-plan"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{plans.filter((p) => p.active).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      <Field><FieldLabel htmlFor="rd-benefitspage-247-employee">Employee</FieldLabel><Select items={[{ value: null, label: "Select…" }, ...(people.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]} value={userId || null} onValueChange={(value) => setUserId(value ?? "")}><SelectTrigger className="w-full" id="rd-benefitspage-247-employee"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Select…</SelectItem>{(people.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      <Field><FieldLabel htmlFor="rd-benefitspage-254-coverage-level">Coverage level</FieldLabel><Select items={COVERAGE.map((c) => ({ value: c, label: c.replace(/_/g, " ") }))} value={coverage} onValueChange={(value) => setCoverage(value ?? "")}><SelectTrigger className="w-full" id="rd-benefitspage-254-coverage-level"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{COVERAGE.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
      </FieldGroup>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Saving…" : "Enroll"}</Button>
      </div>
    </Modal>
  );
}
