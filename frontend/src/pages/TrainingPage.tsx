import { useState } from "react";
import { Award, BookOpen, ExternalLink, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Certification, Course, CourseAssignment, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const A_BADGE: Record<string, string> = { assigned: "amber", in_progress: "blue", completed: "green", waived: "" };

export default function TrainingPage() {
  const { user } = useAuth();
  const canManage = !!user?.is_admin || user?.role === "manager" || !!user?.effective_permissions?.includes("hr");
  const [tab, setTab] = useState<"mine" | "courses" | "certs">("mine");

  return (
    <div>
      <PageHead title="Training" subtitle="Assigned learning, course catalogue and certifications." />
      <div className="row mb-4" style={{ gap: 8 }}>
        <button className={tab === "mine" ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setTab("mine")}>My learning</button>
        <button className={tab === "certs" ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setTab("certs")}>Certifications</button>
        {canManage && <button className={tab === "courses" ? "btn-primary" : "btn"} style={{ flex: "0 0 auto" }} onClick={() => setTab("courses")}>Course catalogue</button>}
      </div>
      {tab === "mine" && <MyLearning />}
      {tab === "certs" && <Certifications />}
      {tab === "courses" && canManage && <Courses />}
    </div>
  );
}

function MyLearning() {
  const { notify } = useToast();
  const mine = useFetch<CourseAssignment[]>("/api/training/my/assignments");

  async function setStatus(a: CourseAssignment, status: string) {
    try {
      await api(`/api/training/assignments/${a.id}?status=${status}`, { method: "PATCH" });
      mine.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  if (mine.loading) return <Loading />;
  if ((mine.data?.length ?? 0) === 0) return <div className="card"><Empty icon="📚" message="No training assigned" hint="Assigned courses will appear here." /></div>;

  return (
    <div className="card">
      <table className="table">
        <thead><tr><th>Course</th><th>Due</th><th>Status</th><th /></tr></thead>
        <tbody>
          {mine.data!.map((a) => (
            <tr key={a.id}>
              <td className="font-medium">{a.course_title}</td>
              <td className="muted">{a.due_date ?? "—"}</td>
              <td><span className={`badge ${A_BADGE[a.status]}`}>{a.status.replace("_", " ")}</span></td>
              <td className="text-right">
                {a.status !== "completed" && (
                  <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                    {a.status === "assigned" && <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setStatus(a, "in_progress")}>Start</button>}
                    <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={() => setStatus(a, "completed")}>Mark complete</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Certifications() {
  const { notify } = useToast();
  const certs = useFetch<Certification[]>("/api/training/my/certifications");
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", issuer: "", issued_date: "", expiry_date: "", credential_id: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return;
    try {
      await api("/api/training/my/certifications", { method: "POST", body: { ...f, issued_date: f.issued_date || null, expiry_date: f.expiry_date || null } });
      setF({ name: "", issuer: "", issued_date: "", expiry_date: "", credential_id: "" });
      setAdding(false);
      certs.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(c: Certification) {
    if (!confirm(`Remove "${c.name}"?`)) return;
    await api(`/api/training/my/certifications/${c.id}`, { method: "DELETE" });
    certs.reload();
  }

  return (
    <div className="card">
      <div className="spread mb-3">
        <h3 className="m-0 inline-flex items-center gap-2"><Award size={18} className="text-brand-600" /> My certifications</h3>
        <button className="btn-sm btn-primary inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => setAdding((v) => !v)}><Plus size={14} /> Add</button>
      </div>
      {adding && (
        <form onSubmit={add} className="mb-3 rounded-lg border border-slate-200 p-2">
          <div className="row" style={{ gap: 8 }}>
            <div className="field" style={{ flex: 2 }}><label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>Issuer</label><input value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="field"><label>Issued</label><input type="date" value={f.issued_date} onChange={(e) => setF({ ...f, issued_date: e.target.value })} /></div>
            <div className="field"><label>Expires</label><input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></div>
            <div className="field"><label>Credential ID</label><input value={f.credential_id} onChange={(e) => setF({ ...f, credential_id: e.target.value })} /></div>
          </div>
          <button className="btn-primary" style={{ flex: "0 0 auto" }}>Save</button>
        </form>
      )}
      {certs.loading ? (
        <Loading />
      ) : (certs.data?.length ?? 0) === 0 ? (
        <Empty icon="🎓" message="No certifications recorded" />
      ) : (
        <table className="table">
          <thead><tr><th>Name</th><th>Issuer</th><th>Expiry</th><th /></tr></thead>
          <tbody>
            {certs.data!.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="muted">{c.issuer ?? "—"}</td>
                <td>
                  {c.expiry_date ? (
                    <span className={`badge ${c.expired ? "red" : (c.days_to_expiry ?? 999) < 60 ? "amber" : "green"}`}>
                      {c.expired ? "expired" : `${c.days_to_expiry}d`}
                    </span>
                  ) : <span className="muted">—</span>}
                </td>
                <td className="text-right"><button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(c)}><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Courses() {
  const { notify } = useToast();
  const courses = useFetch<Course[]>("/api/training/courses");
  const [creating, setCreating] = useState(false);
  const [assignFor, setAssignFor] = useState<Course | null>(null);

  async function del(c: Course) {
    if (!confirm(`Delete course "${c.title}"?`)) return;
    await api(`/api/training/courses/${c.id}`, { method: "DELETE" });
    courses.reload();
  }

  return (
    <div>
      <div className="spread mb-3">
        <h3 className="m-0 inline-flex items-center gap-2"><BookOpen size={18} className="text-brand-600" /> Course catalogue</h3>
        <button className="btn-sm btn-primary inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => setCreating(true)}><Plus size={14} /> New course</button>
      </div>
      {courses.loading ? (
        <Loading />
      ) : (courses.data?.length ?? 0) === 0 ? (
        <div className="card"><Empty icon="📘" message="No courses yet" /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {courses.data!.map((c) => (
            <div key={c.id} className="card">
              <div className="spread">
                <div className="min-w-0">
                  <div className="font-semibold">{c.title}{c.category && <span className="badge ml-1">{c.category}</span>}</div>
                  {c.description && <p className="muted text-sm mt-1">{c.description}</p>}
                  {c.url && <a className="text-brand-700 text-sm inline-flex items-center gap-1" href={c.url} target="_blank" rel="noreferrer">Open content <ExternalLink size={12} /></a>}
                  <div className="muted text-xs mt-1">{c.assigned_count} assigned</div>
                </div>
                <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
                  <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={() => setAssignFor(c)}>Assign</button>
                  <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(c)}><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && <CourseModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); courses.reload(); notify("Course created."); }} />}
      {assignFor && <AssignModal course={assignFor} onClose={() => setAssignFor(null)} onDone={() => { setAssignFor(null); courses.reload(); }} />}
    </div>
  );
}

function CourseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [f, setF] = useState({ title: "", category: "", url: "", description: "" });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.title.trim()) { notify("Title required", "error"); return; }
    setBusy(true);
    try {
      await api("/api/training/courses", { method: "POST", body: { ...f, category: f.category || null, url: f.url || null } });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }
  return (
    <Modal title="New course" onClose={onClose} maxWidth={480}>
      <div className="field"><label>Title</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div className="field"><label>Category</label><input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
      <div className="field"><label>Content URL</label><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://lms/..." /></div>
      <div className="field"><label>Description</label><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="row mt-2" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Create"}</button>
      </div>
    </Modal>
  );
}

function AssignModal({ course, onClose, onDone }: { course: Course; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const people = useFetch<User[]>("/api/users");
  const [selected, setSelected] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  async function save() {
    if (selected.length === 0) { notify("Pick at least one person", "error"); return; }
    setBusy(true);
    try {
      await api(`/api/training/courses/${course.id}/assign`, { method: "POST", body: { user_ids: selected, due_date: due || null } });
      notify("Assigned.");
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }
  return (
    <Modal title={`Assign — ${course.title}`} onClose={onClose} maxWidth={460}>
      <div className="field"><label>Due date (optional)</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      <label className="muted text-xs">Employees</label>
      <div className="mt-1 max-h-64 overflow-auto rounded-lg border border-slate-200 p-1">
        {(people.data ?? []).map((u) => (
          <label key={u.id} className="flex items-center gap-2 px-1 py-0.5 text-sm">
            <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} /> {u.display_name ?? u.email}
          </label>
        ))}
      </div>
      <div className="row mt-2" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Assigning…" : `Assign (${selected.length})`}</button>
      </div>
    </Modal>
  );
}
