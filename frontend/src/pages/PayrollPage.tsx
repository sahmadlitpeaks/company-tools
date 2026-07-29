import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { Banknote, Download, Plus, Trash2 } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { Payslip, PayrollRun } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<PayrollRun | null>(null);

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    if (!period) return;
    setIsSubmitting(true);
    try {
      await api("/api/payroll/runs", { method: "POST", body: { period } });
      setPeriod(""); setCreating(false);
      runs.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }
  async function del(r: PayrollRun) {
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
          <Button type="button" onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New run</Button>
        }
      />
      {creating && (
        <Card className="mb-4"><CardContent><form onSubmit={createRun} className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
          <Field><FieldLabel htmlFor="payroll-period">Period (month)</FieldLabel><Input id="payroll-period" aria-label="month" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Generating…" : "Generate payslips"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
          <span className="text-sm text-muted-foreground">Draws each active employee's latest salary.</span>
        </form></CardContent></Card>
      )}
      {runs.loading ? (
        <Loading />
      ) : (runs.data?.length ?? 0) === 0 ? (
        <Card><CardContent><Empty icon={<Banknote />} message="No payroll runs yet" hint="Create a run for a month to generate payslips." /></CardContent></Card>
      ) : (
        <Card className="py-0"><CardContent className="p-0"><Table>
            <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Payslips</TableHead><TableHead className="text-right">Total net</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {runs.data!.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Button type="button" variant="link" className="h-auto p-0 font-semibold text-foreground" onClick={() => setOpen(r)}>{r.period}</Button></TableCell>
                  <TableCell><Badge variant={r.status === "finalized" ? "success" : "warning"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{r.payslip_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.total_net)}</TableCell>
                  <TableCell className="text-right">
                    {r.status === "draft" && (
                      <Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={(e) => { e.stopPropagation(); setDeleting(r); }}><Trash2 /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></CardContent></Card>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete payroll run"
          message={`Delete the ${deleting.period} draft run?`}
          confirmLabel="Delete run"
          danger
          onConfirm={() => del(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function RunDetail({ run, onBack }: { run: PayrollRun; onBack: () => void }) {
  const { notify } = useToast();
  const slips = useFetch<{ run: PayrollRun; payslips: Payslip[] }>(`/api/payroll/runs/${run.id}`);
  const [edit, setEdit] = useState<Payslip | null>(null);
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);
  const finalized = run.status === "finalized";

  async function finalize() {
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onBack}>← All runs</Button>
            <Button type="button" variant="outline"
              onClick={() => downloadFile(`/api/payroll/runs/${run.id}/register.csv`, `payroll-${run.period}.csv`).catch(() => notify("Export failed", "error"))}>
              <Download data-icon="inline-start" /> Register CSV
            </Button>
            {finalized && (
              <Button type="button" variant="outline"
                onClick={() => downloadFile(`/api/payroll/runs/${run.id}/bank.csv`, `payments-${run.period}.csv`).catch(() => notify("Export failed", "error"))}>
                <Download data-icon="inline-start" /> Bank file
              </Button>
            )}
            {!finalized && <Button type="button" onClick={() => setConfirmingFinalize(true)}><Banknote data-icon="inline-start" /> Finalize</Button>}
          </div>
        }
      />
      {slips.loading ? (
        <Loading />
      ) : (
        <Card className="py-0"><CardContent className="p-0"><Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Deductions</TableHead><TableHead className="text-right">Net</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {slips.data!.payslips.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.employee_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(s.base_salary, s.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(s.gross, s.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(s.deductions, s.currency)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(s.net, s.currency)}</TableCell>
                  <TableCell className="text-right"><span className="flex justify-end gap-1">
                      {!finalized && <Button type="button" size="sm" variant="outline" onClick={() => setEdit(s)}>Adjust</Button>}
                      {finalized && (
                        <Button type="button" size="sm" variant="outline"
                          onClick={() => downloadFile(`/api/payroll/payslips/${s.id}/pdf`, `payslip-${run.period}.pdf`).catch(() => notify("Download failed", "error"))}>
                          <Download data-icon="inline-start" /> PDF
                        </Button>
                      )}
                    </span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></CardContent></Card>
      )}
      {edit && <PayslipModal slip={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); slips.reload(); }} />}
      {confirmingFinalize && (
        <ConfirmDialog
          title={`Finalize ${run.period} payroll`}
          message="Finalize this run? Payslips lock and become visible to employees."
          confirmLabel="Finalize payroll"
          onConfirm={finalize}
          onClose={() => setConfirmingFinalize(false)}
        />
      )}
    </div>
  );
}

function PayslipModal({ slip, onClose, onSaved }: { slip: Payslip; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [items, setItems] = useState(() =>
    slip.items.map((item) => ({ ...item, clientId: crypto.randomUUID() })),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function set(idx: number, patch: Partial<{ label: string; amount: string; kind: string }>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save() {
    setIsSubmitting(true);
    try {
      await api(`/api/payroll/payslips/${slip.id}`, {
        method: "PATCH",
        body: { items: items.filter((i) => i.label.trim() && i.amount).map((i) => ({ label: i.label.trim(), amount: i.amount, kind: i.kind })) },
      });
      notify("Payslip updated.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Adjust — ${slip.employee_name}`} onClose={onClose} maxWidth={520}>
      <p className="text-sm text-muted-foreground">Base salary {money(slip.base_salary, slip.currency)}. Add earnings or deductions:</p>
      <div className="my-2 flex flex-col gap-1">
        {items.map((it, i) => (
          <div key={it.clientId} className="flex gap-1">
            <Input aria-label="Label" className="flex-1" placeholder="Label" value={it.label} onChange={(e) => set(i, { label: e.target.value })} />
            <Input aria-label="Amount" className="w-24" type="number" step="0.01" placeholder="Amount" value={it.amount} onChange={(e) => set(i, { amount: e.target.value })} />
            <Select items={[{ value: "earning", label: "earning" }, { value: "deduction", label: "deduction" }]} value={it.kind} onValueChange={(value) => set(i, { kind: value ?? "" })}><SelectTrigger id={`payslip-kind-${it.clientId}`} aria-label="Kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="earning">earning</SelectItem><SelectItem value="deduction">deduction</SelectItem></SelectGroup></SelectContent></Select>
            <Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={() => setItems((a) => a.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => setItems((a) => [...a, { clientId: crypto.randomUUID(), label: "", amount: "", kind: "earning" }])}>+ Add line</Button>
      <div className="mt-3 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}
