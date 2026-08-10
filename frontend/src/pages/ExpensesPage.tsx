import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRef, useState } from "react";
import { Download, Plus, Receipt, Send, Trash2, Upload } from "lucide-react";
import { api, apiUrl } from "../api/client";
import type { ExpenseClaim } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const CATEGORIES = ["travel", "meals", "accommodation", "supplies", "software", "training", "other"];
const STATUS_BADGE: Record<string, "secondary" | "warning" | "success" | "destructive" | "info"> = {
  draft: "secondary", submitted: "warning", approved: "success", rejected: "destructive", reimbursed: "info",
};

function money(v: string | number, ccy?: string) {
  return `${ccy ?? ""} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

export default function ExpensesPage() {
  const { user } = useAuth();
  const canReview = !!user?.is_admin || user?.role === "manager" || !!user?.effective_permissions?.includes("hr");
  const [tab, setTab] = useState<"mine" | "review">("mine");
  const [creating, setCreating] = useState(false);
  const mine = useFetch<ExpenseClaim[]>("/api/expenses/my");

  return (
    <div>
      <PageHead
        title="Expenses"
        subtitle="Submit expense claims, attach receipts and track reimbursement."
        action={
          <Button type="button" onClick={() => setCreating(true)}><Plus data-icon="inline-start" /> New claim</Button>
        }
      />
      {canReview && (
        <ToggleGroup className="mb-4" value={[tab]} onValueChange={(value) => value[0] && setTab(value[0] as "mine" | "review")}>
          <ToggleGroupItem value="mine">My claims</ToggleGroupItem>
          <ToggleGroupItem value="review">All claims</ToggleGroupItem>
        </ToggleGroup>
      )}
      {tab === "mine" ? (
        <ClaimList q={mine} mine />
      ) : (
        <ReviewList />
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); mine.reload(); }} />}
    </div>
  );
}

function ClaimList({ q, mine }: { q: ReturnType<typeof useFetch<ExpenseClaim[]>>; mine?: boolean }) {
  const { notify } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseClaim | null>(null);

  async function submit(c: ExpenseClaim) {
    try {
      await api(`/api/expenses/${c.id}/submit`, { method: "POST" });
      notify("Submitted for approval.");
      q.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(c: ExpenseClaim) {
    await api(`/api/expenses/${c.id}`, { method: "DELETE" });
    q.reload();
  }
  async function reimburse(c: ExpenseClaim) {
    try {
      await api(`/api/expenses/${c.id}/reimburse`, { method: "POST" });
      q.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !uploadFor.current) return;
    const form = new FormData();
    form.append("file", f);
    try {
      await api(`/api/expenses/${uploadFor.current}/receipt`, { method: "POST", form });
      notify("Receipt attached.");
      q.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
    uploadFor.current = null;
    if (fileRef.current) fileRef.current.value = "";
  }

  if (q.loading) return <Loading />;
  if ((q.data?.length ?? 0) === 0) return <Card><CardContent><Empty icon={<Receipt />} message="No expense claims" hint="Create a claim and attach a receipt." /></CardContent></Card>;

  return (
    <>
      <Input aria-label="File" ref={fileRef} type="file" hidden onChange={onFile} />
      <Card className="py-0">
      <CardContent className="p-0"><Table>
        <TableHeader><TableRow>{!mine && <TableHead>Employee</TableHead>}<TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {q.data!.map((c) => (
            <TableRow key={c.id}>
              {!mine && <TableCell className="font-medium">{c.user_name}</TableCell>}
              <TableCell className="max-w-[28rem] whitespace-normal"><div className="truncate font-medium" title={c.title}>{c.title}{c.has_receipt && <Receipt className="ml-1 inline text-muted-foreground" />}</div></TableCell>
              <TableCell className="capitalize">{c.category}</TableCell>
              <TableCell className="text-right tabular-nums">{money(c.amount, c.currency)}</TableCell>
              <TableCell><Badge variant={STATUS_BADGE[c.status] ?? "secondary"}>{c.status}</Badge></TableCell>
              <TableCell className="text-right">
                <span className="flex justify-end gap-1">
                  {c.has_receipt && (
                    <a aria-label="Download receipt" className={buttonVariants({ variant: "outline", size: "icon-sm" })} href={apiUrl(`/api/expenses/${c.id}/receipt`)} target="_blank" rel="noreferrer"><Download /></a>
                  )}
                  {mine && c.status === "draft" && (
                    <>
                      <Button aria-label="Upload" type="button" variant="outline" size="icon-sm" onClick={() => { uploadFor.current = c.id; fileRef.current?.click(); }}><Upload /></Button>
                      <Button type="button" size="sm" onClick={() => submit(c)}><Send data-icon="inline-start" /> Submit</Button>
                    </>
                  )}
                  {!mine && c.status === "approved" && (
                    <Button type="button" size="sm" onClick={() => reimburse(c)}>Reimburse</Button>
                  )}
                  {(c.status === "draft" || c.status === "rejected") && (
                    <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleteTarget(c)}><Trash2 /></Button>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table></CardContent>
      </Card>
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete expense claim "${deleteTarget.title}"?`}
          message={`Permanently delete the "${deleteTarget.title}" expense claim?`}
          confirmLabel="Delete claim"
          danger
          onConfirm={() => del(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}

function ReviewList() {
  const q = useFetch<ExpenseClaim[]>("/api/expenses");
  return <ClaimList q={q} />;
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [f, setF] = useState({ title: "", category: "travel", amount: "", currency: "USD", expense_date: "", description: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function save() {
    if (!f.title.trim() || !f.amount) { notify("Title and amount required", "error"); return; }
    setIsSubmitting(true);
    try {
      await api("/api/expenses", { method: "POST", body: { ...f, amount: f.amount, expense_date: f.expense_date || null } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="New expense claim" onClose={onClose} maxWidth={480}>
      <FieldGroup>
      <Field><FieldLabel htmlFor="rd-expensespage-162-title">Title</FieldLabel><Input id="rd-expensespage-162-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field><FieldLabel htmlFor="rd-expensespage-165-category">Category</FieldLabel><Select items={CATEGORIES.map((c) => ({ value: c, label: c }))} value={f.category} onValueChange={(value) => setF({ ...f, category: value ?? "" })}><SelectTrigger id="rd-expensespage-165-category" aria-label="Category" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="rd-expensespage-168-amount">Amount</FieldLabel><Input id="rd-expensespage-168-amount" type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field><FieldLabel htmlFor="rd-expensespage-169-currency">Currency</FieldLabel><Input id="rd-expensespage-169-currency" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
      </div>
      <Field><FieldLabel htmlFor="rd-expensespage-171-date">Date</FieldLabel><Input id="rd-expensespage-171-date" type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
      <Field><FieldLabel htmlFor="rd-expensespage-172-description">Description</FieldLabel><Textarea id="rd-expensespage-172-description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </FieldGroup>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Saving…" : "Create draft"}</Button>
      </div>
    </Modal>
  );
}
