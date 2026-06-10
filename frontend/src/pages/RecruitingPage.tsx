import { useState } from "react";
import {
  Briefcase, CalendarPlus, ChevronLeft, ChevronRight, FileUp, Plus,
  Star, Trash2, UserCheck,
} from "lucide-react";
import { api, downloadFile } from "../api/client";
import type {
  Candidate, CandidateDetail, Department, JobOpening, OnboardingTemplate, User,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const STAGES = ["applied", "screen", "interview", "offer", "hired", "rejected"];
const STAGE_LABEL: Record<string, string> = {
  applied: "Applied", screen: "Screening", interview: "Interview",
  offer: "Offer", hired: "Hired", rejected: "Rejected",
};
const JOB_BADGE: Record<string, string> = {
  open: "green", draft: "", on_hold: "amber", closed: "red", filled: "blue",
};

const AVATAR_COLORS = ["#0ea5e9", "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#14b8a6"];
function colorFor(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return (p.length >= 2 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase();
}

export default function RecruitingPage() {
  const jobs = useFetch<JobOpening[]>("/api/recruiting/jobs");
  const [openJob, setOpenJob] = useState<JobOpening | null>(null);
  const [adding, setAdding] = useState(false);

  if (openJob) {
    return <JobBoard job={openJob} onBack={() => { setOpenJob(null); jobs.reload(); }} />;
  }

  return (
    <div>
      <PageHead
        title="Recruiting"
        subtitle="Job openings, candidate pipeline, interviews and offers."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setAdding(true)}>
            <Plus size={15} /> New job
          </button>
        }
      />
      {jobs.loading ? (
        <Loading />
      ) : (jobs.data?.length ?? 0) === 0 ? (
        <div className="card"><Empty icon="💼" message="No job openings yet" hint="Create a job to start receiving candidates." /></div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
          {jobs.data!.map((j) => (
            <button key={j.id} className="flex flex-col rounded-xl border border-slate-200 p-4 text-left transition hover:shadow-md" onClick={() => setOpenJob(j)}>
              <div className="flex items-center gap-2">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-brand-50 text-brand-700"><Briefcase size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{j.title}</div>
                  <div className="muted text-xs">{j.department_name ?? "—"}{j.location ? ` · ${j.location}` : ""}</div>
                </div>
                <span className={`badge ${JOB_BADGE[j.status] ?? ""}`}>{j.status.replace("_", " ")}</span>
              </div>
              <div className="muted mt-3 text-xs">
                {j.candidate_count} candidate{j.candidate_count === 1 ? "" : "s"} · {j.hired_count}/{j.openings} hired
                {j.hiring_manager_name ? ` · HM: ${j.hiring_manager_name}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
      {adding && <JobModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); jobs.reload(); }} />}
    </div>
  );
}

function JobModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const departments = useFetch<Department[]>("/api/departments");
  const users = useFetch<User[]>("/api/users");
  const [f, setF] = useState({ title: "", department_id: "", location: "", employment_type: "full_time", openings: 1, hiring_manager_id: "", description: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/recruiting/jobs", {
        method: "POST",
        body: {
          title: f.title.trim(), department_id: f.department_id || null, location: f.location || null,
          employment_type: f.employment_type || null, openings: f.openings,
          hiring_manager_id: f.hiring_manager_id || null, description: f.description || null,
        },
      });
      notify("Job created.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="New job opening" onClose={onClose} maxWidth={560}>
      <form onSubmit={save}>
        <div className="field"><label>Title *</label><input required value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Backend Engineer" /></div>
        <div className="row">
          <div className="field">
            <label>Department</label>
            <select value={f.department_id} onChange={(e) => set("department_id", e.target.value)}>
              <option value="">—</option>
              {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Location</label><input value={f.location} onChange={(e) => set("location", e.target.value)} /></div>
        </div>
        <div className="row">
          <div className="field">
            <label>Type</label>
            <select value={f.employment_type} onChange={(e) => set("employment_type", e.target.value)}>
              {["full_time", "part_time", "contractor", "intern", "temporary"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 110 }}><label>Openings</label><input type="number" min={1} value={f.openings} onChange={(e) => set("openings", Number(e.target.value))} /></div>
          <div className="field">
            <label>Hiring manager</label>
            <select value={f.hiring_manager_id} onChange={(e) => set("hiring_manager_id", e.target.value)}>
              <option value="">—</option>
              {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label>Description</label><textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>{busy ? "Creating…" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}

function JobBoard({ job, onBack }: { job: JobOpening; onBack: () => void }) {
  const { notify } = useToast();
  const pipeline = useFetch<Record<string, Candidate[]>>(`/api/recruiting/jobs/${job.id}/pipeline`);
  const [openCand, setOpenCand] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  async function move(c: Candidate, dir: 1 | -1) {
    const flow = ["applied", "screen", "interview", "offer"];
    const idx = flow.indexOf(c.stage);
    const next = idx >= 0 ? flow[idx + dir] : undefined;
    if (!next) return;
    await api(`/api/recruiting/candidates/${c.id}`, { method: "PATCH", body: { stage: next } });
    pipeline.reload();
  }
  async function reject(c: Candidate) {
    await api(`/api/recruiting/candidates/${c.id}`, { method: "PATCH", body: { stage: "rejected" } });
    pipeline.reload();
  }
  async function addCandidate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api(`/api/recruiting/jobs/${job.id}/candidates`, { method: "POST", body: { name: name.trim(), email: email.trim() || null } });
      setName(""); setEmail(""); setAdding(false);
      pipeline.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <div>
      <PageHead
        title={job.title}
        subtitle={`${job.department_name ?? "—"}${job.location ? ` · ${job.location}` : ""} · ${job.status.replace("_", " ")}`}
        action={
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            <button className="btn" style={{ flex: "0 0 auto" }} onClick={onBack}>← All jobs</button>
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setAdding(true)}>
              <Plus size={15} /> Add candidate
            </button>
          </div>
        }
      />

      {adding && (
        <form onSubmit={addCandidate} className="card mb-4 row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 2 }}><label>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0, flex: 2 }}><label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn-primary" style={{ flex: "0 0 auto" }}>Add</button>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}

      {pipeline.loading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-3">
            {STAGES.map((stage) => {
              const cands = pipeline.data?.[stage] ?? [];
              return (
                <div key={stage} className="w-[230px] flex-none rounded-xl p-2" style={{ background: "var(--surface-2)" }}>
                  <div className="spread px-1 pb-2">
                    <span className="text-sm font-semibold">{STAGE_LABEL[stage]}</span>
                    <span className="badge">{cands.length}</span>
                  </div>
                  <div className="space-y-2">
                    {cands.map((c) => (
                      <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-2.5" style={{ background: "var(--surface)" }}>
                        <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpenCand(c.id)}>
                          <span className="grid h-8 w-8 flex-none place-items-center rounded-full text-xs font-bold text-white" style={{ background: colorFor(c.name) }}>
                            {initials(c.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{c.name}</span>
                            <span className="muted block truncate text-xs">{c.email ?? c.source ?? ""}</span>
                          </span>
                        </button>
                        {c.rating != null && (
                          <div className="mt-1 flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={11} className={n <= (c.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-slate-300"} />)}
                          </div>
                        )}
                        {!["hired", "rejected"].includes(c.stage) && (
                          <div className="mt-1.5 flex justify-between">
                            <button className="btn-sm" style={{ flex: "0 0 auto" }} title="Move back" disabled={c.stage === "applied"} onClick={() => move(c, -1)}><ChevronLeft size={13} /></button>
                            <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} title="Reject" onClick={() => reject(c)}><Trash2 size={13} /></button>
                            <button className="btn-sm" style={{ flex: "0 0 auto" }} title="Move forward" disabled={c.stage === "offer"} onClick={() => move(c, 1)}><ChevronRight size={13} /></button>
                          </div>
                        )}
                      </div>
                    ))}
                    {cands.length === 0 && <div className="muted px-1 py-3 text-center text-xs">—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {openCand && <CandidateModal candId={openCand} onClose={() => setOpenCand(null)} onChanged={() => pipeline.reload()} />}
    </div>
  );
}

function CandidateModal({ candId, onClose, onChanged }: { candId: string; onClose: () => void; onChanged: () => void }) {
  const { notify } = useToast();
  const detail = useFetch<CandidateDetail>(`/api/recruiting/candidates/${candId}`);
  const users = useFetch<User[]>("/api/users");
  const templates = useFetch<OnboardingTemplate[]>("/api/people/templates?kind=onboarding");
  const [note, setNote] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [iv, setIv] = useState({ scheduled_at: "", interviewer_id: "", mode: "video", location: "" });
  const [offering, setOffering] = useState(false);
  const [offer, setOffer] = useState({ amount: "", currency: "AED", pay_period: "monthly", start_date: "" });
  const [hiring, setHiring] = useState(false);
  const [hireEmail, setHireEmail] = useState("");
  const [hireTpl, setHireTpl] = useState("");

  const c = detail.data;
  if (!c) return <Modal title="Candidate" onClose={onClose}><Loading /></Modal>;

  async function act(fn: () => Promise<unknown>, msg?: string) {
    try {
      await fn();
      if (msg) notify(msg);
      detail.reload();
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <Modal title={c.name} onClose={onClose} maxWidth={640}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="badge blue">{STAGE_LABEL[c.stage]}</span>
        <span className="badge">{c.status}</span>
        {c.job_title && <span className="badge">{c.job_title}</span>}
        {c.email && <span className="muted text-sm">{c.email}</span>}
        {c.phone && <span className="muted text-sm">{c.phone}</span>}
      </div>

      {/* Rating */}
      <div className="mb-3 flex items-center gap-1">
        <span className="muted mr-1 text-xs">Rating</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => act(() => api(`/api/recruiting/candidates/${c.id}`, { method: "PATCH", body: { rating: n } }))}>
            <Star size={16} className={n <= (c.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
          </button>
        ))}
        <span className="ml-auto flex gap-1">
          <label className="btn-sm inline-flex cursor-pointer items-center gap-1" style={{ flex: "0 0 auto" }}>
            <FileUp size={13} /> {c.resume_path ? "Replace résumé" : "Résumé"}
            <input type="file" hidden onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const fd = new FormData();
              fd.append("file", file);
              act(() => api(`/api/recruiting/candidates/${c.id}/resume`, { method: "POST", form: fd }), "Résumé uploaded.");
            }} />
          </label>
          {c.resume_path && (
            <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => downloadFile(`/api/recruiting/candidates/${c.id}/resume`, `${c.name}-resume`).catch(() => notify("Download failed", "error"))}>
              View résumé
            </button>
          )}
        </span>
      </div>

      {/* Interviews */}
      <div className="mb-3">
        <div className="spread mb-1">
          <h4 className="m-0 text-sm">Interviews</h4>
          <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => setScheduling((v) => !v)}>
            <CalendarPlus size={13} /> Schedule
          </button>
        </div>
        {scheduling && (
          <div className="mb-2 rounded-lg border border-slate-200 p-2">
            <div className="row">
              <div className="field" style={{ marginBottom: 6 }}><label>When</label><input type="datetime-local" value={iv.scheduled_at} onChange={(e) => setIv((p) => ({ ...p, scheduled_at: e.target.value }))} /></div>
              <div className="field" style={{ marginBottom: 6 }}>
                <label>Interviewer</label>
                <select value={iv.interviewer_id} onChange={(e) => setIv((p) => ({ ...p, interviewer_id: e.target.value }))}>
                  <option value="">—</option>
                  {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>)}
                </select>
              </div>
            </div>
            <button
              className="btn-primary btn-sm" style={{ flex: "0 0 auto" }}
              onClick={() => iv.scheduled_at && act(() => api(`/api/recruiting/candidates/${c.id}/interviews`, {
                method: "POST",
                body: { scheduled_at: new Date(iv.scheduled_at).toISOString(), interviewer_id: iv.interviewer_id || null, mode: iv.mode, location: iv.location || null },
              }), "Interview scheduled.")}
            >
              Schedule
            </button>
          </div>
        )}
        {c.interviews.length === 0 ? <p className="muted text-sm">None yet.</p> : (
          <div className="divide-y divide-slate-100">
            {c.interviews.map((i) => (
              <InterviewRow key={i.id} iv={i} onSave={(body) => act(() => api(`/api/recruiting/interviews/${i.id}`, { method: "PATCH", body }), "Scorecard saved.")} />
            ))}
          </div>
        )}
      </div>

      {/* Offers */}
      <div className="mb-3">
        <div className="spread mb-1">
          <h4 className="m-0 text-sm">Offers</h4>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setOffering((v) => !v)}>+ Offer</button>
        </div>
        {offering && (
          <div className="mb-2 flex flex-wrap items-end gap-1 rounded-lg border border-slate-200 p-2">
            <div className="field" style={{ marginBottom: 0, maxWidth: 110 }}><label>Amount</label><input type="number" value={offer.amount} onChange={(e) => setOffer((p) => ({ ...p, amount: e.target.value }))} /></div>
            <div className="field" style={{ marginBottom: 0, maxWidth: 80 }}><label>Currency</label><input value={offer.currency} onChange={(e) => setOffer((p) => ({ ...p, currency: e.target.value.toUpperCase() }))} /></div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Period</label>
              <select value={offer.pay_period} onChange={(e) => setOffer((p) => ({ ...p, pay_period: e.target.value }))}>
                {["monthly", "annual", "hourly"].map((p2) => <option key={p2} value={p2}>{p2}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}><label>Start date</label><input type="date" value={offer.start_date} onChange={(e) => setOffer((p) => ({ ...p, start_date: e.target.value }))} /></div>
            <button className="btn-primary btn-sm" style={{ flex: "0 0 auto" }} onClick={() => act(() => api(`/api/recruiting/candidates/${c.id}/offers`, {
              method: "POST",
              body: { amount: offer.amount || null, currency: offer.currency, pay_period: offer.pay_period, start_date: offer.start_date || null },
            }), "Offer created.")}>Create</button>
          </div>
        )}
        {c.offers.map((o) => (
          <div key={o.id} className="flex items-center justify-between py-1 text-sm">
            <span>{o.currency} {o.amount ?? "—"} / {o.pay_period}{o.start_date ? ` · starts ${o.start_date}` : ""}</span>
            <select className="!w-auto !py-1 text-xs" value={o.status}
              onChange={(e) => act(() => api(`/api/recruiting/offers/${o.id}`, { method: "PATCH", body: { status: e.target.value } }))}>
              {["draft", "sent", "accepted", "declined"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* Notes / timeline */}
      <div className="mb-3">
        <h4 className="m-0 mb-1 text-sm">Timeline</h4>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 3 }}><input placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => note.trim() && act(() => api(`/api/recruiting/candidates/${c.id}/notes`, { method: "POST", body: { body: note.trim() } }).then(() => setNote("")))}>Add</button>
        </div>
        <div className="mt-1 max-h-36 space-y-1 overflow-auto">
          {c.activities.map((a) => (
            <div key={a.id} className="rounded px-2 py-1 text-xs" style={{ background: "var(--surface-2)" }}>
              <span className={a.kind === "stage" ? "font-medium" : ""}>{a.body}</span>
              <span className="muted"> · {a.author_name ?? "system"} · {new Date(a.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hire */}
      {!c.user_id && c.status === "active" && (
        <div className="rounded-lg border border-emerald-200 p-2" style={{ background: "color-mix(in srgb, #10b981 6%, var(--surface))" }}>
          {hiring ? (
            <div className="flex flex-wrap items-end gap-1">
              <div className="field" style={{ marginBottom: 0, flex: 2 }}><label>Work email</label><input value={hireEmail} onChange={(e) => setHireEmail(e.target.value)} placeholder="name@agholding.net" /></div>
              <div className="field" style={{ marginBottom: 0, flex: 2 }}>
                <label>Onboarding packet</label>
                <select value={hireTpl} onChange={(e) => setHireTpl(e.target.value)}>
                  <option value="">Default checklist</option>
                  {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <button className="btn-primary btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }}
                onClick={() => act(() => api(`/api/recruiting/candidates/${c.id}/hire`, {
                  method: "POST",
                  body: { email: hireEmail.trim() || null, start_onboarding: true, template_id: hireTpl || null },
                }), "Hired — employee created and onboarding started. 🎉")}>
                <UserCheck size={13} /> Confirm hire
              </button>
            </div>
          ) : (
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => { setHiring(true); setHireEmail(""); }}>
              <UserCheck size={15} /> Hire — create employee + onboarding
            </button>
          )}
        </div>
      )}
      {c.user_id && <p className="muted mt-1 text-sm">Hired ✓ — employee record created.</p>}
    </Modal>
  );
}

function InterviewRow({ iv, onSave }: { iv: import("../api/types").InterviewItem; onSave: (body: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(iv.rating ?? 0);
  const [rec, setRec] = useState(iv.recommendation ?? "");
  const [fb, setFb] = useState(iv.feedback ?? "");
  return (
    <div className="py-1.5 text-sm">
      <div className="flex items-center justify-between">
        <span>
          {new Date(iv.scheduled_at).toLocaleString()} · {iv.mode}
          {iv.interviewer_name ? ` · ${iv.interviewer_name}` : ""}
          {iv.recommendation && <span className={`badge ml-1 ${iv.recommendation === "yes" ? "green" : iv.recommendation === "no" ? "red" : "amber"}`}>{iv.recommendation}</span>}
        </span>
        <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Scorecard"}</button>
      </div>
      {open && (
        <div className="mt-1 rounded-lg border border-slate-200 p-2">
          <div className="mb-1 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)}><Star size={15} className={n <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"} /></button>
            ))}
            <select className="!w-auto !py-1 ml-2 text-xs" value={rec} onChange={(e) => setRec(e.target.value)}>
              <option value="">Recommendation…</option>
              {["yes", "maybe", "no"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <textarea rows={2} placeholder="Feedback" value={fb} onChange={(e) => setFb(e.target.value)} />
          <button className="btn-primary btn-sm mt-1" style={{ flex: "0 0 auto" }} onClick={() => onSave({ rating: rating || null, recommendation: rec || null, feedback: fb || null })}>Save</button>
        </div>
      )}
    </div>
  );
}
