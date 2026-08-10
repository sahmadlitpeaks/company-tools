import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, Paperclip, Plus, X } from "lucide-react";
import { api } from "../api/client";
import type { Approval, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, PromptModal, useToast } from "../components/ui";
import Attachments from "../components/Attachments";

const TYPES = ["leave", "expense", "purchase", "document", "access", "general"];
const STATUS_BADGE: Record<string, "warning" | "success" | "destructive" | "secondary"> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
};

function money(v?: string | null) {
  if (!v) return null;
  const n = Number(v);
  return Number.isNaN(n)
    ? v
    : n.toLocaleString(undefined, { style: "currency", currency: "AED" });
}

export default function ApprovalsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [scope, setScope] = useState<"mine" | "to_review">("mine");
  const list = useFetch<Approval[]>(`/api/approvals?scope=${scope}`);
  const [adding, setAdding] = useState(false);
  const [attachOf, setAttachOf] = useState<Approval | null>(null);
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const canReview = user?.is_admin || user?.role === "manager";
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new")) {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  async function decide(a: Approval, status: "approved" | "rejected", note?: string) {
    await api(`/api/approvals/${a.id}/decision`, {
      method: "POST",
      body: { status, note: note || null },
    });
    notify(`Request ${status}.`);
    list.reload();
  }
  async function cancel(a: Approval) {
    await api(`/api/approvals/${a.id}/cancel`, { method: "POST" });
    notify("Request cancelled.");
    list.reload();
  }

  return (
    <div>
      <PageHead
        title="Approvals"
        subtitle="Submit and track requests for leave, expenses, purchases and more."
        action={
          <Button type="button"
            onClick={() => setAdding(true)}
          >
            <Plus data-icon="inline-start" /> New request
          </Button>
        }
      />

      <ToggleGroup className="mb-4" value={[scope]} onValueChange={(value) => value[0] && setScope(value[0] as "mine" | "to_review")}>
        <ToggleGroupItem value="mine">My requests</ToggleGroupItem>
        {canReview && <ToggleGroupItem value="to_review">To review</ToggleGroupItem>}
      </ToggleGroup>

      <Card className="py-0">
        <CardContent className="p-0">
        {list.loading ? (
          <Loading />
        ) : (list.data?.length ?? 0) === 0 ? (
          <Empty message={scope === "mine" ? "You haven't made any requests." : "Nothing to review."} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>{scope === "mine" ? "Approver" : "Requester"}</TableHead>
              <TableHead className="text-right">Amount / dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data!.map((a) => (
                <TableRow key={a.id}>
                  <TableCell><Badge variant="secondary">{a.type}</Badge></TableCell>
                  <TableCell className="max-w-[28rem] whitespace-normal">
                    <div className="truncate font-semibold" title={a.title}>{a.title}</div>
                    {a.details && <div className="line-clamp-2 text-xs text-muted-foreground">{a.details}</div>}
                  </TableCell>
                  <TableCell>{scope === "mine" ? a.approver_name ?? "Any manager" : a.requester_name ?? "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {money(a.amount) ??
                      (a.start_date ? `${a.start_date}${a.end_date ? ` → ${a.end_date}` : ""}` : "—")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[a.status] ?? "secondary"}>{a.status}</Badge>
                    {a.decision_note && <div className="text-xs text-muted-foreground">“{a.decision_note}”</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button type="button" variant="outline" size="icon-sm"
                        title="Attachments"
                        onClick={() => setAttachOf(a)}
                      >
                        <Paperclip />
                      </Button>
                      {a.status === "pending" && scope === "to_review" && (
                        <>
                          <Button type="button" size="sm" onClick={() => decide(a, "approved")}>
                            <Check data-icon="inline-start" /> Approve
                          </Button>
                          <Button type="button" variant="destructive" size="sm" onClick={() => setRejecting(a)}>
                            <X data-icon="inline-start" /> Reject
                          </Button>
                        </>
                      )}
                      {a.status === "pending" && scope === "mine" && (
                        <Button type="button" variant="outline" size="sm" onClick={() => cancel(a)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        </CardContent>
      </Card>

      {adding && (
        <ApprovalModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setScope("mine");
            list.reload();
            setAdding(false);
          }}
        />
      )}
      {attachOf && (
        <Modal title={`Attachments — ${attachOf.title}`} onClose={() => setAttachOf(null)} maxWidth={460}>
          <Attachments entityType="approval" entityId={attachOf.id} />
        </Modal>
      )}
      {rejecting && (
        <PromptModal
          title="Reject request"
          label="Reason (optional)"
          placeholder="Let them know why…"
          submitLabel="Reject"
          onConfirm={async (note) => {
            await decide(rejecting, "rejected", note);
          }}
          onClose={() => setRejecting(null)}
        />
      )}
    </div>
  );
}

function ApprovalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const users = useFetch<User[]>("/api/users");
  const [form, setForm] = useState({
    type: "leave",
    title: "",
    details: "",
    amount: "",
    start_date: "",
    end_date: "",
    approver_id: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const showAmount = ["expense", "purchase"].includes(form.type);
  const showDates = form.type === "leave";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/approvals", {
        method: "POST",
        body: {
          type: form.type,
          title: form.title,
          details: form.details || null,
          amount: showAmount && form.amount ? form.amount : null,
          start_date: showDates && form.start_date ? form.start_date : null,
          end_date: showDates && form.end_date ? form.end_date : null,
          approver_id: form.approver_id || null,
        },
      });
      notify("Request submitted.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="New request" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="rd-approvalspage-228-type">Type</FieldLabel>
            <Select items={TYPES.map((t) => ({ value: t, label: t }))} value={form.type} onValueChange={(value) => set("type", value ?? "")}>
              <SelectTrigger className="w-full" id="rd-approvalspage-228-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="rd-approvalspage-238-approver-optional">Approver (optional)</FieldLabel>
            <Select
              items={[
                { value: null, label: "Any manager" },
                ...(users.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email })),
              ]}
              value={form.approver_id || null}
              onValueChange={(value) => set("approver_id", value ?? "")}
            >
              <SelectTrigger className="w-full" id="rd-approvalspage-238-approver-optional">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={null}>Any manager</SelectItem>
                  {(users.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.display_name ?? u.email}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="rd-approvalspage-250-title">Title *</FieldLabel>
          <Input id="rd-approvalspage-250-title" required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="rd-approvalspage-254-details">Details</FieldLabel>
          <Textarea id="rd-approvalspage-254-details" rows={2} value={form.details} onChange={(e) => set("details", e.target.value)} />
        </Field>
        {showAmount && (
          <Field>
            <FieldLabel htmlFor="rd-approvalspage-259-amount">Amount</FieldLabel>
            <Input id="rd-approvalspage-259-amount" type="number" step="0.01" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </Field>
        )}
        {showDates && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="rd-approvalspage-266-from">From</FieldLabel>
              <Input id="rd-approvalspage-266-from" type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="rd-approvalspage-270-to">To</FieldLabel>
              <Input id="rd-approvalspage-270-to" type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
            </Field>
          </div>
        )}
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
