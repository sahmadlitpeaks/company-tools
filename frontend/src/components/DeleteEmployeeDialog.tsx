import { useState } from "react";
import { api } from "@/api/client";
import type { User } from "@/api/types";
import { useFetch } from "@/hooks/useApi";
import { ErrorState, Loading, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type DeletionStatus = { can_delete: boolean; reason: string | null; blockers: Array<{ label: string; count: number }> };
export function DeleteEmployeeDialog({ employee, onClose, onDeleted }: {
  employee: User; onClose: () => void; onDeleted: () => void;
}) {
  const status = useFetch<DeletionStatus>(`/api/users/${employee.id}/deletion`);
  const [confirmation, setConfirmation] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  const { notify } = useToast();
  const expected = employee.email || employee.personal_email || employee.display_name || "";
  async function remove() {
    if (!status.data?.can_delete || confirmation.trim() !== expected) return;
    setState({ busy: true, error: "" });
    try {
      await api(`/api/users/${employee.id}`, { method: "DELETE" });
      notify("Employee deleted."); onDeleted(); onClose();
    } catch (cause) {
      setState({ busy: false, error: cause instanceof Error ? cause.message : "Employee could not be deleted." });
      status.reload();
    }
  }
  return <AlertDialog open onOpenChange={(open) => !open && !state.busy && onClose()}><AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
    <AlertDialogHeader><AlertDialogTitle>Delete employee?</AlertDialogTitle><AlertDialogDescription>This permanently removes {employee.display_name || expected}'s account and sign-in access.</AlertDialogDescription></AlertDialogHeader>
    {status.loading ? <Loading /> : status.error ? <ErrorState message={status.error} onRetry={status.reload} /> : status.data && <>
      {!status.data.can_delete && <Alert><AlertDescription>{status.data.reason}</AlertDescription></Alert>}
      {status.data.blockers.length > 0 && <ul className="list-inside list-disc text-sm">{status.data.blockers.map((item) => <li key={item.label}>{item.label}: {item.count}</li>)}</ul>}
      {status.data.can_delete && <Field><FieldLabel className="break-all" htmlFor="delete-employee-confirm">Type {expected} to confirm</FieldLabel><Input id="delete-employee-confirm" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={state.busy} /></Field>}
    </>}
    {state.error && <Alert variant="destructive" role="alert"><AlertDescription>{state.error}</AlertDescription></Alert>}
    <AlertDialogFooter><Button variant="outline" onClick={onClose} disabled={state.busy}>Cancel</Button><Button variant="destructive" className="bg-destructive text-destructive-foreground hover:bg-destructive/90 dark:text-background" onClick={() => void remove()} disabled={status.loading || Boolean(status.error) || !status.data?.can_delete || confirmation.trim() !== expected || state.busy}>{state.busy ? "Deleting…" : "Delete employee"}</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>;
}
