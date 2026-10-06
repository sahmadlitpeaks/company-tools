import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArrowLeft, CalendarClock, Mail, MessageSquare, Pencil, Phone, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { CrmActivity, CrmLead, User } from "../api/types";
import LeadFormDialog from "../components/crm/LeadFormDialog";
import { ACTIVITY_LABELS, PRIORITY_BADGES, PRIORITY_LABELS, SOURCE_LABELS, STAGE_OPTIONS, followUpState, formatDay, leadName, money, stageLabel } from "../components/crm/crm";
import { ConfirmDialog, Empty, ErrorState, ListSkeleton, PageHead, PromptModal, useToast } from "../components/ui";
import { useFetch } from "../hooks/useApi";

const LOG_KINDS = [
  { value: "note", label: "Note", icon: MessageSquare },
  { value: "call", label: "Call", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "meeting", label: "Meeting", icon: Users },
] as const;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words">{children}</dd></div>;
}

export default function CrmLeadPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { notify } = useToast();
  const lead = useFetch<CrmLead>(`/api/crm/leads/${id}`);
  const timeline = useFetch<CrmActivity[]>(`/api/crm/leads/${id}/activities`);
  const directory = useFetch<User[]>("/api/users");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [losing, setLosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingEntry, setRemovingEntry] = useState<CrmActivity | null>(null);
  const [kind, setKind] = useState<string>("note");
  const [body, setBody] = useState("");
  const [logging, setLogging] = useState(false);
  const reload = () => { void lead.reload(); void timeline.reload(); };

  if (lead.loading && !lead.data) return <ListSkeleton rows={6} />;
  if (lead.error || !lead.data) return <div className="flex flex-col gap-4">
    <PageHead title="Lead" headingLevel={1} action={<Button variant="ghost" render={<Link to="/crm" />}><ArrowLeft data-icon="inline-start" />Back to leads</Button>} />
    <ErrorState message={lead.error ?? "Lead not found"} onRetry={lead.reload} />
  </div>;

  const current = lead.data;
  const users = directory.data ?? [];
  const followUp = followUpState(current);
  const ownerOptions = [{ value: null, label: "Unassigned" }, ...users.map((person) => ({ value: person.id, label: person.display_name ?? person.email ?? "Unnamed owner" }))];

  async function patch(change: Record<string, unknown>, done: string) {
    setSaving(true);
    try { await api(`/api/crm/leads/${current.id}`, { method: "PATCH", body: change }); notify(done); reload(); }
    catch (error) { notify(error instanceof Error ? error.message : "Couldn't save", "error"); throw error; }
    finally { setSaving(false); }
  }
  function changeStage(next: string) {
    if (next === "lost") setLosing(true);
    else void patch({ status: next }, `Moved to ${stageLabel(next)}.`).catch(() => undefined);
  }
  async function logActivity(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setLogging(true);
    try {
      await api(`/api/crm/leads/${current.id}/activities`, { method: "POST", body: { kind, body } });
      setBody("");
      notify(`${ACTIVITY_LABELS[kind]} logged.`);
      reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn't log it", "error");
    } finally {
      setLogging(false);
    }
  }
  async function removeLead() {
    await api(`/api/crm/leads/${current.id}`, { method: "DELETE" });
    notify("Lead deleted.");
    navigate("/crm");
  }
  async function removeEntry(entry: CrmActivity) {
    await api(`/api/crm/leads/${current.id}/activities/${entry.id}`, { method: "DELETE" });
    notify("Timeline entry deleted.");
    void timeline.reload();
  }

  const name = leadName(current);
  const kindLabel = ACTIVITY_LABELS[kind].toLowerCase();

  return <div className="flex min-w-0 flex-col gap-4">
    <PageHead
      title={name}
      headingLevel={1}
      subtitle={[current.company, `${stageLabel(current.status)} · ${current.owner_name ?? "Unassigned"}`].filter(Boolean).join(" · ")}
      action={<div className="flex flex-wrap gap-2">
        <Button variant="ghost" render={<Link to="/crm" />}><ArrowLeft data-icon="inline-start" />Back to leads</Button>
        <Button type="button" variant="outline" onClick={() => setEditing(true)}><Pencil data-icon="inline-start" />Edit</Button>
        {current.can_delete && <Button type="button" variant="destructive" className="border-destructive/40 bg-background hover:bg-background dark:bg-background dark:hover:bg-background" onClick={() => setDeleting(true)}><Trash2 data-icon="inline-start" />Delete</Button>}
      </div>}
    />
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader><CardTitle>Pipeline</CardTitle><CardDescription>Stage and owner changes are saved right away and recorded on the timeline.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="lead-stage">Stage</FieldLabel>
                <Select items={STAGE_OPTIONS} value={current.status} disabled={saving} onValueChange={(value) => value && value !== current.status && changeStage(value)}>
                  <SelectTrigger id="lead-stage" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{STAGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="lead-owner">Owner</FieldLabel>
                <Select items={ownerOptions} value={current.owner_id ?? null} disabled={saving} onValueChange={(value) => value !== (current.owner_id ?? null) && void patch({ owner_id: value }, "Owner updated.").catch(() => undefined)}>
                  <SelectTrigger id="lead-owner" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{ownerOptions.map((option) => <SelectItem key={option.value ?? "none"} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Deal value">{money(current.value)}</Detail>
              <Detail label="Priority">{current.priority ? <Badge variant={PRIORITY_BADGES[current.priority] ?? "secondary"}>{PRIORITY_LABELS[current.priority]}</Badge> : "—"}</Detail>
              <Detail label="Expected close">{formatDay(current.expected_close_date)}</Detail>
              <Detail label="Last contacted">{current.last_contacted_at ? new Date(current.last_contacted_at).toLocaleString() : "Never"}</Detail>
              {current.status === "lost" && <div className="col-span-2"><Detail label="Lost reason">{current.lost_reason ?? "Not recorded"}</Detail></div>}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock aria-hidden="true" />Follow-up</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Date">{current.follow_up_date
                ? <span className="flex flex-wrap items-center gap-2">{formatDay(current.follow_up_date)}{followUp === "overdue" && <Badge variant="destructive">Overdue</Badge>}{followUp === "today" && <Badge variant="warning">Today</Badge>}</span>
                : "Not set"}</Detail>
              <Detail label="Next step">{current.next_step ?? "—"}</Detail>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Detail label="Email">{current.email ? <a className="break-all underline underline-offset-4" href={`mailto:${current.email}`}>{current.email}</a> : "—"}</Detail>
              <Detail label="Phone">{current.phone ? <a className="underline underline-offset-4" href={`tel:${current.phone.replace(/[^\d+]/g, "")}`}>{current.phone}</a> : "—"}</Detail>
              <Detail label="Company">{current.company ?? "—"}</Detail>
              <Detail label="Source">{SOURCE_LABELS[current.source] ?? current.source}{current.source_detail ? ` · ${current.source_detail}` : ""}</Detail>
              <Detail label="Added">{new Date(current.created_at).toLocaleDateString()}</Detail>
              <Detail label="Tags">{current.tags?.length ? <span className="flex flex-wrap gap-1">{current.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</span> : "—"}</Detail>
            </dl>
            {current.page_url && /^https?:\/\//i.test(current.page_url) && <a className="underline underline-offset-4" href={current.page_url} target="_blank" rel="noreferrer">View source page</a>}
            {Boolean(current.fields?.length) && <><Separator /><dl className="grid gap-2">{current.fields?.map((field) => <Detail key={field.key} label={field.label}><span className="whitespace-pre-wrap">{field.value}</span></Detail>)}</dl></>}
            {current.notes && <><Separator /><dl><Detail label="Notes"><span className="whitespace-pre-wrap">{current.notes}</span></Detail></dl></>}
          </CardContent>
        </Card>
      </div>
      <Card className="min-w-0">
        <CardHeader><CardTitle>Timeline</CardTitle><CardDescription>Log calls, emails, meetings and notes. Logging a call, email or meeting updates “last contacted”.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={logActivity} className="flex flex-col gap-3">
            <ToggleGroup aria-label="Type of entry" variant="outline" spacing={0} className="flex-wrap justify-start" value={[kind]} onValueChange={(value) => value[0] && setKind(value[0])}>
              {LOG_KINDS.map(({ value, label, icon: Icon }) => <ToggleGroupItem key={value} value={value}><Icon data-icon="inline-start" />{label}</ToggleGroupItem>)}
            </ToggleGroup>
            <Field>
              <FieldLabel htmlFor="lead-log">Details</FieldLabel>
              <Textarea id="lead-log" rows={3} maxLength={10000} value={body} placeholder={kind === "note" ? "Add a note…" : `What happened on the ${kindLabel}?`} onChange={(event) => setBody(event.target.value)} />
            </Field>
            <div className="flex justify-end"><Button type="submit" disabled={logging || !body.trim()}>{logging && <Spinner data-icon="inline-start" />}Log {kindLabel}</Button></div>
          </form>
          <Separator />
          {timeline.loading && !timeline.data ? <ListSkeleton rows={3} /> : timeline.error ? <ErrorState message={timeline.error} onRetry={timeline.reload} /> : !timeline.data?.length ? <Empty icon={<MessageSquare />} message="Nothing logged yet" hint="Calls, emails, meetings and notes will appear here." /> : (
            <ol className="flex flex-col gap-3" aria-label="Lead timeline">
              {timeline.data.map((entry) => <li key={entry.id} className="flex flex-col gap-1 border-l-2 border-border pl-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={["created", "change", "import"].includes(entry.kind) ? "secondary" : "info"}>{ACTIVITY_LABELS[entry.kind] ?? entry.kind}</Badge>
                    <span>{entry.author_name ?? "System"}</span>
                    <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>
                  </p>
                  {entry.can_delete && <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${ACTIVITY_LABELS[entry.kind]?.toLowerCase() ?? "entry"} from ${new Date(entry.created_at).toLocaleString()}`} onClick={() => setRemovingEntry(entry)}><Trash2 data-icon="inline-start" />Delete</Button>}
                </div>
                <p className="break-words text-sm whitespace-pre-wrap">{entry.body}</p>
              </li>)}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
    {editing && <LeadFormDialog lead={current} users={users} onClose={() => setEditing(false)} onSaved={reload} />}
    {losing && <PromptModal title={`Mark ${name} as lost`} label="Why was it lost?" placeholder="e.g. Chose another supplier" submitLabel="Mark as lost" onConfirm={(reason) => patch({ status: "lost", lost_reason: reason }, "Marked as lost.")} onClose={() => setLosing(false)} />}
    {deleting && <ConfirmDialog title="Delete lead" message={`Delete ${name}? Its timeline is deleted too. This cannot be undone.`} confirmLabel="Delete" danger onConfirm={removeLead} onClose={() => setDeleting(false)} />}
    {removingEntry && <ConfirmDialog title="Delete timeline entry" message="Delete this entry? This cannot be undone." confirmLabel="Delete" danger onConfirm={() => removeEntry(removingEntry)} onClose={() => setRemovingEntry(null)} />}
  </div>;
}
