import { useState } from "react";
import { CalendarDays, ClipboardList, MessageSquarePlus, Plus, Star, UsersRound } from "lucide-react";
import { api } from "../api/client";
import type { OneOnOne, Review, ReviewCycle, ReviewFeedback, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function PerformancePage() {
  const { user } = useAuth();
  const isHr = !!user?.is_admin || !!user?.effective_permissions?.includes("people_ops");
  const cycles = useFetch<ReviewCycle[]>(isHr ? "/api/performance/cycles" : null);
  const toReview = useFetch<Review[]>("/api/performance/reviews?scope=to_review");
  const mine = useFetch<Review[]>("/api/performance/reviews?scope=mine");
  const feedbackQueue = useFetch<ReviewFeedback[]>("/api/performance/feedback/mine");
  const oneOnOnes = useFetch<OneOnOne[]>("/api/performance/one-on-ones");
  const [newCycle, setNewCycle] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const [fillFeedback, setFillFeedback] = useState<ReviewFeedback | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [giving, setGiving] = useState(false);

  return (
    <div>
      <PageHead
        title="Performance"
        subtitle="Reviews, 360 feedback, 1:1s and continuous feedback."
        action={
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setGiving(true)}>
              <MessageSquarePlus size={15} /> Give feedback
            </button>
            {isHr && (
              <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setNewCycle(true)}>
                <Plus size={15} /> New cycle
              </button>
            )}
          </div>
        }
      />

      {/* 360 feedback requested from me */}
      {(feedbackQueue.data?.length ?? 0) > 0 && (
        <div className="card mb-4">
          <h3 className="mt-0 inline-flex items-center gap-2"><UsersRound size={18} className="text-brand-600" /> Feedback requested from you</h3>
          <div className="divide-y divide-slate-100">
            {feedbackQueue.data!.map((f) => (
              <div key={f.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="font-medium">{f.subject_name}</span>
                  <span className="muted"> · {f.cycle_name} · as {f.relation}</span>
                </span>
                <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={() => setFillFeedback(f)}>Give feedback</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <h3 className="mt-0 inline-flex items-center gap-2"><ClipboardList size={18} className="text-brand-600" /> Reviews to write</h3>
          {toReview.loading ? (
            <Loading />
          ) : (toReview.data?.length ?? 0) === 0 ? (
            <p className="muted">Nothing assigned to you.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {toReview.data!.map((r) => (
                <ReviewRow key={r.id} r={r} onClick={() => setEditing(r)} />
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="mt-0 inline-flex items-center gap-2"><Star size={18} className="text-brand-600" /> My reviews</h3>
          {mine.loading ? (
            <Loading />
          ) : (mine.data?.length ?? 0) === 0 ? (
            <p className="muted">No reviews yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {mine.data!.map((r) => (
                <div key={r.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.cycle_name}</span>
                    {r.rating != null && <span className="badge">{r.rating}/5</span>}
                  </div>
                  {r.summary && <p className="muted mt-1">{r.summary}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isHr && (
        <div className="card mt-4">
          <h3 className="mt-0">Review cycles</h3>
          {cycles.loading ? (
            <Loading />
          ) : (cycles.data?.length ?? 0) === 0 ? (
            <Empty message="No cycles yet." />
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
              {cycles.data!.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
                  <Ring done={c.submitted_count} total={c.review_count} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{c.name}</span>
                      <span className={`badge ${c.status === "open" ? "green" : ""}`}>{c.status}</span>
                    </div>
                    <div className="muted text-xs">{c.period ?? "—"}</div>
                    <div className="muted mt-0.5 text-xs">{c.submitted_count}/{c.review_count} submitted</div>
                    <div className="mt-2">
                      <CycleActions cycle={c} onChange={() => { cycles.reload(); toReview.reload(); }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 1:1 meetings */}
      <div className="card mt-4">
        <div className="spread">
          <h3 className="m-0 inline-flex items-center gap-2"><CalendarDays size={18} className="text-brand-600" /> 1:1 meetings</h3>
          <button className="btn-sm btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setScheduling(true)}>
            <Plus size={14} /> Schedule 1:1
          </button>
        </div>
        {oneOnOnes.loading ? (
          <Loading />
        ) : (oneOnOnes.data?.length ?? 0) === 0 ? (
          <Empty message="No 1:1s scheduled." />
        ) : (
          <div className="divide-y divide-slate-100">
            {oneOnOnes.data!.map((o) => (
              <OneOnOneRow key={o.id} o={o} meId={user?.id} onChange={() => oneOnOnes.reload()} />
            ))}
          </div>
        )}
      </div>

      {newCycle && <NewCycleModal onClose={() => setNewCycle(false)} onDone={() => { setNewCycle(false); cycles.reload(); }} />}
      {editing && <ReviewModal review={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toReview.reload(); }} />}
      {fillFeedback && <FeedbackModal fb={fillFeedback} onClose={() => setFillFeedback(null)} onDone={() => { setFillFeedback(null); feedbackQueue.reload(); }} />}
      {scheduling && <ScheduleOneOnOneModal onClose={() => setScheduling(false)} onDone={() => { setScheduling(false); oneOnOnes.reload(); }} />}
      {giving && <GiveFeedbackModal onClose={() => setGiving(false)} onDone={() => { setGiving(false); }} />}
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
  async function setStatus(status: string) {
    try {
      await api(`/api/performance/one-on-ones/${o.id}`, { method: "PATCH", body: { status } });
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <div className="py-2 text-sm">
      <div className="flex items-center justify-between">
        <button className="text-left font-medium hover:underline" onClick={() => setOpen((v) => !v)}>
          {other} <span className="muted font-normal">· {when}</span>
        </button>
        <span className={`badge ${o.status === "completed" ? "green" : o.status === "cancelled" ? "gray" : "amber"}`}>{o.status}</span>
      </div>
      {open && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2">
          {o.agenda.length === 0 ? <div className="muted text-xs">No agenda items.</div> : o.agenda.map((a, i) => (
            <label key={i} className="flex items-center gap-2"><input type="checkbox" checked={a.done} onChange={() => toggleItem(i)} /> <span className={a.done ? "line-through text-ink-muted" : ""}>{a.text}</span></label>
          ))}
          {o.shared_notes && <p className="muted mt-2 mb-0">{o.shared_notes}</p>}
          {o.status === "scheduled" && (
            <div className="row mt-2" style={{ gap: 6 }}>
              <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setStatus("completed")}>Mark complete</button>
              <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => setStatus("cancelled")}>Cancel</button>
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
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/performance/feedback/${fb.id}`, {
        method: "PATCH",
        body: { rating: rating ? Number(rating) : null, strengths: strengths || null, improvements: improvements || null },
      });
      notify("Feedback submitted.");
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Feedback on ${fb.subject_name}`} onClose={onClose} maxWidth={500}>
      <div className="field">
        <label>Overall rating</label>
        <select value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">No rating</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}
        </select>
      </div>
      <div className="field"><label>Strengths</label><textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} /></div>
      <div className="field"><label>Areas to improve</label><textarea value={improvements} onChange={(e) => setImprovements(e.target.value)} /></div>
      <div className="row mt-2" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Submitting…" : "Submit"}</button>
      </div>
    </Modal>
  );
}

function ScheduleOneOnOneModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const people = useFetch<User[]>("/api/users");
  const [employeeId, setEmployeeId] = useState("");
  const [when, setWhen] = useState("");
  const [agenda, setAgenda] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!employeeId || !when) { notify("Pick a person and a time", "error"); return; }
    setBusy(true);
    try {
      await api("/api/performance/one-on-ones", {
        method: "POST",
        body: {
          employee_id: employeeId,
          scheduled_at: new Date(when).toISOString(),
          agenda: agenda.filter((t) => t.trim()).map((t) => ({ text: t.trim() })),
        },
      });
      notify("1:1 scheduled.");
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="Schedule 1:1" onClose={onClose} maxWidth={480}>
      <div className="field">
        <label>With (your report)</label>
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Select…</option>
          {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>)}
        </select>
      </div>
      <div className="field"><label>When</label><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
      <label className="muted text-xs">Agenda</label>
      {agenda.map((t, i) => (
        <div key={i} className="mt-1 flex gap-1">
          <input className="flex-1" value={t} placeholder="Talking point" onChange={(e) => setAgenda((a) => a.map((x, j) => j === i ? e.target.value : x))} />
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAgenda((a) => a.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="btn-sm mt-1" style={{ flex: "0 0 auto" }} onClick={() => setAgenda((a) => [...a, ""])}>+ Add item</button>
      <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Scheduling…" : "Schedule"}</button>
      </div>
    </Modal>
  );
}

function GiveFeedbackModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const people = useFetch<User[]>("/api/users");
  const [toId, setToId] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!toId || !body.trim()) { notify("Pick a colleague and write feedback", "error"); return; }
    setBusy(true);
    try {
      await api("/api/performance/continuous-feedback", { method: "POST", body: { to_user_id: toId, body: body.trim() } });
      notify("Private feedback sent.");
      onDone();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="Give private feedback" onClose={onClose} maxWidth={460}>
      <p className="muted text-sm">Visible only to the recipient, their manager and HR.</p>
      <div className="field">
        <label>To</label>
        <select value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">Select a colleague…</option>
          {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>)}
        </select>
      </div>
      <div className="field"><label>Feedback</label><textarea value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <div className="row mt-2" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Sending…" : "Send"}</button>
      </div>
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
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="5" />
        <circle
          cx="24" cy="24" r={r} fill="none" stroke="var(--brand-600)" strokeWidth="5"
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
    <button className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-slate-50" onClick={onClick}>
      <span>
        <span className="font-medium">{r.user_name}</span>
        <span className="muted"> · {r.cycle_name}</span>
      </span>
      <span className={`badge ${r.status === "submitted" ? "green" : "amber"}`}>{r.status}</span>
    </button>
  );
}

function NewCycleModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [f, setF] = useState({ name: "", period: "", due_date: "" });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      await api("/api/performance/cycles", { method: "POST", body: { name: f.name.trim(), period: f.period || null, due_date: f.due_date || null } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }
  return (
    <Modal title="New review cycle" onClose={onClose} maxWidth={440}>
      <form onSubmit={submit}>
        <div className="field"><label>Name</label><input value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="2026 H1 Review" /></div>
        <div className="row">
          <div className="field"><label>Period</label><input value={f.period} onChange={(e) => setF((p) => ({ ...p, period: e.target.value }))} placeholder="H1 2026" /></div>
          <div className="field"><label>Due</label><input type="date" value={f.due_date} onChange={(e) => setF((p) => ({ ...p, due_date: e.target.value }))} /></div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>Create</button>
        </div>
      </form>
    </Modal>
  );
}

function CycleActions({ cycle, onChange }: { cycle: ReviewCycle; onChange: () => void }) {
  const { notify } = useToast();
  const users = useFetch<User[]>("/api/users");
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");

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
    <span className="inline-flex items-center gap-1">
      {adding ? (
        <>
          <select className="!w-auto !py-1 text-xs" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Pick person…</option>
            {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>)}
          </select>
          <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={addReview}>Add</button>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAdding(false)}>×</button>
        </>
      ) : (
        <>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAdding(true)}>+ Review</button>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={toggleStatus}>{cycle.status === "open" ? "Close" : "Reopen"}</button>
        </>
      )}
    </span>
  );
}

function ReviewModal({ review, onClose, onDone }: { review: Review; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [rating, setRating] = useState(review.rating ?? 0);
  const [summary, setSummary] = useState(review.summary ?? "");
  const [busy, setBusy] = useState(false);

  async function save(status: string) {
    setBusy(true);
    try {
      await api(`/api/performance/reviews/${review.id}`, {
        method: "PATCH",
        body: { rating: rating || null, summary: summary || null, status },
      });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Review · ${review.user_name}`} onClose={onClose} maxWidth={520}>
      <div className="muted mb-2 text-sm">{review.cycle_name}</div>
      <div className="field">
        <label>Rating</label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className="btn-sm"
              style={{ flex: "0 0 auto", background: n <= rating ? "var(--brand-500)" : undefined, color: n <= rating ? "#fff" : undefined }}
              onClick={() => setRating(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="field"><label>Summary</label><textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" style={{ flex: "0 0 auto" }} disabled={busy} onClick={() => save("pending")}>Save draft</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={() => save("submitted")}>Submit</button>
      </div>
    </Modal>
  );
}
