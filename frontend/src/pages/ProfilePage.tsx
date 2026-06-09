import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Boxes,
  CalendarClock,
  CheckSquare,
  KeyRound,
  ListChecks,
  Pencil,
  Smartphone,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
import { api } from "../api/client";
import type { Department, Profile, ProfileEvent, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

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

export default function ProfilePage() {
  const { id } = useParams();
  const path = id ? `/api/profiles/${id}` : "/api/profiles/me";
  const { data: p, loading, error, reload } = useFetch<Profile>(path);
  const [editing, setEditing] = useState(false);

  if (loading) return <Loading />;
  if (error || !p)
    return <Empty message={error ? "You don't have access to this profile." : "Not found."} />;

  return (
    <div>
      <PageHead
        title={p.name ?? p.email ?? "Profile"}
        subtitle={p.job_title ?? undefined}
        action={
          p.can_manage ? (
            <button className="btn inline-flex items-center gap-1.5" onClick={() => setEditing(true)}>
              <Pencil size={15} /> Edit
            </button>
          ) : undefined
        }
      />
      {editing && (
        <EditProfileModal
          profile={p}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); }}
        />
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
        {/* Identity card */}
        <div className="card">
          <div className="flex items-center gap-3">
            <span className="grid h-14 w-14 flex-none place-items-center overflow-hidden rounded-full bg-brand-100 text-brand-700">
              {p.avatar_url ? (
                <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <UserRound size={26} />
              )}
            </span>
            <div className="min-w-0">
              <div className="font-semibold">{p.name ?? p.email}</div>
              {p.job_title && <div className="muted text-sm">{p.job_title}</div>}
              <div className="mt-1 flex flex-wrap gap-1">
                <span className={badge(p.status)}>{p.status}</span>
                <span className="badge">{p.is_admin ? "admin" : p.role}</span>
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-1 text-sm">
            <Row label="Email" value={p.email} />
            <Row label="Department" value={p.department_name ?? p.hr_department} />
            {p.manager_id ? (
              <div className="flex justify-between gap-2">
                <span className="muted">Manager</span>
                <Link to={`/people/${p.manager_id}`} className="text-right text-brand-600 hover:underline">
                  {p.manager_name}
                </Link>
              </div>
            ) : null}
            <Row label="Office" value={p.office_location} />
            <Row label="Mobile" value={p.mobile_phone} />
            <Row label="Work phone" value={p.business_phone} />
            <Row label="Employment" value={p.employment_type?.replace("_", " ")} />
            <Row label="Hire date" value={p.hire_date} />
            <Row label="Probation end" value={p.probation_end_date} />
            <Row label="Contract end" value={p.contract_end_date} />
            {p.can_see_sensitive && (
              <>
                <Row label="Personal email" value={p.personal_email} />
                <Row label="Nationality" value={p.nationality} />
                <Row label="Passport" value={p.passport_no} />
                <Row label="Date of birth" value={p.date_of_birth} />
                <Row label="Emergency" value={p.emergency_contact_name} />
                <Row label="Emergency phone" value={p.emergency_contact_phone} />
                <Row label="Relationship" value={p.emergency_contact_relationship} />
              </>
            )}
          </div>

          {p.direct_reports.length > 0 && (
            <div className="mt-3">
              <div className="muted mb-1 text-xs">Direct reports ({p.direct_reports.length})</div>
              <div className="flex flex-col gap-0.5">
                {p.direct_reports.map((r) => (
                  <Link key={r.id} to={`/people/${r.id}`} className="text-sm text-brand-600 hover:underline">
                    {r.label} {r.sub && <span className="muted text-xs">· {r.sub}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3">
            <div className="muted mb-1 text-xs">Module access ({p.modules.length})</div>
            <div className="flex flex-wrap gap-1">
              {p.modules.map((m) => (
                <span key={m} className="badge">{m}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Belongings & work */}
        <div className="space-y-4">
          <Section icon={<Wallet size={16} />} title="Subscriptions" count={p.subscriptions.length}>
            {p.subscriptions.length === 0 ? (
              <Muted>No subscriptions.</Muted>
            ) : (
              p.subscriptions.map((s) => (
                <Item
                  key={s.subscription_id + s.source}
                  label={s.name}
                  sub={s.vendor}
                  right={
                    <span className="badge">
                      {s.source === "seat" ? (s.seat_status ?? "seat") : s.source}
                    </span>
                  }
                />
              ))
            )}
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

          {p.journeys.length > 0 && (
            <Section icon={<ListChecks size={16} />} title="Onboarding / Offboarding" count={p.journeys.length}>
              {p.journeys.map((j) => (
                <Link key={j.id} to="/people-ops" className="block">
                  <Item
                    label={j.kind === "offboarding" ? "Offboarding" : "Onboarding"}
                    sub={`${j.done_tasks}/${j.total_tasks} steps`}
                    right={<span className={badge(j.status === "completed" ? "active" : "pending")}>{j.status}</span>}
                  />
                </Link>
              ))}
            </Section>
          )}

          {p.can_see_sensitive && (
            <EmploymentHistory userId={p.id} canManage={p.can_manage} events={p.events} onChange={reload} />
          )}
        </div>
      </div>
    </div>
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
