import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState } from "react";
import { CalendarDays, ClipboardList, MessageSquarePlus, Plus, Star, UsersRound } from "lucide-react";
import { api } from "../api/client";
import type { OneOnOne, Review, ReviewCycle, ReviewFeedback, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, ErrorState, Loading, MetricStrip, Modal, PageHead, useToast } from "../components/ui";

type PeopleRequest = {
  data: User[] | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export default function PerformancePage() {
  const { user } = useAuth();
  const isHr = !!user?.is_admin || !!user?.effective_permissions?.includes("people_ops");
  const cycles = useFetch<ReviewCycle[]>(isHr ? "/api/performance/cycles" : null);
  const toReview = useFetch<Review[]>("/api/performance/reviews?scope=to_review");
  const mine = useFetch<Review[]>("/api/performance/reviews?scope=mine");
  const feedbackQueue = useFetch<ReviewFeedback[]>("/api/performance/feedback/mine");
  const oneOnOnes = useFetch<OneOnOne[]>("/api/performance/one-on-ones");
  const people = useFetch<User[]>("/api/users");
  const [newCycle, setNewCycle] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const [fillFeedback, setFillFeedback] = useState<ReviewFeedback | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [giving, setGiving] = useState(false);
  const reviewItems = toReview.data ?? [];
  const myReviewItems = mine.data ?? [];
  const feedbackItems = feedbackQueue.data ?? [];
  const cycleItems = cycles.data ?? [];
  const oneOnOneItems = oneOnOnes.data ?? [];

  return (
    <div>
      <PageHead
        title="Performance"
        subtitle="Reviews, 360 feedback, 1:1s and continuous feedback."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setGiving(true)}><MessageSquarePlus data-icon="inline-start" /> Give feedback</Button>
            {isHr && (
              <Button type="button" onClick={() => setNewCycle(true)}><Plus data-icon="inline-start" /> New cycle</Button>
            )}
          </div>
        }
      />

      {/* Summary */}
      <div className="mb-4">
        <MetricStrip
          items={[
            { value: toReview.error ? "Unavailable" : reviewItems.filter((r) => r.status !== "submitted").length, label: "Reviews to write" },
            { value: feedbackQueue.error ? "Unavailable" : feedbackItems.length, label: "Feedback requested" },
            { value: oneOnOnes.error ? "Unavailable" : oneOnOneItems.filter((o) => o.status === "scheduled").length, label: "Upcoming 1:1s" },
            ...(isHr
              ? [{ value: cycles.error ? "Unavailable" : cycleItems.filter((c) => c.status === "open").length, label: "Open cycles" }]
              : []),
          ]}
        />
      </div>

      {/* 360 feedback requested from me */}
      {feedbackQueue.error ? (
        <Card className="mb-4"><CardContent><ErrorState message={feedbackQueue.error} onRetry={feedbackQueue.reload} /></CardContent></Card>
      ) : feedbackItems.length > 0 && (
        <Card className="mb-4"><CardHeader><CardTitle className="inline-flex items-center gap-2"><UsersRound /> Feedback requested from you</CardTitle></CardHeader><CardContent><div className="divide-y divide-border">
            {feedbackItems.map((f) => (
              <div key={f.id} className="flex flex-col items-start justify-between gap-2 py-2 text-sm sm:flex-row sm:items-center">
                <span className="min-w-0">
                  <span className="font-medium">{f.subject_name}</span>
                  <span className="text-muted-foreground"> · {f.cycle_name} · as {f.relation}</span>
                </span>
                <Button type="button" size="sm" onClick={() => setFillFeedback(f)}>Give feedback</Button>
              </div>
            ))}
          </div></CardContent></Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="inline-flex items-center gap-2"><ClipboardList /> Reviews to write</CardTitle></CardHeader><CardContent>
          {toReview.loading ? (
            <Loading />
          ) : toReview.error ? (
            <ErrorState message={toReview.error} onRetry={toReview.reload} />
          ) : reviewItems.length === 0 ? (
            <p className="text-muted-foreground">Nothing assigned to you.</p>
          ) : (
            <div className="divide-y divide-border">
              {reviewItems.map((r) => (
                <ReviewRow key={r.id} r={r} onClick={() => setEditing(r)} />
              ))}
            </div>
          )}
        </CardContent></Card>

        <Card><CardHeader><CardTitle className="inline-flex items-center gap-2"><Star /> My reviews</CardTitle></CardHeader><CardContent>
          {mine.loading ? (
            <Loading />
          ) : mine.error ? (
            <ErrorState message={mine.error} onRetry={mine.reload} />
          ) : myReviewItems.length === 0 ? (
            <p className="text-muted-foreground">No reviews yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {myReviewItems.map((r) => (
                <div key={r.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.cycle_name}</span>
                    {r.rating != null && <Badge variant="secondary">{r.rating}/5</Badge>}
                  </div>
                  {r.summary && <p className="mt-1 text-muted-foreground">{r.summary}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>
      </div>

      {isHr && (
        <Card className="mt-4"><CardHeader><CardTitle>Review cycles</CardTitle></CardHeader><CardContent>
          {cycles.loading ? (
            <Loading />
          ) : cycles.error ? (
            <ErrorState message={cycles.error} onRetry={cycles.reload} />
          ) : cycleItems.length === 0 ? (
            <Empty message="No cycles yet." />
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {cycleItems.map((c) => (
                <div key={c.id} className="flex items-center gap-3 border border-border p-4">
                  <Ring done={c.submitted_count} total={c.review_count} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{c.name}</span>
                      <Badge variant={c.status === "open" ? "success" : "secondary"}>{c.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{c.period ?? "—"}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{c.submitted_count}/{c.review_count} submitted</div>
                    <div className="mt-2">
                      <CycleActions cycle={c} people={people} onChange={() => { cycles.reload(); toReview.reload(); }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>
      )}

      {/* 1:1 meetings */}
      <Card className="mt-4"><CardHeader><CardTitle className="inline-flex items-center gap-2"><CalendarDays /> 1:1 meetings</CardTitle><CardAction><Button type="button" size="sm" onClick={() => setScheduling(true)}><Plus data-icon="inline-start" /> Schedule 1:1</Button></CardAction></CardHeader><CardContent>
        {oneOnOnes.loading ? (
          <Loading />
        ) : oneOnOnes.error ? (
          <ErrorState message={oneOnOnes.error} onRetry={oneOnOnes.reload} />
        ) : oneOnOneItems.length === 0 ? (
          <Empty message="No 1:1s scheduled." />
        ) : (
          <div className="divide-y divide-border">
            {oneOnOneItems.map((o) => (
              <OneOnOneRow key={o.id} o={o} meId={user?.id} onChange={() => oneOnOnes.reload()} />
            ))}
          </div>
        )}
      </CardContent></Card>

      {newCycle && <NewCycleModal onClose={() => setNewCycle(false)} onDone={() => { setNewCycle(false); cycles.reload(); }} />}
      {editing && <ReviewModal review={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toReview.reload(); }} />}
      {fillFeedback && <FeedbackModal fb={fillFeedback} onClose={() => setFillFeedback(null)} onDone={() => { setFillFeedback(null); feedbackQueue.reload(); }} />}
      {scheduling && <ScheduleOneOnOneModal people={people} onClose={() => setScheduling(false)} onDone={() => { setScheduling(false); oneOnOnes.reload(); }} />}
      {giving && <GiveFeedbackModal people={people} onClose={() => setGiving(false)} onDone={() => { setGiving(false); }} />}
    </div>
  );
}

function OneOnOneRow({ o, meId, onChange }: { o: OneOnOne; meId?: string; onChange: () => void }) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const other = o.manager_id === meId ? o.employee_name : o.manager_name;
  const when = new Date(o.scheduled_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  async function toggleItem(idx: number) {
    const agenda = o.agenda.map((a, i) => (i === idx ? { ...a, done: !a.done } : a));
    await api(`/api/performance/one-on-ones/${o.id}`, { method: "PATCH", body: { agenda } });
    onChange();
  }
  async function setRecordStatus(status: string) {
    try {
      await api(`/api/performance/one-on-ones/${o.id}`, { method: "PATCH", body: { status } });
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <div className="py-2 text-sm">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <Button type="button" variant="link" className="h-auto min-w-0 whitespace-normal p-0 text-left font-medium" onClick={() => setOpen((v) => !v)}>
          {other} <span className="font-normal text-muted-foreground">· {when}</span>
        </Button>
        <Badge variant={o.status === "completed" ? "success" : o.status === "cancelled" ? "secondary" : "warning"}>{o.status}</Badge>
      </div>
      {open && (
        <div className="mt-2 bg-muted p-2">
          {o.agenda.length === 0 ? <div className="text-xs text-muted-foreground">No agenda items.</div> : o.agenda.map((a, i) => (
            <Field key={a.text} orientation="horizontal"><Checkbox id={`agenda-${o.id}-${i}`} checked={a.done} onCheckedChange={() => toggleItem(i)} /><FieldLabel htmlFor={`agenda-${o.id}-${i}`} className={a.done ? "line-through text-muted-foreground" : ""}>{a.text}</FieldLabel></Field>
          ))}
          {o.shared_notes && <p className="mt-2 mb-0 text-muted-foreground">{o.shared_notes}</p>}
          {o.status === "scheduled" && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button type="button" size="sm" variant="outline" onClick={() => setRecordStatus("completed")}>Mark complete</Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => setRecordStatus("cancelled")}>Cancel</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FeedbackModal({ fb, onClose, onDone }: { fb: ReviewFeedback; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [rating, setRating] = useState("");
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function save() {
    setIsSubmitting(true);
    try {
      await api(`/api/performance/feedback/${fb.id}`, {
        method: "PATCH",
        body: { rating: rating ? Number(rating) : null, strengths: strengths || null, improvements: improvements || null },
      });
      notify("Feedback submitted.");
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Feedback on ${fb.subject_name}`} onClose={onClose} maxWidth={500}>
      <FieldGroup><Field><FieldLabel htmlFor="feedback-rating">Overall rating</FieldLabel><Select items={[{ value: null, label: "No rating" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}/5` }))]} value={rating || null} onValueChange={(value) => setRating(value ?? "")}><SelectTrigger id="feedback-rating" aria-label="Overall rating" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>No rating</SelectItem>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}/5</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="feedback-strengths">Strengths</FieldLabel><Textarea id="feedback-strengths" value={strengths} onChange={(e) => setStrengths(e.target.value)} /></Field><Field><FieldLabel htmlFor="feedback-improvements">Areas to improve</FieldLabel><Textarea id="feedback-improvements" value={improvements} onChange={(e) => setImprovements(e.target.value)} /></Field></FieldGroup>
      <div className="mt-2 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Submitting…" : "Submit"}</Button>
      </div>
    </Modal>
  );
}

function ScheduleOneOnOneModal({ people, onClose, onDone }: { people: PeopleRequest; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [employeeId, setEmployeeId] = useState("");
  const [when, setWhen] = useState("");
  const [agenda, setAgenda] = useState<{ id: string; text: string }[]>([
    { id: crypto.randomUUID(), text: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const peopleItems = people.data ?? [];

  async function save() {
    if (!employeeId || !when) { notify("Pick a person and a time", "error"); return; }
    setIsSubmitting(true);
    try {
      await api("/api/performance/one-on-ones", {
        method: "POST",
        body: {
          employee_id: employeeId,
          scheduled_at: new Date(when).toISOString(),
          agenda: agenda
            .filter((item) => item.text.trim())
            .map((item) => ({ text: item.text.trim() })),
        },
      });
      notify("1:1 scheduled.");
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Schedule 1:1" onClose={onClose} maxWidth={480}>
      {people.loading ? <Loading /> : people.error ? (
        <ErrorState message={people.error} onRetry={people.reload} />
      ) : (
      <>
      <FieldGroup><Field><FieldLabel htmlFor="one-on-one-person">With (your report)</FieldLabel><Select items={[{ value: null, label: "Select…" }, ...peopleItems.map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]} value={employeeId || null} onValueChange={(value) => setEmployeeId(value ?? "")}><SelectTrigger id="one-on-one-person" aria-label="With (your report)" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Select…</SelectItem>{peopleItems.map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="one-on-one-when">When</FieldLabel><Input id="one-on-one-when" aria-label="datetime-local" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field></FieldGroup>
      <FieldLabel className="mt-4">Agenda</FieldLabel>
      {agenda.map((item, i) => (
        <div key={item.id} className="mt-1 flex gap-1">
          <Input aria-label="Talking point" className="flex-1" value={item.text} placeholder="Talking point" onChange={(e) => setAgenda((items) => items.map((entry, j) => j === i ? { ...entry, text: e.target.value } : entry))} />
          <Button type="button" size="icon-sm" variant="destructive" aria-label="Remove agenda item" onClick={() => setAgenda((a) => a.filter((_, j) => j !== i))}>×</Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="mt-1" onClick={() => setAgenda((items) => [...items, { id: crypto.randomUUID(), text: "" }])}>+ Add item</Button>
      <div className="mt-3 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Scheduling…" : "Schedule"}</Button>
      </div>
      </>
      )}
    </Modal>
  );
}

function GiveFeedbackModal({ people, onClose, onDone }: { people: PeopleRequest; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [toId, setToId] = useState("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const peopleItems = people.data ?? [];

  async function save() {
    if (!toId || !body.trim()) { notify("Pick a colleague and write feedback", "error"); return; }
    setIsSubmitting(true);
    try {
      await api("/api/performance/continuous-feedback", { method: "POST", body: { to_user_id: toId, body: body.trim() } });
      notify("Private feedback sent.");
      onDone();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Give private feedback" onClose={onClose} maxWidth={460}>
      {people.loading ? <Loading /> : people.error ? (
        <ErrorState message={people.error} onRetry={people.reload} />
      ) : (
      <>
      <p className="text-sm text-muted-foreground">Visible only to the recipient, their manager and HR.</p>
      <FieldGroup><Field><FieldLabel htmlFor="continuous-feedback-to">To</FieldLabel><Select items={[{ value: null, label: "Select a colleague…" }, ...peopleItems.map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]} value={toId || null} onValueChange={(value) => setToId(value ?? "")}><SelectTrigger id="continuous-feedback-to" aria-label="To" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Select a colleague…</SelectItem>{peopleItems.map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="continuous-feedback-body">Feedback</FieldLabel><Textarea id="continuous-feedback-body" value={body} onChange={(e) => setBody(e.target.value)} /></Field></FieldGroup>
      <div className="mt-2 flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button aria-label="Save" type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Sending…" : "Send"}</Button>
      </div>
      </>
      )}
    </Modal>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 18;
  const circ = 2 * Math.PI * r;
  return (
    <span className="relative grid h-12 w-12 flex-none place-items-center">
      <svg width="48" height="48" className="-rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" className="stroke-muted" strokeWidth="5" />
        <circle
          cx="24" cy="24" r={r} fill="none" className="stroke-primary" strokeWidth="5"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
        />
      </svg>
      <span className="absolute text-[11px] font-bold">{pct}%</span>
    </span>
  );
}

function ReviewRow({ r, onClick }: { r: Review; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" className="h-auto w-full justify-between py-2 text-left" onClick={onClick}>
      <span>
        <span className="font-medium">{r.user_name}</span>
        <span className="text-muted-foreground"> · {r.cycle_name}</span>
      </span>
      <Badge variant={r.status === "submitted" ? "success" : "warning"}>{r.status}</Badge>
    </Button>
  );
}

function NewCycleModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [f, setF] = useState({ name: "", period: "", due_date: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return;
    setIsSubmitting(true);
    try {
      await api("/api/performance/cycles", { method: "POST", body: { name: f.name.trim(), period: f.period || null, due_date: f.due_date || null } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <Modal title="New review cycle" onClose={onClose} maxWidth={440}>
      <form onSubmit={submit} className="flex flex-col gap-4"><FieldGroup><Field><FieldLabel htmlFor="cycle-name">Name</FieldLabel><Input id="cycle-name" aria-label="2026 H1 Review" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="2026 H1 Review" /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="cycle-period">Period</FieldLabel><Input id="cycle-period" aria-label="H1 2026" value={f.period} onChange={(e) => setF((p) => ({ ...p, period: e.target.value }))} placeholder="H1 2026" /></Field><Field><FieldLabel htmlFor="cycle-due">Due</FieldLabel><Input id="cycle-due" type="date" value={f.due_date} onChange={(e) => setF((p) => ({ ...p, due_date: e.target.value }))} /></Field>
        </div>
        </FieldGroup><div className="flex flex-col-reverse justify-end gap-2 sm:flex-row"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CycleActions({ cycle, people, onChange }: { cycle: ReviewCycle; people: PeopleRequest; onChange: () => void }) {
  const { notify } = useToast();
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");
  const userItems = people.data ?? [];

  async function addReview() {
    if (!pick) return;
    try {
      await api("/api/performance/reviews", { method: "POST", body: { cycle_id: cycle.id, user_id: pick } });
      setPick("");
      setAdding(false);
      onChange();
      notify("Review created.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function toggleStatus() {
    await api(`/api/performance/cycles/${cycle.id}`, { method: "PATCH", body: { status: cycle.status === "open" ? "closed" : "open" } });
    onChange();
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {adding ? (
        people.loading ? <Loading /> : people.error ? (
          <ErrorState message={people.error} onRetry={people.reload} />
        ) : <>
          <Select items={[{ value: null, label: "Pick person…" }, ...userItems.map((u) => ({ value: u.id, label: u.display_name ?? u.email }))]} value={pick || null} onValueChange={(value) => setPick(value ?? "")}><SelectTrigger id={`review-person-${cycle.id}`} aria-label="Pick person" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Pick person…</SelectItem>{userItems.map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name ?? u.email}</SelectItem>)}</SelectGroup></SelectContent></Select>
          <Button type="button" size="sm" onClick={addReview}>Add</Button><Button type="button" size="icon-sm" variant="outline" aria-label="Cancel adding review" onClick={() => setAdding(false)}>×</Button>
        </>
      ) : (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>+ Review</Button><Button type="button" size="sm" variant="outline" onClick={toggleStatus}>{cycle.status === "open" ? "Close" : "Reopen"}</Button>
        </>
      )}
    </div>
  );
}

function ReviewModal({ review, onClose, onDone }: { review: Review; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [rating, setRating] = useState(review.rating ?? 0);
  const [summary, setSummary] = useState(review.summary ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function save(status: string) {
    setIsSubmitting(true);
    try {
      await api(`/api/performance/reviews/${review.id}`, {
        method: "PATCH",
        body: { rating: rating || null, summary: summary || null, status },
      });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Review · ${review.user_name}`} onClose={onClose} maxWidth={520}>
      <div className="mb-2 text-sm text-muted-foreground">{review.cycle_name}</div>
      <FieldGroup><Field><FieldLabel>Rating</FieldLabel><ToggleGroup value={rating ? [String(rating)] : []} onValueChange={(value) => setRating(Number(value[0] ?? 0))} variant="outline" spacing={0}>
          {[1, 2, 3, 4, 5].map((n) => (
            <ToggleGroupItem aria-label={`Rating ${n}`} key={n} value={String(n)}>{n}</ToggleGroupItem>
          ))}
        </ToggleGroup></Field><Field><FieldLabel htmlFor="review-summary">Summary</FieldLabel><Textarea id="review-summary" rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field></FieldGroup>
      <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => save("pending")}>Save draft</Button><Button type="button" disabled={isSubmitting} onClick={() => save("submitted")}>Submit</Button>
      </div>
    </Modal>
  );
}
