import { useState } from "react";
import { Banknote, Download, Plus, Trash2 } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { Payslip, PayrollRun } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

function money(v: string | number | null | undefined, ccy?: string) {
  if (v == null) return "—";
  return `${ccy ?? ""} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

export default function PayrollPage() {
  const { notify } = useToast();
  const runs = useFetch<PayrollRun[]>("/api/payroll/runs");
  const [open, setOpen] = useState<PayrollRun | null>(null);
  const [period, setPeriod] = useState("");
  const [creating, setCreating] = useState(false);

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    if (!period) return;
    try {
      await api("/api/payroll/runs", { method: "POST", body: { period } });
      setPeriod(""); setCreating(false);
      runs.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(r: PayrollRun) {
    if (!confirm(`Delete the ${r.period} draft run?`)) return;
    try {
      await api(`/api/payroll/runs/${r.id}`, { method: "DELETE" });
      runs.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  if (open) return <RunDetail run={open} onBack={() => { setOpen(null); runs.reload(); }} />;

  return (
    <div>
      <PageHead
        title="Payroll"
        subtitle="Monthly payroll runs, payslips and register export."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setCreating(true)}>
            <Plus size={15} /> New run
          </button>
        }
      />
      {creating && (
        <form onSubmit={createRun} className="card mb-4 row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0 }}><label>Period (month)</label><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
          <button className="btn-primary" style={{ flex: "0 0 auto" }}>Generate payslips</button>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={() => setCreating(false)}>Cancel</button>
          <span className="muted text-sm">Draws each active employee's latest salary.</span>
        </form>
      )}
      {runs.loading ? (
        <Loading />
      ) : (runs.data?.length ?? 0) === 0 ? (
        <div className="card"><Empty icon="💷" message="No payroll runs yet" hint="Create a run for a month to generate payslips." /></div>
      ) : (
        <div className="card">
          <table className="table">
            <thead><tr><th>Period</th><th>Status</th><th>Payslips</th><th>Total net</th><th /></tr></thead>
            <tbody>
              {runs.data!.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => setOpen(r)}>
                  <td className="font-semibold">{r.period}</td>
                  <td><span className={`badge ${r.status === "finalized" ? "green" : "amber"}`}>{r.status}</span></td>
                  <td>{r.payslip_count}</td>
                  <td>{money(r.total_net)}</td>
                  <td className="text-right">
                    {r.status === "draft" && (
                      <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={(e) => { e.stopPropagation(); del(r); }}><Trash2 size={13} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunDetail({ run, onBack }: { run: PayrollRun; onBack: () => void }) {
  const { notify } = useToast();
  const slips = useFetch<{ run: PayrollRun; payslips: Payslip[] }>(`/api/payroll/runs/${run.id}`);
  const [edit, setEdit] = useState<Payslip | null>(null);
  const finalized = run.status === "finalized";

  async function finalize() {
    if (!confirm("Finalize this run? Payslips lock and become visible to employees.")) return;
    try {
      await api(`/api/payroll/runs/${run.id}/finalize`, { method: "POST" });
      notify("Payroll finalized.");
      onBack();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <div>
      <PageHead
        title={`Payroll · ${run.period}`}
        subtitle={finalized ? "Finalized" : "Draft — add line items, then finalize"}
        action={
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            <button className="btn" style={{ flex: "0 0 auto" }} onClick={onBack}>← All runs</button>
            <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }}
              onClick={() => downloadFile(`/api/payroll/runs/${run.id}/register.csv`, `payroll-${run.period}.csv`).catch(() => notify("Export failed", "error"))}>
              <Download size={15} /> Register CSV
            </button>
            {finalized && (
              <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }}
                onClick={() => downloadFile(`/api/payroll/runs/${run.id}/bank.csv`, `payments-${run.period}.csv`).catch(() => notify("Export failed", "error"))}>
                <Download size={15} /> Bank file
              </button>
            )}
            {!finalized && <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={finalize}><Banknote size={15} /> Finalize</button>}
          </div>
        }
      />
      {slips.loading ? (
        <Loading />
      ) : (
        <div className="card">
          <table className="table">
            <thead><tr><th>Employee</th><th>Base</th><th>Gross</th><th>Deductions</th><th>Net</th><th /></tr></thead>
            <tbody>
              {slips.data!.payslips.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.employee_name}</td>
                  <td>{money(s.base_salary, s.currency)}</td>
                  <td>{money(s.gross, s.currency)}</td>
                  <td>{money(s.deductions, s.currency)}</td>
                  <td className="font-semibold">{money(s.net, s.currency)}</td>
                  <td className="text-right">
                    <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                      {!finalized && <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setEdit(s)}>Adjust</button>}
                      {finalized && (
                        <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }}
                          onClick={() => downloadFile(`/api/payroll/payslips/${s.id}/pdf`, `payslip-${run.period}.pdf`).catch(() => notify("Download failed", "error"))}>
                          <Download size={13} /> PDF
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <PayslipModal slip={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); slips.reload(); }} />}
    </div>
  );
}

function PayslipModal({ slip, onClose, onSaved }: { slip: Payslip; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [items, setItems] = useState(slip.items.map((i) => ({ ...i })));
  const [busy, setBusy] = useState(false);

  function set(idx: number, patch: Partial<{ label: string; amount: string; kind: string }>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/api/payroll/payslips/${slip.id}`, {
        method: "PATCH",
        body: { items: items.filter((i) => i.label.trim() && i.amount).map((i) => ({ label: i.label.trim(), amount: i.amount, kind: i.kind })) },
      });
      notify("Payslip updated.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Adjust — ${slip.employee_name}`} onClose={onClose} maxWidth={520}>
      <p className="muted text-sm">Base salary {money(slip.base_salary, slip.currency)}. Add earnings or deductions:</p>
      <div className="my-2 space-y-1">
        {items.map((it, i) => (
          <div key={i} className="flex gap-1">
            <input className="flex-1" placeholder="Label" value={it.label} onChange={(e) => set(i, { label: e.target.value })} />
            <input className="!w-24" type="number" step="0.01" placeholder="Amount" value={it.amount} onChange={(e) => set(i, { amount: e.target.value })} />
            <select className="!w-auto" value={it.kind} onChange={(e) => set(i, { kind: e.target.value })}>
              <option value="earning">earning</option>
              <option value="deduction">deduction</option>
            </select>
            <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => setItems((a) => a.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setItems((a) => [...a, { label: "", amount: "", kind: "earning" }])}>+ Add line</button>
      <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}
