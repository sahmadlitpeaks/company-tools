import { useState } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { ApprovalWorkflow, WorkflowStep } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

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

  async function toggle(w: ApprovalWorkflow) {
    await api(`/api/approval-workflows/${w.id}`, { method: "PATCH", body: { active: !w.active } });
    workflows.reload();
  }
  async function del(w: ApprovalWorkflow) {
    if (!confirm(`Delete the ${w.type} workflow "${w.name}"?`)) return;
    await api(`/api/approval-workflows/${w.id}`, { method: "DELETE" });
    workflows.reload();
  }

  return (
    <div>
      <PageHead
        title="Approval Workflows"
        subtitle="Configure multi-step approval chains per request type."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setCreating(true)}>
            <Plus size={15} /> New workflow
          </button>
        }
      />
      <p className="muted text-sm">
        When a request of a type has an active workflow, it routes step-by-step instead of to a single approver.
        Steps with no resolvable approver (e.g. a manager step for someone with no manager) are skipped.
      </p>
      {workflows.loading ? (
        <Loading />
      ) : (workflows.data?.length ?? 0) === 0 ? (
        <div className="card"><Empty icon="🔀" message="No workflows configured" hint="Requests use the classic single-approver flow until you add one." /></div>
      ) : (
        <div className="space-y-3">
          {workflows.data!.map((w) => (
            <div key={w.id} className="card">
              <div className="spread">
                <div>
                  <div className="font-semibold">{w.name} <span className="badge capitalize">{w.type}</span> {!w.active && <span className="badge">paused</span>}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-1 text-sm">
                    {w.steps.map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        <span className="badge violet">{stepLabel(s)}</span>
                        {i < w.steps.length - 1 && <ArrowRight size={13} className="text-ink-muted" />}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
                  <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => toggle(w)}>{w.active ? "Pause" : "Resume"}</button>
                  <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(w)}><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); workflows.reload(); notify("Workflow created."); }} />}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [type, setType] = useState("expense");
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<{ approver: string; min_amount: string }[]>([{ approver: "manager", min_amount: "" }]);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || steps.length === 0) { notify("Name and at least one step required", "error"); return; }
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <Modal title="New approval workflow" onClose={onClose} maxWidth={520}>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Request type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </div>
        <div className="field" style={{ flex: 2 }}><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Expense approval" /></div>
      </div>
      <label className="muted text-xs">Steps (in order)</label>
      {steps.map((s, i) => (
        <div key={i} className="mt-1 flex items-center gap-1">
          <span className="muted text-xs">{i + 1}.</span>
          <select className="!w-auto" value={s.approver} onChange={(e) => setSteps((a) => a.map((x, j) => j === i ? { ...x, approver: e.target.value } : x))}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input className="!w-32" type="number" placeholder="Min amount" value={s.min_amount} onChange={(e) => setSteps((a) => a.map((x, j) => j === i ? { ...x, min_amount: e.target.value } : x))} />
          <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => setSteps((a) => a.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="btn-sm mt-1" style={{ flex: "0 0 auto" }} onClick={() => setSteps((a) => [...a, { approver: "hr", min_amount: "" }])}>+ Add step</button>
      <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </Modal>
  );
}
