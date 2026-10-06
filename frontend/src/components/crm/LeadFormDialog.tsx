import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { api } from "../../api/client";
import type { CrmLead, User } from "../../api/types";
import { useBrand } from "../../brand/BrandContext";
import { Modal, useToast } from "../ui";
import { PRIORITIES, PRIORITY_LABELS, SOURCE_LABELS, STAGE_OPTIONS, parseTags } from "./crm";

type Option = { value: string | null; label: string };

function OptionSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string | null; options: Option[]; onChange: (value: string) => void }) {
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select items={options} value={value} onValueChange={(next) => onChange(next ?? "")}>
      <SelectTrigger className="w-full" id={id}><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{options.map((option) => <SelectItem key={option.value ?? "none"} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </Field>;
}

function TextField({ id, label, value, onChange, type = "text" }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
  </Field>;
}

/** Add or edit a lead. Leads with website fields show them read-only above the form. */
export default function LeadFormDialog({ lead, users, onClose, onSaved }: { lead: CrmLead | null; users: User[]; onClose: () => void; onSaved: (lead: CrmLead) => void }) {
  const { notify } = useToast();
  const { brands } = useBrand();
  const [form, setForm] = useState({
    name: lead?.name ?? "", email: lead?.email ?? "", phone: lead?.phone ?? "", company: lead?.company ?? "",
    status: lead?.status ?? "new", owner_id: lead?.owner_id ?? "", value: lead?.value ?? "", company_id: lead?.company_id ?? "",
    priority: lead?.priority ?? "", tags: (lead?.tags ?? []).join(", "), follow_up_date: lead?.follow_up_date ?? "",
    next_step: lead?.next_step ?? "", expected_close_date: lead?.expected_close_date ?? "", lost_reason: lead?.lost_reason ?? "",
    notes: lead?.notes ?? "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const becomesLost = form.status === "lost" && lead?.status !== "lost";
  const reasonMissing = becomesLost && !form.lost_reason.trim();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (reasonMissing) { setShowErrors(true); return; }
    setIsSubmitting(true);
    const body = {
      name: form.name || null, email: form.email || null, phone: form.phone || null, company: form.company || null,
      status: form.status, owner_id: form.owner_id || null, value: form.value || null, company_id: form.company_id || null,
      priority: form.priority || null, tags: parseTags(form.tags), follow_up_date: form.follow_up_date || null,
      next_step: form.next_step || null, expected_close_date: form.expected_close_date || null, notes: form.notes || null,
      ...(form.status === "lost" ? { lost_reason: form.lost_reason.trim() || null } : {}),
    };
    try {
      const saved = lead
        ? await api<CrmLead>(`/api/crm/leads/${lead.id}`, { method: "PATCH", body })
        : await api<CrmLead>("/api/crm/leads", { method: "POST", body });
      notify(lead ? "Lead updated." : "Lead added.");
      onSaved(saved);
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn't save the lead", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  const ownerOptions: Option[] = [{ value: null, label: "Unassigned" }, ...users.map((user) => ({ value: user.id, label: user.display_name ?? user.email ?? "Unnamed owner" }))];
  const brandOptions: Option[] = [{ value: null, label: "—" }, ...brands.map((brand) => ({ value: brand.id, label: brand.name }))];
  const priorityOptions: Option[] = [{ value: null, label: "Not set" }, ...PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))];

  return (
    <Modal title={lead ? "Edit lead" : "Add lead"} onClose={onClose} maxWidth={640}>
      {lead && <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">{SOURCE_LABELS[lead.source] ?? lead.source}{lead.source_detail ? ` · ${lead.source_detail}` : ""} · Added {new Date(lead.created_at).toLocaleDateString()}</p>
        {lead.page_url && /^https?:\/\//i.test(lead.page_url) && <a className="text-foreground underline" href={lead.page_url} target="_blank" rel="noreferrer">View source page</a>}
        {Boolean(lead.fields?.length) && <dl className="grid gap-2 border p-3">{lead.fields?.map((field) => <div key={field.key}><dt className="text-xs text-muted-foreground">{field.label}</dt><dd className="break-words whitespace-pre-wrap">{field.value}</dd></div>)}</dl>}
      </div>}
      <form onSubmit={save} className="flex flex-col gap-5" noValidate>
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="crm-name" label="Name" value={form.name} onChange={(value) => set("name", value)} />
            <TextField id="crm-company" label="Company" value={form.company} onChange={(value) => set("company", value)} />
            <TextField id="crm-email" label="Email" type="email" value={form.email} onChange={(value) => set("email", value)} />
            <TextField id="crm-phone" label="Phone" type="tel" value={form.phone} onChange={(value) => set("phone", value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <OptionSelect id="crm-status" label="Stage" value={form.status} options={STAGE_OPTIONS} onChange={(value) => set("status", value || "new")} />
            <TextField id="crm-value" label="Deal value" type="number" value={form.value} onChange={(value) => set("value", value)} />
          </div>
          {form.status === "lost" && <Field data-invalid={(showErrors && reasonMissing) || undefined}>
            <FieldLabel htmlFor="crm-lost-reason">Lost reason</FieldLabel>
            <Input id="crm-lost-reason" value={form.lost_reason} maxLength={255} aria-invalid={(showErrors && reasonMissing) || undefined} onChange={(event) => set("lost_reason", event.target.value)} />
            {showErrors && reasonMissing ? <FieldError>Give a reason when marking a lead as lost.</FieldError> : null}
          </Field>}
          <div className="grid gap-4 sm:grid-cols-2">
            <OptionSelect id="crm-owner" label="Owner" value={form.owner_id || null} options={ownerOptions} onChange={(value) => set("owner_id", value)} />
            <OptionSelect id="crm-brand" label="Brand" value={form.company_id || null} options={brandOptions} onChange={(value) => set("company_id", value)} />
            <OptionSelect id="crm-priority" label="Priority" value={form.priority || null} options={priorityOptions} onChange={(value) => set("priority", value)} />
            <TextField id="crm-expected-close" label="Expected close" type="date" value={form.expected_close_date} onChange={(value) => set("expected_close_date", value)} />
            <TextField id="crm-follow-up" label="Follow-up date" type="date" value={form.follow_up_date} onChange={(value) => set("follow_up_date", value)} />
            <TextField id="crm-next-step" label="Next step" value={form.next_step} onChange={(value) => set("next_step", value)} />
          </div>
          <Field>
            <FieldLabel htmlFor="crm-tags">Tags</FieldLabel>
            <Input id="crm-tags" value={form.tags} onChange={(event) => set("tags", event.target.value)} />
            <FieldDescription>Separate tags with commas, for example: trade show, distributor.</FieldDescription>
          </Field>
          <Field><FieldLabel htmlFor="crm-notes">Notes</FieldLabel><Textarea id="crm-notes" rows={3} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Spinner data-icon="inline-start" />}{lead ? "Save" : "Add lead"}</Button>
        </div>
      </form>
    </Modal>
  );
}
