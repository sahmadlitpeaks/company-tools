import { useState } from "react";
import { ClipboardList, Plus, Star } from "lucide-react";
import { api } from "../api/client";
import type { Review, ReviewCycle, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function PerformancePage() {
  const { user } = useAuth();
  const isHr = !!user?.is_admin || !!user?.effective_permissions?.includes("people_ops");
  const cycles = useFetch<ReviewCycle[]>(isHr ? "/api/performance/cycles" : null);
  const toReview = useFetch<Review[]>("/api/performance/reviews?scope=to_review");
  const mine = useFetch<Review[]>("/api/performance/reviews?scope=mine");
  const [newCycle, setNewCycle] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);

  return (
    <div>
      <PageHead
        title="Performance"
        subtitle="Review cycles and the reviews you owe or have received."
        action={
          isHr ? (
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setNewCycle(true)}>
              <Plus size={15} /> New cycle
            </button>
          ) : undefined
        }
      />

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
            <table>
              <thead>
                <tr><th>Cycle</th><th>Period</th><th>Status</th><th>Progress</th><th></th></tr>
              </thead>
              <tbody>
                {cycles.data!.map((c) => (
                  <tr key={c.id}>
                    <td className="font-semibold">{c.name}</td>
                    <td className="muted">{c.period ?? "—"}</td>
                    <td><span className={`badge ${c.status === "open" ? "green" : ""}`}>{c.status}</span></td>
                    <td>{c.submitted_count}/{c.review_count} submitted</td>
                    <td className="text-right">
                      <CycleActions cycle={c} onChange={() => { cycles.reload(); toReview.reload(); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {newCycle && <NewCycleModal onClose={() => setNewCycle(false)} onDone={() => { setNewCycle(false); cycles.reload(); }} />}
      {editing && <ReviewModal review={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); toReview.reload(); }} />}
    </div>
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
