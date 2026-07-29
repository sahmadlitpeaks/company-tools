import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock, History, Lock, MessageSquare, Plus, RotateCcw, Send } from "lucide-react";
import { api } from "../api/client";
import type { ActivityEntry, Ticket, TicketDetail, User, WorkLog } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";
import Attachments from "../components/Attachments";
import SavedViews from "../components/SavedViews";
import { hm } from "./WorkLogPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES = ["it", "facilities", "hr", "finance", "other"];
const STATUSES = ["open", "in_progress", "resolved", "closed"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const OPEN_STATUSES = new Set(["open", "in_progress"]);
const STATUS_BADGE: Record<string, "info" | "warning" | "success" | "secondary"> = {
  open: "info", in_progress: "warning", resolved: "success", closed: "secondary",
};
const PRIO_BADGE: Record<string, "destructive" | "warning" | "secondary" | "info"> = { urgent: "destructive", high: "warning", normal: "secondary", low: "info" };

/** SLA state for the resolution target (open tickets only). */
function slaState(t: Ticket): { label: string; variant: "destructive" | "warning" | "success" } | null {
  if (!OPEN_STATUSES.has(t.status) || !t.sla_resolution_due) return null;
  const due = new Date(t.sla_resolution_due).getTime();
  const now = Date.now();
  if (now > due) return { label: "Overdue", variant: "destructive" };
  if ((due - now) / 3600000 < 4) return { label: "Due soon", variant: "warning" };
  return { label: "On track", variant: "success" };
}

function durationBetween(a?: string | null, b?: string | null): string {
  if (!a || !b) return "—";
  const mins = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
  return hm(Math.max(0, mins));
}

export default function ServiceDeskPage() {
  const { user } = useAuth();
  const isAgent = user?.is_admin || user?.role === "manager";
  const [scope, setScope] = useState<"all" | "mine" | "assigned" | "unassigned">("all");
  const [status, setRecordStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [sort, setSort] = useState("recent");
  const { notify } = useToast();

  const qs = useMemo(() => {
    const p = new URLSearchParams({ scope, sort });
    if (status) p.set("status", status);
    if (priority) p.set("priority", priority);
    if (overdue) p.set("overdue", "true");
    return p.toString();
  }, [scope, status, priority, overdue, sort]);
  const tickets = useFetch<Ticket[]>(`/api/tickets?${qs}`);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new")) {
      setAdding(true);
      setParams({}, { replace: true });
    } else if (params.get("open")) {
      setOpenId(params.get("open"));
    }
  }, [params, setParams]);

  async function assignToMe(e: React.MouseEvent, t: Ticket) {
    e.stopPropagation();
    await api(`/api/tickets/${t.id}`, { method: "PATCH", body: { assignee_id: user?.id } });
    notify(`Assigned #${t.number} to you.`);
    tickets.reload();
  }

  function applyView(p: string) {
    const u = new URLSearchParams(p);
    setScope((u.get("scope") as typeof scope) || "all");
    setRecordStatus(u.get("status") || "");
    setPriority(u.get("priority") || "");
    setOverdue(u.get("overdue") === "true");
    setSort(u.get("sort") || "recent");
  }

  return (
    <div>
      <PageHead
        title="Service Desk"
        subtitle="Raise and track IT, facilities and HR requests."
        action={
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus data-icon="inline-start" /> New ticket
          </Button>
        }
      />

      <Card className="mb-4"><CardContent className="flex flex-col gap-4">
        <SavedViews surface="tickets" currentParams={qs} onApply={applyView} />
        <FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Field><FieldLabel htmlFor="tickets-scope">Show</FieldLabel>
            <Select
              items={[{ value: "all", label: "All tickets" }, { value: "mine", label: "Raised by me" }, { value: "assigned", label: "Assigned to me" }, { value: "unassigned", label: "Unassigned" }]}
              value={scope}
              onValueChange={(value) => value !== null && setScope(value as typeof scope)}
            >
              <SelectTrigger id="tickets-scope" aria-label="Show" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="all">All tickets</SelectItem><SelectItem value="mine">Raised by me</SelectItem>
                <SelectItem value="assigned">Assigned to me</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel htmlFor="tickets-status">Status</FieldLabel>
            <Select
              items={[{ value: null, label: "All" }, ...STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))]}
              value={status || null}
              onValueChange={(value) => setRecordStatus(value ?? "")}
            >
              <SelectTrigger id="tickets-status" aria-label="Status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={null}>All</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel htmlFor="tickets-priority">Priority</FieldLabel>
            <Select
              items={[{ value: null, label: "All" }, ...PRIORITIES.map((p) => ({ value: p, label: p }))]}
              value={priority || null}
              onValueChange={(value) => setPriority(value ?? "")}
            >
              <SelectTrigger id="tickets-priority" aria-label="Priority" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value={null}>All</SelectItem>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel htmlFor="tickets-sort">Sort</FieldLabel>
            <Select
              items={[{ value: "recent", label: "Newest" }, { value: "priority", label: "Priority" }, { value: "due", label: "SLA due" }]}
              value={sort}
              onValueChange={(value) => setSort(value ?? "")}
            >
              <SelectTrigger id="tickets-sort" aria-label="Sort" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="recent">Newest</SelectItem><SelectItem value="priority">Priority</SelectItem><SelectItem value="due">SLA due</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel>Deadline</FieldLabel>
            <Button type="button" variant={overdue ? "default" : "outline"} onClick={() => setOverdue((o) => !o)}>
              Overdue only
            </Button>
          </Field>
        </FieldGroup>
      </CardContent></Card>

      <Card className="py-0"><CardContent className="p-0">
        {tickets.loading ? (
          <Loading />
        ) : (tickets.data?.length ?? 0) === 0 ? (
          <Empty message="No tickets here." />
        ) : (
          <Table>
            <TableHeader><TableRow>
                <TableHead className="text-right">#</TableHead><TableHead>Subject</TableHead><TableHead>Category</TableHead><TableHead>Priority</TableHead>
                <TableHead>SLA</TableHead><TableHead>Requester</TableHead><TableHead>Assignee</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {tickets.data!.map((t) => {
                const sla = slaState(t);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="text-right text-muted-foreground tabular-nums">#{t.number}</TableCell>
                    <TableCell className="max-w-[24rem] whitespace-normal">
                      <Button type="button" variant="link" className="h-auto max-w-full justify-start p-0 text-left font-semibold text-foreground" onClick={() => setOpenId(t.id)}><span className="truncate">{t.subject}</span></Button>
                      {t.comment_count > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <MessageSquare size={11} /> {t.comment_count}
                        </span>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{t.category}</Badge></TableCell>
                    <TableCell><Badge variant={PRIO_BADGE[t.priority] ?? "secondary"}>{t.priority}</Badge></TableCell>
                    <TableCell>{sla ? <Badge variant={sla.variant}>{sla.label}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{t.requester_name ?? "—"}</TableCell>
                    <TableCell>
                      {t.assignee_name ?? (
                        isAgent ? (
                          <Button type="button" variant="outline" size="sm" onClick={(e) => assignToMe(e, t)}>
                            Assign to me
                          </Button>
                        ) : (
                          "—"
                        )
                      )}
                    </TableCell>
                    <TableCell><Badge variant={STATUS_BADGE[t.status] ?? "secondary"}>{t.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right font-medium">Open ›</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent></Card>

      {adding && (
        <TicketModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            tickets.reload();
            setAdding(false);
          }}
        />
      )}
      {openId && (
        <TicketDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={tickets.reload} />
      )}
    </div>
  );
}

function TicketModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({ subject: "", description: "", category: "it", priority: "normal" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/tickets", { method: "POST", body: form });
      notify("Ticket raised.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="New ticket" onClose={onClose}>
      <form onSubmit={submit}>
        <FieldGroup>
        <Field><FieldLabel htmlFor="ticket-subject">Subject *</FieldLabel><Input id="ticket-subject" required value={form.subject} onChange={(e) => set("subject", e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="ticket-description">Describe the issue</FieldLabel><Textarea id="ticket-description" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="ticket-category">Category</FieldLabel>
            <Select items={CATEGORIES.map((c) => ({ value: c, label: c }))} value={form.category} onValueChange={(value) => set("category", value ?? "")}>
              <SelectTrigger id="ticket-category" aria-label="Category" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel htmlFor="ticket-priority">Priority</FieldLabel>
            <Select items={PRIORITIES.map((p) => ({ value: p, label: p }))} value={form.priority} onValueChange={(value) => set("priority", value ?? "")}>
              <SelectTrigger id="ticket-priority" aria-label="Priority" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <p className="text-xs text-muted-foreground">
          SLA targets are set automatically from the priority (urgent → 4h, high → 24h, normal → 72h, low → 120h).
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting…" : "Raise ticket"}
          </Button>
        </div>
        </FieldGroup>
      </form>
    </Modal>
  );
}

function TicketDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const { notify } = useToast();
  const detail = useFetch<TicketDetail>(`/api/tickets/${id}`);
  const users = useFetch<User[]>("/api/users");
  const activity = useFetch<ActivityEntry[]>(`/api/activity?entity_type=ticket&entity_id=${id}`);
  const [comment, setComment] = useState("");
  const [internal, setInternal] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const t = detail.data;
  const isAgent = user?.is_admin || user?.role === "manager";
  const canTriage = isAgent || t?.assignee_id === user?.id;

  useEffect(() => {
    if (t) setResolutionNote(t.resolution_note ?? "");
  }, [t]);

  async function patch(body: Record<string, unknown>) {
    await api(`/api/tickets/${id}`, { method: "PATCH", body });
    detail.reload();
    activity.reload();
    onChanged();
  }
  async function changeStatus(s: string) {
    if (s === "resolved" && !resolutionNote.trim()) {
      notify("Add a resolution note before resolving.", "error");
      return;
    }
    try {
      await patch({ status: s, ...(s === "resolved" ? { resolution_note: resolutionNote } : {}) });
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed", "error");
    }
  }
  async function send() {
    if (!comment.trim()) return;
    await api(`/api/tickets/${id}/comments`, { method: "POST", body: { body: comment, is_internal: internal } });
    setComment("");
    detail.reload();
    onChanged();
    notify(internal ? "Internal note added." : "Reply sent.");
  }

  const sla = t ? slaState(t) : null;
  const resolved = t && !OPEN_STATUSES.has(t.status);

  return (
    <Modal title={t ? `#${t.number} · ${t.subject}` : "Ticket"} onClose={onClose} maxWidth={640}>
      {!t ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGE[t.status] ?? "secondary"}>{t.status.replace("_", " ")}</Badge>
            <Badge variant="secondary">{t.category}</Badge>
            <Badge variant={PRIO_BADGE[t.priority] ?? "secondary"}>{t.priority}</Badge>
            {sla && <Badge variant={sla.variant}>{sla.label}</Badge>}
            <span className="text-xs text-muted-foreground">Raised by {t.requester_name ?? "—"}</span>
          </div>

          {/* SLA / timing summary */}
          <Card size="sm" className="mb-3 bg-muted/40"><CardContent className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[11px] text-muted-foreground">Resolution due</div>
              <div className="text-sm font-semibold">
                {t.sla_resolution_due ? new Date(t.sla_resolution_due).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">First response</div>
              <div className="text-sm font-semibold">{durationBetween(t.created_at, t.first_responded_at)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Time to resolve</div>
              <div className="text-sm font-semibold">{durationBetween(t.created_at, t.resolved_at)}</div>
            </div>
          </CardContent></Card>

          {t.description && (
            <Card size="sm" className="mb-3 bg-muted/40"><CardContent>{t.description}</CardContent></Card>
          )}

          {canTriage && (
            <>
              <FieldGroup className="mb-3 grid gap-3 sm:grid-cols-3">
                <Field><FieldLabel htmlFor="ticket-detail-status">Status</FieldLabel>
                  <Select items={STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))} value={t.status} onValueChange={(value) => value !== null && changeStatus(value)}>
                    <SelectTrigger id="ticket-detail-status" aria-label="Status" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                    </SelectGroup></SelectContent>
                  </Select>
                </Field>
                <Field><FieldLabel htmlFor="ticket-detail-priority">Priority</FieldLabel>
                  <Select items={PRIORITIES.map((p) => ({ value: p, label: p }))} value={t.priority} onValueChange={(value) => value !== null && patch({ priority: value })}>
                    <SelectTrigger id="ticket-detail-priority" aria-label="Priority" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectGroup></SelectContent>
                  </Select>
                </Field>
                <Field><FieldLabel htmlFor="ticket-detail-assignee">Assignee</FieldLabel>
                  <Select
                    items={[{ value: null, label: "Unassigned" }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]}
                    value={t.assignee_id ?? null}
                    onValueChange={(value) => patch({ assignee_id: value ?? null })}
                  >
                    <SelectTrigger id="ticket-detail-assignee" aria-label="Assignee" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value={null}>Unassigned</SelectItem>
                      {(users.data ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}
                    </SelectGroup></SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
              <Field><FieldLabel htmlFor="ticket-resolution">Resolution note {!resolved && <span className="text-xs text-muted-foreground">(required to resolve)</span>}</FieldLabel>
                <Textarea id="ticket-resolution"
                  rows={2}
                  placeholder="What was done to resolve this?"
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                />
              </Field>
            </>
          )}

          {resolved && t.resolution_note && (
            <Card size="sm" className="mb-3 bg-muted/40"><CardContent>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resolution</div>
              <div className="text-sm">{t.resolution_note}</div>
              {canTriage && (
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => changeStatus("open")}>
                  <RotateCcw data-icon="inline-start" /> Reopen
                </Button>
              )}
            </CardContent></Card>
          )}

          <div className="mb-3">
            <Attachments entityType="ticket" entityId={id} />
          </div>

          <TicketEffort ticketId={id} initial={t.effort_minutes} onLogged={detail.reload} />

          <h4 className="mb-2">Conversation</h4>
          <div className="mb-3 flex max-h-56 flex-col gap-2 overflow-auto">
            {t.comments.length === 0 && <p className="text-sm text-muted-foreground">No replies yet.</p>}
            {t.comments.map((c) => (
              <Card
                key={c.id}
                size="sm"
                className={c.is_internal ? "bg-primary/10" : "bg-muted/40"}
              >
                <CardHeader className="grid grid-cols-[1fr_auto] items-center">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    {c.author_name ?? "—"}
                    {c.is_internal && (
                      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-warning-foreground">
                        <Lock /> internal
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                </CardHeader>
                <CardContent className="text-sm">{c.body}</CardContent>
              </Card>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Field>
              <Input aria-label={internal ? "Write an internal note" : "Write a reply"}
                placeholder={internal ? "Write an internal note…" : "Write a reply…"}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
            </Field>
            <Button type="button" variant={internal ? "outline" : "default"}
              onClick={send}
            >
              <Send data-icon="inline-start" /> {internal ? "Add note" : "Send"}
            </Button>
          </div>
          {canTriage && (
            <Field orientation="horizontal" className="mt-2">
              <Checkbox id="ticket-internal" checked={internal} onCheckedChange={(checked) => setInternal(checked === true)} />
              <FieldLabel htmlFor="ticket-internal">Internal note (visible to agents only)</FieldLabel>
            </Field>
          )}

          {/* Activity timeline */}
          {(activity.data?.length ?? 0) > 0 && (
            <>
              <h4 className="mb-2 mt-4 inline-flex items-center gap-1.5">
                <History size={15} /> Activity
              </h4>
              <div className="flex flex-col gap-1.5">
                {activity.data!.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
                    <span>{a.summary}</span>
                    <span className="flex-none whitespace-nowrap text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function TicketEffort({
  ticketId,
  initial,
  onLogged,
}: {
  ticketId: string;
  initial: number;
  onLogged: () => void;
}) {
  const { notify } = useToast();
  const logs = useFetch<WorkLog[]>(`/api/worklogs?entity_type=ticket&entity_id=${ticketId}`);
  const [minutes, setMinutes] = useState("30");
  const [note, setNote] = useState("");

  async function log() {
    if (!note.trim()) return;
    await api("/api/worklogs", {
      method: "POST",
      body: {
        minutes: Number(minutes) || 0,
        description: note,
        kind: "ticket",
        entity_type: "ticket",
        entity_id: ticketId,
      },
    });
    setNote("");
    setMinutes("30");
    notify("Effort logged.");
    logs.reload();
    onLogged();
  }

  const total = (logs.data ?? []).reduce((s, l) => s + l.minutes, 0) || initial;

  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="inline-flex items-center gap-1.5">
          <Clock /> Effort
        </h4>
        <Badge variant="info">{hm(total)}</Badge>
      </div>
      {(logs.data?.length ?? 0) > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {logs.data!.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                <span className="font-medium">{l.user_name}</span>
                <span className="text-muted-foreground"> · {l.description}</span>
              </span>
              <span className="flex-none whitespace-nowrap text-muted-foreground">{hm(l.minutes)}</span>
            </div>
          ))}
        </div>
      )}
      <FieldGroup className="grid gap-2 sm:grid-cols-[1fr_6rem_auto] sm:items-end">
        <Field><FieldLabel htmlFor="effort-note" className="sr-only">What did you do?</FieldLabel>
          <Input id="effort-note" placeholder="What did you do?" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field><FieldLabel htmlFor="effort-minutes" className="sr-only">Minutes</FieldLabel>
          <Input id="effort-minutes" type="number" min="0" value={minutes} onChange={(e) => setMinutes(e.target.value)} title="Minutes" />
        </Field>
        <Button type="button" variant="outline" onClick={log}>
          <Clock data-icon="inline-start" /> Log
        </Button>
      </FieldGroup>
    </div>
  );
}
