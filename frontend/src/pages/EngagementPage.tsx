import { useState } from "react";
import { Award, BarChart3, Plus, Send, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Kudos, Survey, SurveyResults, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function EngagementPage() {
  const { user } = useAuth();
  const isHr = !!user?.is_admin || !!user?.effective_permissions?.includes("hr");
  const [tab, setTab] = useState<"kudos" | "surveys">("kudos");

  return (
    <div>
      <PageHead title="Engagement" subtitle="Recognition and employee surveys." />
      <div className="row mb-4" style={{ gap: 8 }}>
        <button className={tab === "kudos" ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setTab("kudos")}>Kudos</button>
        <button className={tab === "surveys" ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setTab("surveys")}>Surveys</button>
      </div>
      {tab === "kudos" ? <KudosWall /> : <Surveys isHr={isHr} />}
    </div>
  );
}

function KudosWall() {
  const { notify } = useToast();
  const feed = useFetch<Kudos[]>("/api/engagement/kudos");
  const [giving, setGiving] = useState(false);

  return (
    <div>
      <div className="spread mb-3">
        <h3 className="m-0 flex items-center gap-2">
          Recognition wall
          {(feed.data?.length ?? 0) > 0 && <span className="badge amber">{feed.data!.length}</span>}
        </h3>
        <button className="btn-sm btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setGiving(true)}>
          <Award size={14} /> Give kudos
        </button>
      </div>
      {feed.loading ? (
        <Loading />
      ) : (feed.data?.length ?? 0) === 0 ? (
        <div className="card"><Empty icon="🎉" message="No kudos yet" hint="Be the first to recognise a colleague." /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {feed.data!.map((k) => (
            <div key={k.id} className="card relative overflow-hidden">
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: "var(--warn)" }} />
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-amber-100 text-amber-600"><Award size={18} /></span>
                <div className="min-w-0">
                  <div className="text-sm"><strong>{k.from_name ?? "Someone"}</strong> → <strong>{k.to_name}</strong></div>
                  <div className="text-xs text-ink-muted">{timeAgo(k.created_at)}</div>
                </div>
              </div>
              <p className="mt-2 mb-0">{k.message}</p>
              {k.value_tag && <span className="badge violet mt-2 inline-block">{k.value_tag}</span>}
            </div>
          ))}
        </div>
      )}
      {giving && <GiveKudosModal onClose={() => setGiving(false)} onDone={() => { setGiving(false); feed.reload(); notify("Kudos sent! 🎉"); }} />}
    </div>
  );
}

const VALUES = ["Ownership", "Teamwork", "Customer First", "Innovation", "Integrity"];

function GiveKudosModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const people = useFetch<User[]>("/api/users");
  const [toId, setToId] = useState("");
  const [message, setMessage] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!toId || !message.trim()) { notify("Pick a colleague and write a message", "error"); return; }
    setBusy(true);
    try {
      await api("/api/engagement/kudos", { method: "POST", body: { to_user_id: toId, message: message.trim(), value_tag: tag || null } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="Give kudos" onClose={onClose} maxWidth={460}>
      <div className="field">
        <label>To</label>
        <select value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">Select a colleague…</option>
          {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>)}
        </select>
      </div>
      <div className="field"><label>Message</label><textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What did they do well?" /></div>
      <div className="field">
        <label>Company value (optional)</label>
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">None</option>
          {VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div className="row mt-2" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}><Send size={14} /> {busy ? "Sending…" : "Send"}</button>
      </div>
    </Modal>
  );
}

function Surveys({ isHr }: { isHr: boolean }) {
  const { notify } = useToast();
  const surveys = useFetch<Survey[]>("/api/engagement/surveys");
  const [creating, setCreating] = useState(false);
  const [taking, setTaking] = useState<Survey | null>(null);
  const [viewing, setViewing] = useState<Survey | null>(null);

  async function setStatus(s: Survey, status: string) {
    try {
      await api(`/api/engagement/surveys/${s.id}`, { method: "PATCH", body: { status } });
      surveys.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(s: Survey) {
    if (!confirm(`Delete survey "${s.title}"?`)) return;
    await api(`/api/engagement/surveys/${s.id}`, { method: "DELETE" });
    surveys.reload();
  }

  return (
    <div>
      <div className="spread mb-3">
        <h3 className="m-0">Surveys</h3>
        {isHr && (
          <button className="btn-sm btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setCreating(true)}>
            <Plus size={14} /> New survey
          </button>
        )}
      </div>
      {surveys.loading ? (
        <Loading />
      ) : (surveys.data?.length ?? 0) === 0 ? (
        <div className="card"><Empty icon="📊" message="No surveys" hint={isHr ? "Create a pulse or eNPS survey." : "No open surveys right now."} /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {surveys.data!.map((s) => (
            <div key={s.id} className="card">
              <div className="spread">
                <div>
                  <div className="font-semibold">{s.title}</div>
                  <div className="muted text-sm capitalize">{s.kind} · {s.anonymous ? "anonymous" : "named"}</div>
                </div>
                <span className={`badge ${s.status === "open" ? "green" : s.status === "closed" ? "gray" : "amber"}`}>{s.status}</span>
              </div>
              {s.description && <p className="muted text-sm mt-2">{s.description}</p>}
              <div className="row mt-3" style={{ gap: 6, flexWrap: "wrap" }}>
                {s.status === "open" && (
                  <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={() => setTaking(s)}>Take survey</button>
                )}
                {isHr && (
                  <>
                    <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => setViewing(s)}><BarChart3 size={13} /> Results ({s.response_count})</button>
                    {s.status === "draft" && <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setStatus(s, "open")}>Open</button>}
                    {s.status === "open" && <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setStatus(s, "closed")}>Close</button>}
                    <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(s)}><Trash2 size={13} /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && <CreateSurveyModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); surveys.reload(); }} />}
      {taking && <TakeSurveyModal survey={taking} onClose={() => setTaking(null)} onDone={() => { setTaking(null); surveys.reload(); notify("Thanks for your feedback!"); }} />}
      {viewing && <ResultsModal survey={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CreateSurveyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("enps");
  const [anonymous, setAnonymous] = useState(true);
  const [questions, setQuestions] = useState<{ text: string; qtype: string }[]>([{ text: "", qtype: "scale" }]);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) { notify("Title required", "error"); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { title: title.trim(), description: description || null, kind, anonymous };
      if (kind !== "enps") body.questions = questions.filter((q) => q.text.trim());
      await api("/api/engagement/surveys", { method: "POST", body });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="New survey" onClose={onClose} maxWidth={560}>
      <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field"><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="enps">eNPS (auto questions)</option>
            <option value="pulse">Pulse</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <label className="row" style={{ gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} /> Anonymous
        </label>
      </div>
      {kind !== "enps" && (
        <div className="mt-2">
          <label className="muted text-xs">Questions</label>
          {questions.map((q, i) => (
            <div key={i} className="mt-1 flex gap-1">
              <input className="flex-1" placeholder="Question text" value={q.text} onChange={(e) => setQuestions((arr) => arr.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
              <select className="!w-auto" value={q.qtype} onChange={(e) => setQuestions((arr) => arr.map((x, j) => j === i ? { ...x, qtype: e.target.value } : x))}>
                <option value="scale">Scale 1–5</option>
                <option value="nps">NPS 0–10</option>
                <option value="text">Text</option>
                <option value="boolean">Yes/No</option>
              </select>
              <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => setQuestions((arr) => arr.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
            </div>
          ))}
          <button className="btn-sm mt-1" style={{ flex: "0 0 auto" }} onClick={() => setQuestions((a) => [...a, { text: "", qtype: "scale" }])}>+ Add question</button>
        </div>
      )}
      <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </Modal>
  );
}

function TakeSurveyModal({ survey, onClose, onDone }: { survey: Survey; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [answers, setAnswers] = useState<Record<string, { value_num?: number; value_text?: string }>>({});
  const [busy, setBusy] = useState(false);

  function setNum(qid: string, n: number) { setAnswers((a) => ({ ...a, [qid]: { value_num: n } })); }
  function setText(qid: string, t: string) { setAnswers((a) => ({ ...a, [qid]: { value_text: t } })); }

  async function submit() {
    setBusy(true);
    try {
      const payload = survey.questions
        .filter((q) => answers[q.id] !== undefined)
        .map((q) => ({ question_id: q.id, ...answers[q.id] }));
      await api(`/api/engagement/surveys/${survey.id}/respond`, { method: "POST", body: { answers: payload } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={survey.title} onClose={onClose} maxWidth={520}>
      {survey.anonymous && <p className="muted text-sm">Your response is anonymous.</p>}
      {survey.questions.map((q) => (
        <div key={q.id} className="field">
          <label>{q.text}</label>
          {q.qtype === "text" ? (
            <textarea value={answers[q.id]?.value_text ?? ""} onChange={(e) => setText(q.id, e.target.value)} />
          ) : q.qtype === "boolean" ? (
            <div className="row" style={{ gap: 8 }}>
              <button className={answers[q.id]?.value_num === 1 ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setNum(q.id, 1)}>Yes</button>
              <button className={answers[q.id]?.value_num === 0 ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setNum(q.id, 0)}>No</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: q.qtype === "nps" ? 11 : 5 }, (_, i) => (q.qtype === "nps" ? i : i + 1)).map((n) => (
                <button key={n} className={answers[q.id]?.value_num === n ? "btn-sm btn-primary" : "btn-sm"} style={{ flex: "0 0 auto", minWidth: 36 }} onClick={() => setNum(q.id, n)}>{n}</button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="row mt-2" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit"}</button>
      </div>
    </Modal>
  );
}

function ResultsModal({ survey, onClose }: { survey: Survey; onClose: () => void }) {
  const res = useFetch<SurveyResults>(`/api/engagement/surveys/${survey.id}/results`);
  return (
    <Modal title={`Results — ${survey.title}`} onClose={onClose} maxWidth={560}>
      {res.loading || !res.data ? (
        <Loading />
      ) : res.data.response_count === 0 ? (
        <Empty icon="📭" message="No responses yet" />
      ) : (
        <div className="space-y-3">
          <div className="muted text-sm">{res.data.response_count} response{res.data.response_count === 1 ? "" : "s"}</div>
          {res.data.questions.map((q) => (
            <div key={q.question_id} className="rounded-lg border border-slate-200 p-3">
              <div className="font-medium text-sm">{q.text}</div>
              {q.qtype === "nps" && q.enps != null && (
                <div className="mt-1 text-2xl font-bold" style={{ color: q.enps >= 0 ? "#16a34a" : "#dc2626" }}>eNPS {q.enps}</div>
              )}
              {(q.qtype === "scale" || q.qtype === "boolean") && q.average != null && (
                <div className="mt-1 text-xl font-bold">{q.average} <span className="muted text-sm font-normal">avg</span></div>
              )}
              {q.qtype === "text" && (
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {q.text_answers.length === 0 ? <li className="muted">No comments</li> : q.text_answers.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
