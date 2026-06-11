import { useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { api } from "../api/client";
import type { BenefitEnrollment, BenefitPlan, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

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

  async function delPlan(p: BenefitPlan) {
    if (!confirm(`Delete plan "${p.name}" and all its enrollments?`)) return;
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
            <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEditPlan("new")}>
              <Plus size={15} /> New plan
            </button>
          ) : undefined
        }
      />

      <div className="row mb-4" style={{ gap: 8 }}>
        <button className={tab === "plans" ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setTab("plans")}>Plans</button>
        <button className={tab === "enrollments" ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setTab("enrollments")}>Enrollments</button>
      </div>

      {tab === "plans" ? (
        plans.loading ? (
          <Loading />
        ) : (plans.data?.length ?? 0) === 0 ? (
          <div className="card"><Empty icon="🩺" message="No benefit plans yet" hint="Add a plan employees can enroll in." /></div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {plans.data!.map((p) => (
              <div key={p.id} className="card">
                <div className="spread">
                  <div>
                    <div className="font-semibold">{p.name} {!p.active && <span className="badge gray">inactive</span>}</div>
                    <div className="muted text-sm capitalize">{p.category}{p.carrier ? ` · ${p.carrier}` : ""}</div>
                  </div>
                  <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
                    <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setEditPlan(p)}>Edit</button>
                    <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => delPlan(p)}><Trash2 size={13} /></button>
                  </div>
                </div>
                {p.description && <p className="muted text-sm mt-2">{p.description}</p>}
                <div className="row mt-3 text-sm" style={{ gap: 16 }}>
                  <span>Employee: <strong>{money(p.employee_cost, p.currency)}</strong>/mo</span>
                  <span>Employer: <strong>{money(p.employer_cost, p.currency)}</strong>/mo</span>
                  <span className="inline-flex items-center gap-1"><Users size={13} /> {p.enrolled_count} enrolled</span>
                </div>
              </div>
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
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      const body = { ...f, name: f.name.trim() };
      if (plan) await api(`/api/benefits/plans/${plan.id}`, { method: "PATCH", body });
      else await api("/api/benefits/plans", { method: "POST", body });
      notify("Plan saved.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={plan ? "Edit plan" : "New benefit plan"} onClose={onClose} maxWidth={560}>
      <div className="field"><label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Category</label>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}><label>Carrier</label><input value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })} /></div>
      </div>
      <div className="field"><label>Description</label><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ flex: 1 }}><label>Employee cost/mo</label><input type="number" step="0.01" value={f.employee_cost} onChange={(e) => setF({ ...f, employee_cost: e.target.value })} /></div>
        <div className="field" style={{ flex: 1 }}><label>Employer cost/mo</label><input type="number" step="0.01" value={f.employer_cost} onChange={(e) => setF({ ...f, employer_cost: e.target.value })} /></div>
        <div className="field" style={{ width: 90 }}><label>Currency</label><input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></div>
      </div>
      <div className="row" style={{ gap: 16 }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={f.enrollment_open} onChange={(e) => setF({ ...f, enrollment_open: e.target.checked })} /> Enrollment open</label>
      </div>
      <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

function EnrollmentsTab({ plans }: { plans: BenefitPlan[] }) {
  const { notify } = useToast();
  const enrollments = useFetch<BenefitEnrollment[]>("/api/benefits/enrollments");
  const [adding, setAdding] = useState(false);

  async function update(e: BenefitEnrollment, status: string) {
    try {
      await api(`/api/benefits/enrollments/${e.id}`, { method: "PATCH", body: { status } });
      enrollments.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(e: BenefitEnrollment) {
    if (!confirm("Remove this enrollment?")) return;
    try {
      await api(`/api/benefits/enrollments/${e.id}`, { method: "DELETE" });
      enrollments.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <div className="card">
      <div className="spread mb-3">
        <h3 className="m-0">Enrollments</h3>
        <button className="btn-sm btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setAdding(true)}><Plus size={14} /> Enroll employee</button>
      </div>
      {enrollments.loading ? (
        <Loading />
      ) : (enrollments.data?.length ?? 0) === 0 ? (
        <Empty icon="📝" message="No enrollments yet" hint="Enroll an employee into a plan." />
      ) : (
        <table className="table">
          <thead><tr><th>Employee</th><th>Plan</th><th>Coverage</th><th>Cost/mo</th><th>Status</th><th /></tr></thead>
          <tbody>
            {enrollments.data!.map((e) => (
              <tr key={e.id}>
                <td className="font-medium">{e.employee_name}</td>
                <td>{e.plan_name} <span className="muted capitalize">· {e.category}</span></td>
                <td className="capitalize">{e.coverage_level.replace(/_/g, " ")}</td>
                <td>{money(e.elected_cost, e.currency ?? undefined)}</td>
                <td>
                  <select className="!w-auto" value={e.status} onChange={(ev) => update(e, ev.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="text-right"><button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(e)}><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {adding && <EnrollModal plans={plans} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); enrollments.reload(); }} />}
    </div>
  );
}

function EnrollModal({ plans, onClose, onSaved }: { plans: BenefitPlan[]; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const people = useFetch<User[]>("/api/users");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [userId, setUserId] = useState("");
  const [coverage, setCoverage] = useState("employee");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!planId || !userId) { notify("Pick a plan and employee", "error"); return; }
    setBusy(true);
    try {
      await api("/api/benefits/enrollments", { method: "POST", body: { plan_id: planId, user_id: userId, coverage_level: coverage } });
      notify("Employee enrolled.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="Enroll employee" onClose={onClose} maxWidth={480}>
      <div className="field">
        <label>Plan</label>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Employee</label>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Select…</option>
          {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Coverage level</label>
        <select value={coverage} onChange={(e) => setCoverage(e.target.value)}>
          {COVERAGE.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Enroll"}</button>
      </div>
    </Modal>
  );
}
