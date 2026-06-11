import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Banknote,
  Boxes,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Download,
  FileText,
  KeyRound,
  ListChecks,
  Mail,
  MapPin,
  Pencil,
  PenLine,
  Phone,
  Sliders,
  Smartphone,
  Target,
  Trash2,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { api, downloadFile } from "../api/client";
import type {
  CompensationRecord,
  CompensationSummary,
  TotalRewards,
  CustomFieldValue,
  CustomTableValues,
  CustomValues,
  Department,
  HrDocument,
  PerformanceGoal,
  Profile,
  ProfileEvent,
  User,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, useToast } from "../components/ui";

const ROLES = ["member", "manager", "admin"];
const USER_STATUSES = ["active", "invited", "suspended", "offboarding", "departed"];
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "intern", "temporary"];
const EVENT_TYPES = [
  "hired", "promotion", "transfer", "title_change", "manager_change",
  "contract", "compensation", "leave", "note", "terminated",
];

const STATUS_BADGE: Record<string, string> = {
  active: "green",
  available: "green",
  assigned: "blue",
  revoked: "red",
  disabled: "red",
  pending: "amber",
  maintenance: "amber",
  suspended: "amber",
};

function badge(s?: string | null) {
  return s ? `badge ${STATUS_BADGE[s] ?? ""}` : "badge";
}

const TABS: { key: string; label: string; sensitive?: boolean }[] = [
  { key: "personal", label: "Personal" },
  { key: "job", label: "Job" },
  { key: "comp", label: "Compensation", sensitive: true },
  { key: "documents", label: "Documents", sensitive: true },
  { key: "performance", label: "Performance" },
  { key: "assets", label: "Assets & Access" },
];

export default function ProfilePage() {
  const { id } = useParams();
  const { user: viewer } = useAuth();
  const viewerId = viewer?.id;
  const path = id ? `/api/profiles/${id}` : "/api/profiles/me";
  const { data: p, loading, error, reload } = useFetch<Profile>(path);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("personal");

  if (loading) return <Loading />;
  if (error || !p)
    return <Empty message={error ? "You don't have access to this profile." : "Not found."} />;

  const tabs = TABS.filter((t) => !t.sensitive || p.can_see_sensitive);
  const canEditGoals = p.can_manage || p.id === viewerId;

  return (
    <div>
      {editing && (
        <EditProfileModal
          profile={p}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); }}
        />
      )}

      {/* Hero header */}
      <div className="overflow-hidden rounded-2xl shadow-sm">
        <div
          className="flex flex-wrap items-center gap-4 px-6 py-5 text-white"
          style={{ background: "linear-gradient(120deg, var(--brand-600), var(--brand-800))" }}
        >
          <Avatar name={p.name} email={p.email} url={p.avatar_url} />
          <div className="min-w-0">
            <h1 className="m-0 text-2xl font-bold leading-tight">{p.name ?? p.email}</h1>
            <div className="text-white/85">
              {p.job_title ?? "—"}
              {(p.department_name || p.hr_department) ? ` · ${p.department_name ?? p.hr_department}` : ""}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium capitalize">{p.status}</span>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">{p.is_admin ? "admin" : p.role}</span>
              {p.employment_type && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium capitalize">
                  {p.employment_type.replace("_", " ")}
                </span>
              )}
            </div>
          </div>
          {p.can_manage && (
            <button
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25"
              onClick={() => setEditing(true)}
            >
              <Pencil size={15} /> Edit
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 px-6 py-3 text-sm" style={{ background: "var(--brand-50)" }}>
          <Fact icon={<Building2 size={14} />} value={p.department_name ?? p.hr_department} />
          {p.manager_id && (
            <Fact icon={<Users size={14} />} value={<Link to={`/people/${p.manager_id}`} className="text-brand-700 hover:underline">{p.manager_name}</Link>} />
          )}
          <Fact icon={<MapPin size={14} />} value={p.office_location} />
          <Fact icon={<CalendarDays size={14} />} value={p.hire_date ? `Joined ${p.hire_date}` : null} />
          <Fact icon={<Mail size={14} />} value={p.email} />
          <Fact icon={<Phone size={14} />} value={p.mobile_phone} />
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {tab === "personal" && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <InfoCard icon={<UserRound size={16} />} title="Contact">
                <Row label="Work email" value={p.email} />
                <Row label="Mobile" value={p.mobile_phone} />
                <Row label="Work phone" value={p.business_phone} />
                <Row label="Office" value={p.office_location} />
                {p.can_see_sensitive && <Row label="Personal email" value={p.personal_email} />}
              </InfoCard>
              {p.can_see_sensitive && (
                <InfoCard icon={<UserRound size={16} />} title="Personal details">
                  <Row label="Date of birth" value={p.date_of_birth} />
                  <Row label="Nationality" value={p.nationality} />
                  <Row label="Passport" value={p.passport_no} />
                  <Row label="Emergency contact" value={p.emergency_contact_name} />
                  <Row label="Emergency phone" value={p.emergency_contact_phone} />
                  <Row label="Relationship" value={p.emergency_contact_relationship} />
                </InfoCard>
              )}
            </div>
            <CustomFieldsSection userId={p.id} />
          </>
        )}

        {tab === "job" && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <InfoCard icon={<Briefcase size={16} />} title="Employment">
                <Row label="Job title" value={p.job_title} />
                <Row label="Department" value={p.department_name ?? p.hr_department} />
                <Row label="Employment type" value={p.employment_type?.replace("_", " ")} />
                <Row label="Hire date" value={p.hire_date} />
                <Row label="Probation end" value={p.probation_end_date} />
                <Row label="Contract end" value={p.contract_end_date} />
              </InfoCard>
              <InfoCard icon={<Users size={16} />} title="Reporting">
                {p.manager_id ? (
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="muted">Manager</span>
                    <Link to={`/people/${p.manager_id}`} className="text-brand-600 hover:underline">{p.manager_name}</Link>
                  </div>
                ) : <Row label="Manager" value={null} />}
                <div className="mt-1">
                  <div className="muted mb-1 text-xs">Direct reports ({p.direct_reports.length})</div>
                  {p.direct_reports.length === 0 ? (
                    <p className="muted text-sm">None.</p>
                  ) : (
                    p.direct_reports.map((r) => (
                      <Link key={r.id} to={`/people/${r.id}`} className="block text-sm text-brand-600 hover:underline">
                        {r.label} {r.sub && <span className="muted text-xs">· {r.sub}</span>}
                      </Link>
                    ))
                  )}
                </div>
              </InfoCard>
            </div>
            {p.can_see_sensitive && (
              <EmploymentHistory userId={p.id} canManage={p.can_manage} events={p.events} onChange={reload} />
            )}
          </>
        )}

        {tab === "comp" && p.can_see_sensitive && (
          <CompensationSection userId={p.id} canManage={p.can_manage} />
        )}

        {tab === "documents" && p.can_see_sensitive && (
          <DocumentsSection userId={p.id} canManage={p.can_manage} isSelf={p.id === viewerId} />
        )}

        {tab === "performance" && (
          <GoalsSection userId={p.id} canEdit={canEditGoals} />
        )}

        {tab === "assets" && (
          <>
            <Section icon={<Wallet size={16} />} title="Subscriptions" count={p.subscriptions.length}>
              {p.subscriptions.length === 0 ? <Muted>No subscriptions.</Muted> : p.subscriptions.map((s) => (
                <Item key={s.subscription_id + s.source} label={s.name} sub={s.vendor}
                  right={<span className="badge">{s.source === "seat" ? (s.seat_status ?? "seat") : s.source}</span>} />
              ))}
            </Section>
            <div className="grid gap-4 md:grid-cols-2">
              <Section icon={<Boxes size={16} />} title="Assets" count={p.assets.length}>
                {p.assets.length === 0 ? <Muted>None assigned.</Muted> : p.assets.map((a) => (
                  <Item key={a.id} label={a.label} sub={a.sub} right={<span className={badge(a.status)}>{a.status}</span>} />
                ))}
              </Section>
              <Section icon={<Smartphone size={16} />} title="Phone lines" count={p.phones.length}>
                {p.phones.length === 0 ? <Muted>None assigned.</Muted> : p.phones.map((a) => (
                  <Item key={a.id} label={a.label} sub={a.sub} right={<span className={badge(a.status)}>{a.status}</span>} />
                ))}
              </Section>
            </div>
            <Section icon={<KeyRound size={16} />} title="Access grants" count={p.access_grants.length}>
              {p.access_grants.length === 0 ? <Muted>No tracked accounts.</Muted> : p.access_grants.map((g) => (
                <Item key={g.id} label={g.label} sub={g.sub} right={<span className={badge(g.status)}>{g.status}</span>} />
              ))}
            </Section>
            <Section icon={<CheckSquare size={16} />} title="Open tasks" count={p.open_tasks.length}>
              {p.open_tasks.length === 0 ? <Muted>No open tasks.</Muted> : p.open_tasks.map((t) => (
                <Item key={t.id} label={t.title} sub={t.due_date ? `due ${t.due_date}` : null} right={<span className="badge">{t.status}</span>} />
              ))}
            </Section>
            <Section icon={<KeyRound size={16} />} title="Module access" count={p.modules.length}>
              <div className="flex flex-wrap gap-1 py-1">
                {p.modules.map((m) => <span key={m} className="badge">{m}</span>)}
              </div>
            </Section>
            {p.journeys.length > 0 && (
              <Section icon={<ListChecks size={16} />} title="Onboarding / Offboarding" count={p.journeys.length}>
                {p.journeys.map((j) => (
                  <Link key={j.id} to="/people-ops" className="block">
                    <Item label={j.kind === "offboarding" ? "Offboarding" : "Onboarding"}
                      sub={`${j.done_tasks}/${j.total_tasks} steps`}
                      right={<span className={badge(j.status === "completed" ? "active" : "pending")}>{j.status}</span>} />
                  </Link>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Avatar({ name, email, url }: { name?: string | null; email?: string | null; url?: string | null }) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  const init = (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
  return (
    <span className="grid h-20 w-20 flex-none place-items-center overflow-hidden rounded-full bg-white/20 text-2xl font-bold text-white ring-4 ring-white/25">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : init}
    </span>
  );
}

function Fact({ icon, value }: { icon: React.ReactNode; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-muted">
      <span className="text-brand-600">{icon}</span> {value}
    </span>
  );
}

function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 className="mt-0 mb-2 flex items-center gap-2 text-base">{icon} {title}</h3>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

const DOC_CATEGORIES = [
  "contract", "offer_letter", "nda", "passport", "visa",
  "national_id", "certificate", "policy", "payslip", "other",
];
const COMP_TYPES = ["salary", "bonus", "allowance", "adjustment"];
const PAY_PERIODS = ["annual", "monthly", "hourly"];
const GOAL_STATUSES = ["open", "in_progress", "done", "cancelled"];

function GoalsSection({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const { notify } = useToast();
  const goals = useFetch<PerformanceGoal[]>(`/api/performance/goals/by-user/${userId}`);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", due_date: "", description: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      await api(`/api/performance/goals/by-user/${userId}`, {
        method: "POST",
        body: { title: form.title.trim(), due_date: form.due_date || null, description: form.description || null },
      });
      setForm({ title: "", due_date: "", description: "" });
      setAdding(false);
      goals.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/api/performance/goals/${id}`, { method: "PATCH", body });
    goals.reload();
  }
  async function del(id: string) {
    await api(`/api/performance/goals/${id}`, { method: "DELETE" });
    goals.reload();
  }

  if (goals.loading) return null;
  if (!canEdit && (goals.data?.length ?? 0) === 0) return null;

  return (
    <div className="card">
      <div className="spread mb-2">
        <h3 className="m-0 flex items-center gap-2 text-base"><Target size={16} /> Goals</h3>
        {canEdit && (
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Goal"}
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={add} className="mb-3 rounded-lg border border-slate-200 p-2">
          <div className="field"><label>Goal</label><input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Ship the HR module" /></div>
          <div className="row">
            <div className="field"><label>Due</label><input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} /></div>
          </div>
          <button className="btn-primary" style={{ flex: "0 0 auto" }}>Add goal</button>
        </form>
      )}
      {(goals.data?.length ?? 0) === 0 ? (
        <Muted>No goals set.</Muted>
      ) : (
        <div className="space-y-2">
          {goals.data!.map((g) => (
            <div key={g.id} className="rounded-lg border border-slate-100 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{g.title}</span>
                <div className="flex flex-none items-center gap-2">
                  {canEdit ? (
                    <select
                      className="!w-auto !py-1 text-xs"
                      value={g.status}
                      onChange={(e) => patch(g.id, { status: e.target.value })}
                    >
                      {GOAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </select>
                  ) : (
                    <span className="badge">{g.status.replace("_", " ")}</span>
                  )}
                  {canEdit && (
                    <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(g.id)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${g.progress}%` }} />
                </div>
                {canEdit ? (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={g.progress}
                    className="!w-16 !py-0.5 text-xs"
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== g.progress) patch(g.id, { progress: v }); }}
                  />
                ) : (
                  <span className="muted text-xs">{g.progress}%</span>
                )}
              </div>
              {g.due_date && <div className="muted mt-1 text-xs">Due {g.due_date}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function money(v?: string | null, ccy?: string | null) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return `${ccy ?? ""} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`.trim();
}

function CompensationSection({ userId, canManage }: { userId: string; canManage: boolean }) {
  const { notify } = useToast();
  const current = useFetch<CompensationSummary>(`/api/compensation/current/${userId}`);
  const records = useFetch<CompensationRecord[]>(`/api/compensation/by-user/${userId}`);
  const rewards = useFetch<TotalRewards>(`/api/compensation/total-rewards/${userId}`);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ record_type: "salary", amount: "", currency: "USD", pay_period: "annual", effective_date: "", note: "" });
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.amount) return;
    setBusy(true);
    try {
      await api(`/api/compensation/by-user/${userId}`, {
        method: "POST",
        body: { ...f, effective_date: f.effective_date || null, amount: f.amount },
      });
      setF({ record_type: "salary", amount: "", currency: "USD", pay_period: "annual", effective_date: "", note: "" });
      setAdding(false);
      current.reload();
      records.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
    setBusy(false);
  }
  async function del(id: string) {
    await api(`/api/compensation/${id}`, { method: "DELETE" });
    current.reload();
    records.reload();
  }

  const c = current.data;
  return (
    <div className="card">
      <div className="spread mb-2">
        <h3 className="m-0 flex items-center gap-2 text-base"><Banknote size={16} /> Compensation</h3>
        {canManage && (
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Record"}
          </button>
        )}
      </div>

      {c?.amount ? (
        <div className="mb-2">
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold">{money(c.amount, c.currency)}</span>
            <span className="muted mb-0.5 text-sm">/ {c.pay_period}</span>
          </div>
          <div className="muted text-xs">
            since {c.effective_date}
            {c.pay_period !== "annual" && c.annualised ? ` · ${money(c.annualised, c.currency)}/yr` : ""}
            {c.band_name ? ` · ${c.band_name}` : ""}
          </div>
        </div>
      ) : (
        <Muted>No salary on record.</Muted>
      )}

      {adding && (
        <form onSubmit={add} className="mb-3 rounded-lg border border-slate-200 p-2">
          <div className="row">
            <div className="field">
              <label>Type</label>
              <select value={f.record_type} onChange={(e) => setF((p) => ({ ...p, record_type: e.target.value }))}>
                {COMP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field"><label>Amount</label><input type="number" step="0.01" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} /></div>
            <div className="field" style={{ maxWidth: 80 }}><label>Currency</label><input value={f.currency} onChange={(e) => setF((p) => ({ ...p, currency: e.target.value.toUpperCase() }))} /></div>
          </div>
          <div className="row">
            <div className="field">
              <label>Period</label>
              <select value={f.pay_period} onChange={(e) => setF((p) => ({ ...p, pay_period: e.target.value }))}>
                {PAY_PERIODS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field"><label>Effective</label><input type="date" value={f.effective_date} onChange={(e) => setF((p) => ({ ...p, effective_date: e.target.value }))} /></div>
          </div>
          <div className="field"><label>Note</label><input value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></div>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </form>
      )}

      {(records.data?.length ?? 0) > 0 && (
        <div className="divide-y divide-slate-100">
          {records.data!.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
              <div>
                <span className="badge mr-1">{r.record_type}</span>
                <span className="font-medium">{money(r.amount, r.currency)}</span>
                <span className="muted"> / {r.pay_period} · {r.effective_date}</span>
              </div>
              {canManage && (
                <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(r.id)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {rewards.data && Number(rewards.data.total_annual) > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="spread mb-1">
            <span className="text-sm font-semibold">Total rewards (annual)</span>
            <span className="text-lg font-bold">{money(rewards.data.total_annual, rewards.data.currency)}</span>
          </div>
          <div className="space-y-0.5 text-xs">
            {rewards.data.components.map((c, i) => (
              <div key={i} className="flex justify-between">
                <span className="muted">{c.label}</span>
                <span>{money(c.annual_amount, rewards.data!.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentsSection({ userId, canManage, isSelf }: { userId: string; canManage: boolean; isSelf: boolean }) {
  const { notify } = useToast();
  const docs = useFetch<HrDocument[]>(`/api/hr-documents/by-user/${userId}`);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", category: "contract", issue_date: "", expiry_date: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState<HrDocument | null>(null);

  async function requestSig(id: string) {
    try {
      await api(`/api/hr-documents/${id}/signature-requests`, { method: "POST" });
      notify("Signature requested.");
      docs.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !form.title.trim()) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", form.title.trim());
      fd.append("category", form.category);
      if (form.issue_date) fd.append("issue_date", form.issue_date);
      if (form.expiry_date) fd.append("expiry_date", form.expiry_date);
      await api(`/api/hr-documents/by-user/${userId}`, { method: "POST", form: fd });
      setForm({ title: "", category: "contract", issue_date: "", expiry_date: "" });
      setFile(null);
      setAdding(false);
      docs.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    setBusy(false);
  }
  async function del(id: string) {
    await api(`/api/hr-documents/${id}`, { method: "DELETE" });
    docs.reload();
  }

  return (
    <div className="card">
      <div className="spread mb-2">
        <h3 className="m-0 flex items-center gap-2 text-base"><FileText size={16} /> Documents</h3>
        {canManage && (
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Upload"}
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={upload} className="mb-3 rounded-lg border border-slate-200 p-2">
          <div className="row">
            <div className="field"><label>Title</label><input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></div>
            <div className="field">
              <label>Category</label>
              <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
                {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field"><label>Issue date</label><input type="date" value={form.issue_date} onChange={(e) => setForm((p) => ({ ...p, issue_date: e.target.value }))} /></div>
            <div className="field"><label>Expiry date</label><input type="date" value={form.expiry_date} onChange={(e) => setForm((p) => ({ ...p, expiry_date: e.target.value }))} /></div>
          </div>
          <div className="field"><label>File</label><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy || !file}>{busy ? "Uploading…" : "Upload"}</button>
        </form>
      )}
      {docs.loading ? (
        <Loading />
      ) : (docs.data?.length ?? 0) === 0 ? (
        <Muted>No documents.</Muted>
      ) : (
        <div className="divide-y divide-slate-100">
          {docs.data!.map((d) => {
            const expSoon = d.days_to_expiry != null && d.days_to_expiry <= 30;
            const expired = d.days_to_expiry != null && d.days_to_expiry < 0;
            return (
              <div key={d.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">
                    <span className="badge mr-1">{d.category.replace("_", " ")}</span>{d.title}
                  </div>
                  {d.expiry_date && (
                    <div className={`text-xs ${expired ? "text-rose-600" : expSoon ? "text-amber-600" : "muted"}`}>
                      {expired ? "Expired " : "Expires "}{d.expiry_date}
                      {d.days_to_expiry != null && !expired ? ` (${d.days_to_expiry}d)` : ""}
                    </div>
                  )}
                  {d.signature_status && (
                    <div className="mt-0.5">
                      <span className={`badge ${d.signature_status === "signed" ? "green" : "amber"}`}>
                        {d.signature_status === "signed" ? "✓ signed" : "awaiting signature"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-none gap-1">
                  {isSelf && d.signature_status === "pending" && (
                    <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={() => setSigning(d)}>
                      Sign
                    </button>
                  )}
                  {canManage && !d.signature_status && (
                    <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => requestSig(d.id)} title="Request signature">
                      <PenLine size={13} />
                    </button>
                  )}
                  <button
                    className="btn-sm inline-flex items-center gap-1"
                    style={{ flex: "0 0 auto" }}
                    onClick={() => downloadFile(`/api/hr-documents/${d.id}/download`, d.title).catch(() => notify("Download failed", "error"))}
                  >
                    <Download size={13} />
                  </button>
                  {canManage && (
                    <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(d.id)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {signing && (
        <SignModal
          doc={signing}
          onClose={() => setSigning(null)}
          onDone={() => { setSigning(null); docs.reload(); }}
        />
      )}
    </div>
  );
}

function SignModal({ doc, onClose, onDone }: { doc: HrDocument; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !consent || !doc.signature_request_id) return;
    setBusy(true);
    try {
      await api(`/api/hr-documents/signatures/${doc.signature_request_id}/sign`, {
        method: "POST",
        body: { typed_name: name.trim(), consent },
      });
      notify("Document signed.");
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Sign — ${doc.title}`} onClose={onClose} maxWidth={460}>
      <form onSubmit={submit}>
        <p className="muted text-sm">
          Review the document, then type your full name to e-sign. This records a
          legal audit trail (your name, the date, and your IP address).
        </p>
        <button
          type="button"
          className="btn-sm my-2 inline-flex items-center gap-1"
          style={{ flex: "0 0 auto" }}
          onClick={() => downloadFile(`/api/hr-documents/${doc.id}/download`, doc.title).catch(() => notify("Download failed", "error"))}
        >
          <Download size={13} /> View document
        </button>
        <div className="field"><label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full legal name" /></div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="!w-auto" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          I agree this constitutes my electronic signature.
        </label>
        <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy || !name.trim() || !consent}>
            {busy ? "Signing…" : "Sign"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EmploymentHistory({
  userId,
  canManage,
  events,
  onChange,
}: {
  userId: string;
  canManage: boolean;
  events: ProfileEvent[];
  onChange: () => void;
}) {
  const { notify } = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ event_type: "note", title: "", effective_date: "", detail: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      await api(`/api/people/${userId}/events`, {
        method: "POST",
        body: {
          event_type: form.event_type,
          title: form.title.trim(),
          effective_date: form.effective_date || null,
          detail: form.detail || null,
        },
      });
      setForm({ event_type: "note", title: "", effective_date: "", detail: "" });
      setAdding(false);
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(id: string) {
    await api(`/api/people/events/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="card">
      <div className="spread mb-2">
        <h3 className="m-0 flex items-center gap-2 text-base"><CalendarClock size={16} /> Employment history</h3>
        {canManage && (
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>
      {adding && (
        <form onSubmit={add} className="mb-3 rounded-lg border border-slate-200 p-2">
          <div className="row">
            <div className="field">
              <label>Type</label>
              <select value={form.event_type} onChange={(e) => setForm((p) => ({ ...p, event_type: e.target.value }))}>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
            </div>
            <div className="field"><label>Date</label><input type="date" value={form.effective_date} onChange={(e) => setForm((p) => ({ ...p, effective_date: e.target.value }))} /></div>
          </div>
          <div className="field"><label>Title</label><input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Promoted to Senior" /></div>
          <div className="field"><label>Detail</label><textarea rows={2} value={form.detail} onChange={(e) => setForm((p) => ({ ...p, detail: e.target.value }))} /></div>
          <button className="btn-primary" style={{ flex: "0 0 auto" }}>Add event</button>
        </form>
      )}
      {events.length === 0 ? (
        <Muted>No history recorded.</Muted>
      ) : (
        <div className="divide-y divide-slate-100">
          {events.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-2 py-1.5 text-sm">
              <div className="min-w-0">
                <div className="font-medium">
                  <span className="badge mr-1">{e.event_type.replace("_", " ")}</span>
                  {e.title}
                </div>
                <div className="muted text-xs">{e.effective_date}{e.detail ? ` · ${e.detail}` : ""}</div>
              </div>
              {canManage && (
                <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(e.id)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditProfileModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const departments = useFetch<Department[]>(isAdmin ? "/api/departments" : null);
  const people = useFetch<User[]>(isAdmin ? "/api/users" : null);
  const [f, setF] = useState({
    job_title: profile.job_title ?? "",
    hr_department: profile.hr_department ?? "",
    office_location: profile.office_location ?? "",
    mobile_phone: profile.mobile_phone ?? "",
    business_phone: profile.business_phone ?? "",
    personal_email: profile.personal_email ?? "",
    nationality: profile.nationality ?? "",
    passport_no: profile.passport_no ?? "",
    date_of_birth: profile.date_of_birth ?? "",
    employment_type: profile.employment_type ?? "",
    hire_date: profile.hire_date ?? "",
    probation_end_date: profile.probation_end_date ?? "",
    contract_end_date: profile.contract_end_date ?? "",
    emergency_contact_name: profile.emergency_contact_name ?? "",
    emergency_contact_phone: profile.emergency_contact_phone ?? "",
    emergency_contact_relationship: profile.emergency_contact_relationship ?? "",
    manager_id: profile.manager_id ?? "",
    role: profile.role,
    status: profile.status,
    department_id: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        job_title: f.job_title || null,
        hr_department: f.hr_department || null,
        office_location: f.office_location || null,
        mobile_phone: f.mobile_phone || null,
        business_phone: f.business_phone || null,
        employment_type: f.employment_type || null,
        hire_date: f.hire_date || null,
        probation_end_date: f.probation_end_date || null,
        contract_end_date: f.contract_end_date || null,
        emergency_contact_name: f.emergency_contact_name || null,
        emergency_contact_phone: f.emergency_contact_phone || null,
        emergency_contact_relationship: f.emergency_contact_relationship || null,
      };
      if (profile.can_see_sensitive) {
        body.personal_email = f.personal_email || null;
        body.nationality = f.nationality || null;
        body.passport_no = f.passport_no || null;
        body.date_of_birth = f.date_of_birth || null;
      }
      if (isAdmin) {
        body.role = f.role;
        body.status = f.status;
        body.manager_id = f.manager_id || null;
        if (f.department_id) body.department_id = f.department_id;
      }
      await api(`/api/profiles/${profile.id}`, { method: "PATCH", body });
      notify("Profile updated.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit ${profile.name ?? profile.email}`} onClose={onClose} maxWidth={560}>
      <form onSubmit={save}>
        <div className="row">
          <div className="field"><label>Job title</label><input value={f.job_title} onChange={(e) => set("job_title", e.target.value)} /></div>
          <div className="field"><label>Department (label)</label><input value={f.hr_department} onChange={(e) => set("hr_department", e.target.value)} /></div>
        </div>
        <div className="field"><label>Office location</label><input value={f.office_location} onChange={(e) => set("office_location", e.target.value)} /></div>
        <div className="row">
          <div className="field"><label>Mobile</label><input value={f.mobile_phone} onChange={(e) => set("mobile_phone", e.target.value)} /></div>
          <div className="field"><label>Work phone</label><input value={f.business_phone} onChange={(e) => set("business_phone", e.target.value)} /></div>
        </div>

        <div className="row">
          <div className="field">
            <label>Employment type</label>
            <select value={f.employment_type} onChange={(e) => set("employment_type", e.target.value)}>
              <option value="">—</option>
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
          </div>
          <div className="field"><label>Hire date</label><input type="date" value={f.hire_date} onChange={(e) => set("hire_date", e.target.value)} /></div>
        </div>
        <div className="row">
          <div className="field"><label>Probation end</label><input type="date" value={f.probation_end_date} onChange={(e) => set("probation_end_date", e.target.value)} /></div>
          <div className="field"><label>Contract end</label><input type="date" value={f.contract_end_date} onChange={(e) => set("contract_end_date", e.target.value)} /></div>
        </div>
        {isAdmin && (
          <div className="field">
            <label>Manager</label>
            <select value={f.manager_id} onChange={(e) => set("manager_id", e.target.value)}>
              <option value="">— None —</option>
              {(people.data ?? []).filter((u) => u.id !== profile.id).map((u) => (
                <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>
              ))}
            </select>
          </div>
        )}

        {profile.can_see_sensitive && (
          <>
            <div className="field"><label>Personal email</label><input value={f.personal_email} onChange={(e) => set("personal_email", e.target.value)} /></div>
            <div className="row">
              <div className="field"><label>Nationality</label><input value={f.nationality} onChange={(e) => set("nationality", e.target.value)} /></div>
              <div className="field"><label>Passport</label><input value={f.passport_no} onChange={(e) => set("passport_no", e.target.value)} /></div>
              <div className="field"><label>Date of birth</label><input type="date" value={f.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} /></div>
            </div>
            <div className="row">
              <div className="field"><label>Emergency contact</label><input value={f.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} /></div>
              <div className="field"><label>Contact phone</label><input value={f.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} /></div>
              <div className="field"><label>Relationship</label><input value={f.emergency_contact_relationship} onChange={(e) => set("emergency_contact_relationship", e.target.value)} /></div>
            </div>
          </>
        )}
        {isAdmin && (
          <div className="row">
            <div className="field">
              <label>Role</label>
              <select value={f.role} onChange={(e) => set("role", e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Status</label>
              <select value={f.status} onChange={(e) => set("status", e.target.value)}>
                {USER_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Access department</label>
              <select value={f.department_id} onChange={(e) => set("department_id", e.target.value)}>
                <option value="">Keep current</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CustomFieldsSection({ userId }: { userId: string }) {
  const { notify } = useToast();
  const cv = useFetch<CustomValues>(`/api/custom-fields/values/${userId}`);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);

  const data = cv.data;
  if (cv.loading || !data) return null;
  if (data.fields.length === 0 && data.tables.length === 0) return null;

  function startEdit() {
    const d: Record<string, unknown> = {};
    data!.fields.forEach((f) => (d[f.def_id] = f.value ?? ""));
    setDraft(d);
    setEditing(true);
  }
  async function save() {
    setBusy(true);
    try {
      await api(`/api/custom-fields/values/${userId}`, { method: "PUT", body: { values: draft } });
      setEditing(false);
      cv.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
    setBusy(false);
  }

  // Group single-value fields by section.
  const bySection: Record<string, typeof data.fields> = {};
  data.fields.forEach((f) => {
    (bySection[f.section] ??= []).push(f);
  });

  return (
    <>
      {data.fields.length > 0 && (
        <div className="card">
          <div className="spread mb-2">
            <h3 className="m-0 flex items-center gap-2 text-base"><Sliders size={16} /> Additional information</h3>
            {data.can_edit && (
              editing ? (
                <span className="flex gap-1">
                  <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setEditing(false)}>Cancel</button>
                  <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>Save</button>
                </span>
              ) : (
                <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={startEdit}>Edit</button>
              )
            )}
          </div>
          {Object.entries(bySection).map(([section, fields]) => (
            <div key={section} className="mb-2">
              <div className="muted mb-1 text-xs uppercase tracking-wide">{section}</div>
              <div className="space-y-1 text-sm">
                {fields.map((f) =>
                  editing ? (
                    <div key={f.def_id} className="flex items-center justify-between gap-2">
                      <span className="muted">{f.label}</span>
                      <span style={{ flex: "0 0 60%" }}>{renderInput(f, draft[f.def_id], (v) => setDraft((p) => ({ ...p, [f.def_id]: v })))}</span>
                    </div>
                  ) : (
                    <div key={f.def_id} className="flex justify-between gap-2">
                      <span className="muted">{f.label}{f.sensitive ? " 🔒" : ""}</span>
                      <span className="text-right">{formatValue(f.value) || "—"}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.tables.map((t) => (
        <CustomTableCard key={t.table_id} userId={userId} table={t} canEdit={data.can_edit} onChange={cv.reload} />
      ))}
    </>
  );
}

function renderInput(f: CustomFieldValue, value: unknown, onChange: (v: unknown) => void) {
  if (f.field_type === "bool")
    return <input type="checkbox" className="!w-auto" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  if (f.field_type === "select")
    return (
      <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  if (f.field_type === "textarea")
    return <textarea rows={2} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  const type = f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text";
  return <input type={type} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
}

function formatValue(v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v == null) return "";
  return String(v);
}

function CustomTableCard({
  userId, table, canEdit, onChange,
}: {
  userId: string;
  table: CustomTableValues;
  canEdit: boolean;
  onChange: () => void;
}) {
  const { notify } = useToast();
  const [adding, setAdding] = useState(false);
  const [row, setRow] = useState<Record<string, string>>({});

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/custom-fields/tables/${table.table_id}/rows/${userId}`, { method: "POST", body: { data: row } });
      setRow({});
      setAdding(false);
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(id: string) {
    await api(`/api/custom-fields/rows/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="card">
      <div className="spread mb-2">
        <h3 className="m-0 text-base">{table.label}{table.sensitive ? " 🔒" : ""}</h3>
        {canEdit && (
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "+ Add"}</button>
        )}
      </div>
      {table.rows.length === 0 ? (
        <Muted>No entries.</Muted>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>{table.columns.map((c) => <th key={c.key} className="text-left">{c.label}</th>)}{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.id}>
                {table.columns.map((c) => <td key={c.key}>{formatValue(r.data[c.key])}</td>)}
                {canEdit && (
                  <td className="text-right">
                    <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(r.id)}><Trash2 size={12} /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {adding && (
        <form onSubmit={add} className="mt-2 flex flex-wrap items-end gap-2">
          {table.columns.map((c) => (
            <div key={c.key} className="field" style={{ marginBottom: 0, flex: 1 }}>
              <label>{c.label}</label>
              <input value={row[c.key] ?? ""} onChange={(e) => setRow((p) => ({ ...p, [c.key]: e.target.value }))} />
            </div>
          ))}
          <button className="btn-primary" style={{ flex: "0 0 auto" }}>Add</button>
        </form>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="spread mb-2">
        <h3 className="m-0 flex items-center gap-2 text-base">{icon} {title}</h3>
        <span className="badge">{count}</span>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function Item({ label, sub, right }: { label: string; sub?: string | null; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{label}</div>
        {sub && <div className="muted text-xs">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="muted py-1 text-sm">{children}</p>;
}
