import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { api } from "@/api/client";
import { DECISION_CATEGORIES, EVIDENCE_TYPES, type DecisionDetailData, type DecisionEvidence } from "@/api/pm-decisions";
import { pmError, type PmIssue, type PmMember, type PmProject } from "@/api/pm";
import { useAuth } from "@/auth/AuthContext";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = { project: PmProject; members: PmMember[]; issues: PmIssue[]; decision?: DecisionDetailData; onClose: () => void; onSaved: (row: DecisionDetailData) => void };
export function DecisionForm({ project, members, issues, decision, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const [form, setForm] = useState(() => ({
    title: decision?.title ?? "", category: decision?.category ?? "business", context: decision?.context ?? "",
    approach: decision?.approach ?? "", rationale: decision?.rationale ?? "", alternatives: decision?.alternatives ?? "",
    owner_id: decision?.owner_id ?? (members.some((m) => m.user_id === user?.id && m.role !== "viewer") ? user!.id : ""),
    approver_id: decision?.approver_id ?? "", effective_date: decision?.effective_date ?? "",
    issue_ids: decision?.issues.map((i) => i.id) ?? [],
    evidence: (decision?.evidence ?? []).map(({ type, label, url }) => ({ type, label, url, localId: crypto.randomUUID() })),
  }));
  const [state, setState] = useState({ busy: false, error: "" });
  const [issueQuery, setIssueQuery] = useState("");
  const set = (field: string, value: string) => setForm((old) => ({ ...old, [field]: value }));
  const approvers = members.filter((m) => m.user_id !== user?.id && m.user_id !== decision?.proposed_by_id);
  const matchingIssues = issues.filter((issue) => `${issue.key} ${issue.summary}`.toLowerCase().includes(issueQuery.trim().toLowerCase()));
  async function save(event: FormEvent) {
    event.preventDefault();
    setState({ busy: true, error: "" });
    try {
      const body = { ...form, approver_id: form.approver_id || null, effective_date: form.effective_date || null,
        evidence: form.evidence.map(({ type, label, url }) => ({ type, label, url })), ...(decision ? { version: decision.version } : {}) };
      const saved = await api<DecisionDetailData>(decision ? `/api/pm/decisions/${decision.id}` : `/api/pm/projects/${project.id}/decisions`,
        { method: decision ? "PATCH" : "POST", body });
      onSaved(saved);
    } catch (cause) { setState({ busy: false, error: pmError(cause) }); }
  }
  function updateEvidence(index: number, field: keyof DecisionEvidence, value: string) {
    setForm((old) => ({ ...old, evidence: old.evidence.map((item, i) => i === index ? { ...item, [field]: value } : item) }));
  }
  return <Dialog open onOpenChange={(open) => !open && !state.busy && onClose()}>
    <DialogContent className="flex max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 sm:px-6 sm:pr-12"><DialogTitle className="text-base">{decision ? `Edit ${decision.key}` : "Create decision"}</DialogTitle>
        <DialogDescription>Record what is proposed and why. Saving a draft does not request approval.</DialogDescription></DialogHeader>
      {state.error && <Alert variant="destructive" role="alert" className="m-4 w-auto shrink-0 sm:mx-6"><AlertDescription>{state.error} Your changes have not been saved.</AlertDescription></Alert>}
      <form onSubmit={(event) => void save(event)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6"><FieldGroup className="gap-6">
        <FieldSet><FieldLegend>Decision details</FieldLegend><FieldGroup>
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field><FieldLabel htmlFor="decision-title">Title</FieldLabel><Input id="decision-title" required maxLength={255} value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
            <TaskChoice id="decision-category" label="Category" value={form.category} items={DECISION_CATEGORIES} onChange={(v) => set("category", v)} />
          </div>
          <Field><FieldLabel htmlFor="decision-context">Context / problem</FieldLabel><Textarea id="decision-context" required maxLength={20000} rows={3} value={form.context} onChange={(e) => set("context", e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="decision-approach">Chosen approach</FieldLabel><Textarea id="decision-approach" required maxLength={20000} rows={3} value={form.approach} onChange={(e) => set("approach", e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="decision-rationale">Rationale</FieldLabel><Textarea id="decision-rationale" required maxLength={20000} rows={3} value={form.rationale} onChange={(e) => set("rationale", e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="decision-alternatives">Alternatives considered (optional)</FieldLabel><Textarea id="decision-alternatives" maxLength={20000} rows={2} value={form.alternatives} onChange={(e) => set("alternatives", e.target.value)} /></Field>
        </FieldGroup></FieldSet>
        <FieldSet><FieldLegend>Ownership and approval</FieldLegend><FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <TaskChoice id="decision-owner" label="Owner" value={form.owner_id} items={[{ value: "", label: "Choose an owner" }, ...members.filter((m) => m.role !== "viewer").map((m) => ({ value: m.user_id, label: m.name }))]} onChange={(v) => set("owner_id", v)} />
            <TaskChoice id="decision-approver" label="Approver" value={form.approver_id} items={[{ value: "", label: "Choose before submitting" }, ...approvers.map((m) => ({ value: m.user_id, label: m.name }))]} onChange={(v) => set("approver_id", v)} />
          </div>
          <FieldDescription>Approval must come from another project participant. Only the assigned approver can approve or reject.</FieldDescription>
          <Field className="sm:max-w-xs"><FieldLabel htmlFor="decision-effective">Effective date (optional)</FieldLabel><Input id="decision-effective" type="date" value={form.effective_date} onChange={(e) => set("effective_date", e.target.value)} /></Field>
        </FieldGroup></FieldSet>
        <FieldSet><FieldLegend>Linked issues <span className="font-normal text-muted-foreground">· {form.issue_ids.length} selected</span></FieldLegend>
          <FieldDescription>Link up to 100 requirements and implementation issues already in this project.</FieldDescription>
          {issues.length ? <>
            <Field><FieldLabel htmlFor="decision-issue-search">Find issues</FieldLabel><Input id="decision-issue-search" type="search" placeholder="Search by issue key or title" value={issueQuery} onChange={(event) => setIssueQuery(event.target.value)} /></Field>
            <div className="max-h-48 overflow-y-auto border border-border p-3">
            <FieldGroup>{matchingIssues.map((issue) => <Field key={issue.id} orientation="horizontal">
              <Checkbox id={`decision-issue-${issue.id}`} checked={form.issue_ids.includes(issue.id)} disabled={!form.issue_ids.includes(issue.id) && form.issue_ids.length >= 100} onCheckedChange={(checked) => setForm((old) => ({ ...old, issue_ids: checked ? [...old.issue_ids, issue.id] : old.issue_ids.filter((id) => id !== issue.id) }))} />
              <FieldLabel htmlFor={`decision-issue-${issue.id}`} className="min-w-0 break-words">{issue.key} · {issue.summary}</FieldLabel>
            </Field>)}</FieldGroup>
            {!matchingIssues.length && <p className="text-sm text-muted-foreground">No matching issues. Try another key or title.</p>}
          </div></> : <p className="text-sm text-muted-foreground">No issues in this project yet. Create project issues, then link them from the decision.</p>}
        </FieldSet>
        <section className="flex flex-col gap-3" aria-label="Evidence references">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Evidence references</h3>
            <Button type="button" variant="outline" size="sm" disabled={form.evidence.length >= 30} onClick={() => setForm((old) => ({ ...old, evidence: [...old.evidence, { type: "document", label: "", url: "", localId: crypto.randomUUID() }] }))}><Plus data-icon="inline-start" />Add reference</Button></div>
          {form.evidence.map((item, index) => <div key={item.localId} className="grid gap-3 border border-border p-3">
            <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><TaskChoice id={`evidence-type-${index}`} label={`Reference ${index + 1} type`} value={item.type} items={EVIDENCE_TYPES} onChange={(v) => updateEvidence(index, "type", v)} /></div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove reference ${index + 1}`} onClick={() => setForm((old) => ({ ...old, evidence: old.evidence.filter((_, i) => i !== index) }))}><X /></Button></div>
            <Field><FieldLabel htmlFor={`evidence-label-${index}`}>Reference {index + 1} description</FieldLabel><Input id={`evidence-label-${index}`} required maxLength={255} value={item.label} onChange={(e) => updateEvidence(index, "label", e.target.value)} /></Field>
            <Field><FieldLabel htmlFor={`evidence-url-${index}`}>Reference {index + 1} URL</FieldLabel><Input id={`evidence-url-${index}`} type="url" required maxLength={2048} value={item.url} onChange={(e) => updateEvidence(index, "url", e.target.value)} /></Field>
          </div>)}
          {!form.evidence.length && <p className="text-sm text-muted-foreground">Add Teams links, meeting notes or existing documents. Links support the decision; they do not count as approval.</p>}
        </section>
        </FieldGroup></div>
        <DialogFooter className="shrink-0 border-t border-border bg-muted/30 px-4 py-3 sm:px-6"><Button type="button" variant="outline" disabled={state.busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={state.busy || !form.owner_id}>{state.busy ? "Saving…" : "Save draft"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
