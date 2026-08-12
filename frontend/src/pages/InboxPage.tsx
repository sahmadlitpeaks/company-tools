import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field as FormField, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Cable, Copy, FileInput, Inbox, Plus, Trash2, UserPlus, Ticket as TicketIcon } from "lucide-react";
import { api, apiUrl } from "../api/client";
import type { IntakeForm, IntakeSource, Submission } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, PromptModal, useToast } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { numericInput } from "../utils/numbers";
import { cn } from "@/lib/utils";

const TYPES = ["lead", "complaint", "support", "inquiry", "feedback", "other"];
const STATUSES = ["quarantined", "new", "in_progress", "resolved", "spam", "archived"];
const TYPE_BADGE: Record<string, "success" | "destructive" | "warning" | "info" | "secondary"> = {
  lead: "success", complaint: "destructive", support: "warning", inquiry: "info", feedback: "secondary", other: "secondary",
};
const STATUS_BADGE: Record<string, "warning" | "info" | "success" | "destructive" | "secondary"> = {
  quarantined: "warning", new: "info", in_progress: "info", resolved: "success", spam: "destructive", archived: "secondary",
};

const INBOX_STATUSES = new Set(["new", "in_progress", "resolved"]);
const QUARANTINE_STATUSES = new Set(["quarantined", "spam"]);

export default function InboxPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"inbox" | "quarantine" | "forms" | "sources">("inbox");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (type) p.set("type", type);
    if (debouncedQ) p.set("q", debouncedQ);
    return p.toString();
  }, [type, debouncedQ]);
  const subs = useFetch<Submission[]>(`/api/intake/submissions${qs ? `?${qs}` : ""}`);
  const [open, setOpen] = useState<Submission | null>(null);

  const all = subs.data ?? [];
  const quarantineCount = all.filter((s) => QUARANTINE_STATUSES.has(s.status)).length;
  const rows = all.filter((s) =>
    tab === "quarantine" ? QUARANTINE_STATUSES.has(s.status) : INBOX_STATUSES.has(s.status),
  );

  return (
    <div>
      <PageHead title="Web Inbox" subtitle="Website submissions are spam-screened in quarantine; real leads land in the inbox." />

      <ToggleGroup value={[tab]} onValueChange={(value) => value[0] && setTab(value[0] as typeof tab)} variant="outline" spacing={0} className="mb-4"><ToggleGroupItem value="inbox">Inbox</ToggleGroupItem><ToggleGroupItem value="quarantine">Quarantine{quarantineCount ? ` (${quarantineCount})` : ""}</ToggleGroupItem><ToggleGroupItem value="forms">Forms</ToggleGroupItem>{user?.is_admin && <ToggleGroupItem value="sources">Connected websites</ToggleGroupItem>}</ToggleGroup>

      {tab === "forms" ? (
        <FormsTab />
      ) : tab === "sources" ? (
        <SourcesTab />
      ) : (
        <Card className="py-0">
          <CardHeader className="py-(--card-spacing)">
          {tab === "quarantine" && (
            <p className="text-sm text-muted-foreground">Held for review by the spam screen. Release real ones to the inbox, or delete spam.</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Search name, email, message…" className="flex-1" placeholder="Search name, email, message…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select items={[{ value: null, label: "All types" }, ...TYPES.map((t) => ({ value: t, label: t }))]} value={type || null} onValueChange={(value) => setType(value ?? "")}>
              <SelectTrigger id="inbox-type" aria-label="Type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>All types</SelectItem>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </div>
          </CardHeader>

          <CardContent className={rows.length > 0 ? "p-0" : undefined}>
          {subs.loading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty icon={<Inbox />} message={tab === "quarantine" ? "Nothing in quarantine" : "No submissions yet"} hint={tab === "inbox" && user?.is_admin ? "Connect a website under 'Connected websites' and point its form here." : undefined} />
          ) : (
           <Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>From</TableHead><TableHead>Subject</TableHead><TableHead>Source</TableHead>{tab === "quarantine" && <TableHead className="text-right">Spam</TableHead>}<TableHead>Status</TableHead><TableHead>Received</TableHead></TableRow></TableHeader><TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell><Badge variant={TYPE_BADGE[s.type] ?? "secondary"}>{s.type}</Badge></TableCell>
                    <TableCell>
                      <div className="font-medium">{s.name ?? s.email ?? "—"}</div>
                      {s.email && <div className="text-xs text-muted-foreground">{s.email}</div>}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="link"
                         className="h-auto max-w-[260px] justify-start p-0 text-left text-foreground"
                        aria-label={`Open submission from ${s.name ?? s.email ?? "unknown sender"}`}
                        onClick={() => setOpen(s)}
                      >
                        <span className="block max-w-[260px] truncate">{s.subject ?? s.message ?? "—"}</span>
                      </Button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.source_name ?? "—"}</TableCell>
                    {tab === "quarantine" && (
                      <TableCell className="text-right tabular-nums"><Badge variant={s.spam_score >= 60 ? "destructive" : s.spam_score > 25 ? "warning" : "success"}>{s.spam_score}</Badge></TableCell>
                    )}
                    <TableCell><Badge variant={STATUS_BADGE[s.status] ?? "secondary"}>{s.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
          )}
          </CardContent></Card>
      )}

      {open && <SubmissionModal sub={open} onClose={() => setOpen(null)} onChanged={() => subs.reload()} />}
    </div>
  );
}

function SubmissionModal({ sub, onClose, onChanged }: { sub: Submission; onClose: () => void; onChanged: () => void }) {
  const { notify } = useToast();
  const detail = useFetch<Submission>(`/api/intake/submissions/${sub.id}`);
  const [deleting, setDeleting] = useState(false);
  const s = detail.data ?? sub;

  async function patch(body: Record<string, unknown>) {
    await api(`/api/intake/submissions/${sub.id}`, { method: "PATCH", body });
    detail.reload();
    onChanged();
  }
  async function convert(kind: "lead" | "ticket") {
    try {
      await api(`/api/intake/submissions/${sub.id}/convert-${kind}`, { method: "POST" });
      notify(`Converted to ${kind}.`);
      detail.reload();
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function remove() {
    await api(`/api/intake/submissions/${sub.id}`, { method: "DELETE" });
    onChanged();
    onClose();
  }
  async function release() {
    await api(`/api/intake/submissions/${sub.id}/release`, { method: "POST" });
    notify("Released to inbox.");
    detail.reload();
    onChanged();
  }

  const held = s.status === "quarantined" || s.status === "spam";

  return (
    <Modal title={s.subject || `${s.type} from ${s.name ?? s.email ?? "website"}`} onClose={onClose} maxWidth={560}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant={TYPE_BADGE[s.type] ?? "secondary"}>{s.type}</Badge>
        <Badge variant={STATUS_BADGE[s.status] ?? "secondary"}>{s.status.replace("_", " ")}</Badge>
        {s.source_name && <Badge variant="secondary">{s.source_name}</Badge>}
        {s.converted_lead_id && <Badge variant="success">→ lead</Badge>}
        {s.converted_ticket_id && <Badge variant="success">→ ticket</Badge>}
      </div>

      {held && (
        <div className="mb-3 bg-muted p-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              Spam score: <Badge variant={s.spam_score >= 60 ? "destructive" : s.spam_score > 25 ? "warning" : "success"}>{s.spam_score}/100</Badge>
            </span>
            <Button type="button" size="sm" onClick={release}>Release to inbox</Button>
          </div>
          {s.spam_reasons && s.spam_reasons.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
              {s.spam_reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-sm">
        <Field label="Name" value={s.name} />
        <Field label="Email" value={s.email} />
        <Field label="Phone" value={s.phone} />
        <Field label="Company" value={s.company} />
      </div>
      {s.message && <div className="mt-2"><div className="text-xs text-muted-foreground">Message</div><p className="whitespace-pre-wrap text-sm">{s.message}</p></div>}
      {s.page_url && (
        <a
          href={s.page_url}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "link" }), "h-auto px-0")}
        >
          Source page ↗
        </a>
      )}
      {s.payload && Object.keys(s.payload).length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-muted-foreground">Other fields</div>
          <div className="bg-muted p-2 text-xs">
            {Object.entries(s.payload).map(([k, v]) => (
              <div key={k}>
                {/* Show the human label the form gave this field, falling back
                    to its raw name when the form has not been mapped yet. */}
                <span className="text-muted-foreground">{s.field_labels?.[k] ?? k}:</span>{" "}
                {Array.isArray(v) ? v.join(", ") : String(v)}
              </div>
            ))}
          </div>
        </div>
      )}
      {(s.form_name || s.site_url) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {s.site_url && <span>{s.site_url}</span>}
          {s.form_name && <Badge variant="secondary">{s.form_name}</Badge>}
          {s.mapping_status && s.mapping_status !== "mapped" && (
            <Badge variant={s.mapping_status === "partial" ? "destructive" : "warning"}>
              mapping: {s.mapping_status}
            </Badge>
          )}
          {s.form_id && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs"
              render={<Link to={`/inbox/forms/${s.form_id}`} />}
            >
              Edit field mapping
            </Button>
          )}
        </div>
      )}
      {s.utm && Object.keys(s.utm).length > 0 && (
        <p className="mt-2 mb-0 text-xs text-muted-foreground">
          {Object.entries(s.utm).map(([k, v]) => `${k}=${v}`).join(" · ")}
        </p>
      )}

      <FieldGroup className="mt-4 grid gap-4 sm:grid-cols-2"><FormField><FieldLabel htmlFor="submission-status">Status</FieldLabel><Select items={STATUSES.map((st) => ({ value: st, label: st.replace("_", " ") }))} value={s.status} onValueChange={(value) => value !== null && patch({ status: value })}><SelectTrigger id="submission-status" aria-label="Status" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{STATUSES.map((st) => <SelectItem key={st} value={st}>{st.replace("_", " ")}</SelectItem>)}</SelectGroup></SelectContent></Select></FormField><FormField><FieldLabel htmlFor="submission-type">Type</FieldLabel><Select items={TYPES.map((t) => ({ value: t, label: t }))} value={s.type} onValueChange={(value) => value !== null && patch({ type: value })}><SelectTrigger id="submission-type" aria-label="Type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectGroup></SelectContent></Select></FormField></FieldGroup>

      <div className="mt-4 flex flex-col-reverse justify-between gap-2 sm:flex-row">
        <Button type="button" variant="destructive" onClick={() => setDeleting(true)}>Delete</Button>
        <span className="flex gap-2">
          {!s.converted_ticket_id && (
            <Button type="button" variant="outline" onClick={() => convert("ticket")}><TicketIcon data-icon="inline-start" /> To ticket</Button>
          )}
          {!s.converted_lead_id && (
            <Button type="button" onClick={() => convert("lead")}><UserPlus data-icon="inline-start" /> To CRM lead</Button>
          )}
        </span>
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete submission"
          message="Delete this submission?"
          confirmLabel="Delete submission"
          danger
          onConfirm={remove}
          onClose={() => setDeleting(false)}
        />
      )}
    </Modal>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <div><div className="text-xs text-muted-foreground">{label}</div><div>{value}</div></div>;
}

const FORM_STATUS_BADGE: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  mapped: "success", auto: "warning", partial: "destructive", none: "secondary",
};

const DESTINATION_LABEL: Record<string, string> = {
  crm_lead: "CRM lead",
  candidate: "Recruiting",
  ticket: "Ticket",
  inbox_only: "Inbox only",
};

function FormsTab() {
  const forms = useFetch<IntakeForm[]>("/api/intake/forms");
  const [needsReview, setNeedsReview] = useState(false);

  const rows = (forms.data ?? []).filter(
    (f) => !needsReview || f.mapping_status !== "mapped",
  );

  return (
    <Card className="py-0">
      <CardHeader className="py-(--card-spacing)">
        <p className="text-sm text-muted-foreground">
          Every form that has sent us anything. Because field names differ per site and
          per form, each one carries its own mapping onto the columns the CRM uses.
        </p>
        <ToggleGroup
          value={needsReview ? ["review"] : []}
          onValueChange={(value) => setNeedsReview(value.includes("review"))}
          variant="outline"
          spacing={0}
        >
          <ToggleGroupItem value="review">Needs review</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent className={rows.length > 0 ? "p-0" : undefined}>
        {forms.loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty
            icon={<FileInput />}
            message={needsReview ? "Every form is mapped" : "No forms seen yet"}
            hint="A form appears here the first time it sends a submission, or when the WordPress plugin pushes its field list."
          />
        ) : (
          <>
            {/* Mobile: cards, because this table loses its meaning when squeezed. */}
            <div className="flex flex-col gap-3 p-4 md:hidden">
              {rows.map((f) => (
                <div key={f.id} className="border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-left font-medium text-foreground"
                      render={<Link to={`/inbox/forms/${f.id}`} />}
                    >
                      {f.name}
                    </Button>
                    <Badge variant={FORM_STATUS_BADGE[f.mapping_status] ?? "secondary"}>
                      {f.mapping_status}
                    </Badge>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-muted-foreground">
                    {f.source_name ?? "—"} · {f.field_count} fields ·{" "}
                    {f.submission_count} received
                  </p>
                  <p className="mt-1 mb-0 text-xs text-muted-foreground">
                    Goes to {DESTINATION_LABEL[f.destination] ?? f.destination}
                  </p>
                </div>
              ))}
            </div>

            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form</TableHead>
                    <TableHead>Website</TableHead>
                    <TableHead>Goes to</TableHead>
                    <TableHead>Fields</TableHead>
                    <TableHead>Mapping</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto justify-start p-0 text-left text-foreground"
                          render={<Link to={`/inbox/forms/${f.id}`} />}
                        >
                          {f.name}
                        </Button>
                        <div className="text-xs text-muted-foreground">{f.form_key}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {f.source_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {DESTINATION_LABEL[f.destination] ?? f.destination}
                      </TableCell>
                      <TableCell className="tabular-nums">{f.field_count}</TableCell>
                      <TableCell>
                        <Badge variant={FORM_STATUS_BADGE[f.mapping_status] ?? "secondary"}>
                          {f.mapping_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {f.submission_count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SourcesTab() {
  const { notify } = useToast();
  const sources = useFetch<IntakeSource[]>("/api/intake/sources");
  const [name, setName] = useState("");
  const [type, setType] = useState("lead");
  const [autoConvert, setAutoConvert] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<IntakeSource | null>(null);
  const [rotating, setRotating] = useState<IntakeSource | null>(null);
  const [clearingSecret, setClearingSecret] = useState<IntakeSource | null>(null);
  const [signingSecret, setSigningSecret] = useState<{ sourceName: string; value: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      await api("/api/intake/sources", { method: "POST", body: { name: name.trim(), default_type: type, auto_convert: autoConvert } });
      setName("");
      setAutoConvert(false);
      sources.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }
  async function toggleAuto(s: IntakeSource) {
    await api(`/api/intake/sources/${s.id}`, { method: "PATCH", body: { auto_convert: !s.auto_convert } });
    sources.reload();
  }
  async function toggle(s: IntakeSource) {
    await api(`/api/intake/sources/${s.id}`, { method: "PATCH", body: { active: !s.active } });
    sources.reload();
  }
  async function del(s: IntakeSource) {
    await api(`/api/intake/sources/${s.id}`, { method: "DELETE" });
    sources.reload();
  }
  async function rotate(s: IntakeSource) {
    await api(`/api/intake/sources/${s.id}/rotate-key`, { method: "POST" });
    sources.reload();
    notify("Token rotated.");
  }
  async function genSecret(s: IntakeSource) {
    const res = await api<{ signing_secret: string }>(`/api/intake/sources/${s.id}/signing-secret`, { method: "POST" });
    sources.reload();
    setSigningSecret({ sourceName: s.name, value: res.signing_secret });
  }
  async function clearSecret(s: IntakeSource) {
    await api(`/api/intake/sources/${s.id}/signing-secret`, { method: "DELETE" });
    sources.reload();
    notify("Signing secret removed.");
  }
  async function setLimit(s: IntakeSource, field: "rate_limit_per_min" | "dedup_window_min", value: number) {
    await api(`/api/intake/sources/${s.id}`, { method: "PATCH", body: { [field]: value } });
    sources.reload();
  }
  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text);
    notify(`${what} copied.`);
  }

  const ingestUrl = apiUrl("/api/intake/ingest");

  return (
    <><Card><CardContent className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Connected systems (e.g. WordPress) POST to <code>{ingestUrl}</code> with the
        source's API token in an <code>Authorization: Bearer &lt;token&gt;</code> (or
        <code> X-API-Key</code>) header. JSON body fields like <code>name, email, phone,
        subject, message, type</code> are mapped; anything else is kept as extra fields.
      </p>
      <form onSubmit={add} className="grid items-end gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)_auto_auto]"><FormField><FieldLabel htmlFor="source-name">Website / form name</FieldLabel><Input id="source-name" aria-label="Main website – contact form" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main website – contact form" /></FormField><FormField><FieldLabel htmlFor="source-type">Default type</FieldLabel><Select items={TYPES.map((t) => ({ value: t, label: t }))} value={type} onValueChange={(value) => setType(value ?? "")}><SelectTrigger id="source-type" aria-label="Default type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectGroup></SelectContent></Select></FormField><FormField orientation="horizontal"><Checkbox id="source-auto-convert" checked={autoConvert} onCheckedChange={(checked) => setAutoConvert(Boolean(checked))} /><FieldLabel htmlFor="source-auto-convert">Auto-convert clean leads</FieldLabel></FormField><Button type="submit" disabled={isSubmitting}><Plus data-icon="inline-start" /> {isSubmitting ? "Adding…" : "Add"}</Button></form>

      {sources.loading ? (
        <Loading />
      ) : (sources.data?.length ?? 0) === 0 ? (
        <Empty icon={<Cable />} message="No websites connected yet." />
      ) : (
        <div className="divide-y divide-border">
          {sources.data!.map((s) => (
            <div key={s.id} className="py-2">
              <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                <span className="font-medium">
                  {s.name} <span className="text-xs text-muted-foreground">· default {s.default_type} · {s.submission_count} received</span>
                  {s.auto_convert && <Badge variant="success" className="ml-1">auto-convert</Badge>}
                  {!s.active && <Badge variant="secondary" className="ml-1">inactive</Badge>}
                </span>
                <span className="flex flex-wrap gap-1">
                  <Button type="button" size="sm" variant="outline" onClick={() => toggleAuto(s)}>{s.auto_convert ? "Auto-convert: on" : "Auto-convert: off"}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setRotating(s)}>Rotate token</Button>
                  <Button aria-label="Toggle" type="button" size="sm" variant="outline" onClick={() => toggle(s)}>{s.active ? "Disable" : "Enable"}</Button>
                  <Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={() => setDeleting(s)}><Trash2 /></Button>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Token</span>
                <code className="flex-1 truncate bg-muted px-2 py-1 text-xs">{s.key}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => copy(s.key, "Token")}><Copy data-icon="inline-start" /> Copy</Button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Rate/min</span>
                <Input aria-label="Rate limit per minute" type="number" className="w-16" defaultValue={s.rate_limit_per_min} onBlur={(e) => { const v = numericInput(e.target.value, s.rate_limit_per_min); if (v !== s.rate_limit_per_min) setLimit(s, "rate_limit_per_min", v); }} />
                <span className="text-muted-foreground">Dedup min</span>
                <Input aria-label="Deduplication window in minutes" type="number" className="w-16" defaultValue={s.dedup_window_min} onBlur={(e) => { const v = numericInput(e.target.value, s.dedup_window_min); if (v !== s.dedup_window_min) setLimit(s, "dedup_window_min", v); }} />
                {s.has_signing_secret ? (
                  <>
                    <Badge variant="success">HMAC on</Badge>
                    <Button type="button" size="sm" variant="outline" onClick={() => genSecret(s)}>Regenerate secret</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setClearingSecret(s)}>Remove secret</Button>
                  </>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => genSecret(s)}>Enable HMAC signing</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </CardContent></Card>
    {deleting && (
      <ConfirmDialog
        title="Delete connected website"
        message={`Delete "${deleting.name}"? Its submissions are kept but unlinked.`}
        confirmLabel="Delete website"
        danger
        onConfirm={() => del(deleting)}
        onClose={() => setDeleting(null)}
      />
    )}
    {rotating && (
      <ConfirmDialog
        title="Rotate API token"
        message={`Rotate the API token for "${rotating.name}"? The old token stops working immediately.`}
        confirmLabel="Rotate token"
        onConfirm={() => rotate(rotating)}
        onClose={() => setRotating(null)}
      />
    )}
    {clearingSecret && (
      <ConfirmDialog
        title="Remove signing secret"
        message="Remove the signing secret? Requests will no longer require a signature."
        confirmLabel="Remove secret"
        danger
        onConfirm={() => clearSecret(clearingSecret)}
        onClose={() => setClearingSecret(null)}
      />
    )}
    {signingSecret && (
      <PromptModal
        title={`Signing secret for "${signingSecret.sourceName}"`}
        label="Copy this signing secret now — it won't be shown again. Sign the raw body with HMAC-SHA256 and send it as X-Signature: sha256=<hex>."
        defaultValue={signingSecret.value}
        submitLabel="Done"
        onConfirm={() => {}}
        onClose={() => setSigningSecret(null)}
      />
    )}</>
  );
}
