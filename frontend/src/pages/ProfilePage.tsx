import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { VariantProps } from "class-variance-authority";
import { useEffect, useState } from "react";
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
  LockKeyhole,
  ListChecks,
  Mail,
  MapPin,
  Pencil,
  PenLine,
  Phone,
  Sliders,
  Smartphone,
  ShieldX,
  Target,
  Trash2,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { numericInput } from "../utils/numbers";
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
import { Button } from "@/components/ui/button";

const ROLES = ["member", "manager", "admin"];
const USER_STATUSES = ["active", "invited", "suspended", "offboarding", "departed"];
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "intern", "temporary"];
const EVENT_TYPES = [
  "hired", "promotion", "transfer", "title_change", "manager_change",
  "contract", "compensation", "leave", "note", "terminated",
];

const STATUS_BADGE: Record<string, VariantProps<typeof badgeVariants>["variant"]> = {
  active: "success",
  available: "success",
  assigned: "secondary",
  revoked: "destructive",
  disabled: "destructive",
  pending: "warning",
  maintenance: "warning",
  suspended: "warning",
};

function badge(s?: string | null) {
  return s ? STATUS_BADGE[s] ?? "secondary" : "secondary";
}

const TABS: { key: string; label: string; description: string; icon: LucideIcon; sensitive?: boolean }[] = [
  { key: "personal", label: "Personal", description: "Contact details, personal information and custom fields.", icon: UserRound },
  { key: "job", label: "Job", description: "Employment details, reporting lines and employment history.", icon: Briefcase },
  { key: "comp", label: "Compensation", description: "Current compensation, pay records and total rewards.", icon: Banknote, sensitive: true },
  { key: "documents", label: "Documents", description: "Employment documents, downloads and signature requests.", icon: FileText, sensitive: true },
  { key: "performance", label: "Performance", description: "Goals, progress and due dates.", icon: Target },
  { key: "assets", label: "Assets & Access", description: "Assigned equipment, subscriptions, access and open work.", icon: Boxes },
  { key: "history", label: "Change History", description: "An audit trail of changes made to this profile.", icon: CalendarClock, sensitive: true },
];

export default function ProfilePage() {
  const { id } = useParams();
  const { user: viewer } = useAuth();
  const viewerId = viewer?.id;
  const path = id ? `/api/profiles/${id}` : "/api/profiles/me";
  const { data: p, loading, error, reload } = useFetch<Profile>(path);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("personal");

  useEffect(() => {
    setTab("personal");
  }, [path]);

  useEffect(() => {
    if (p && !p.can_see_sensitive && TABS.find((item) => item.key === tab)?.sensitive) {
      setTab("personal");
    }
  }, [p, tab]);

  if (loading) return <Loading />;
  if (error || !p) {
    // Distinguish an expired/invalid session (401) from a genuine permission
    // denial (403) — they used to show the same misleading message.
    const sessionExpired = /not authenticated|credential|401/i.test(error ?? "");
    if (sessionExpired) {
      return (
        <Empty
          icon={<LockKeyhole />}
          message="Your session has expired"
          hint="Please sign in again to continue."
          action={
            <Button render={<Link to="/login" />}>Go to sign in</Button>
          }
        />
      );
    }
    return (
      <Empty
        icon={<ShieldX />}
        message={error ? "You don't have access to this profile" : "Profile not found"}
        hint={
          error
            ? "Only admins, HR, the person themselves, or their department manager can view a profile."
            : undefined
        }
      />
    );
  }

  const tabs = TABS.filter((t) => !t.sensitive || p.can_see_sensitive);
  const activeTab = tabs.find((item) => item.key === tab) ?? tabs[0];
  const canEditGoals = p.can_manage || p.id === viewerId;

  return (
    <div className="flex flex-col gap-6">
      {editing && (
        <EditProfileModal
          profile={p}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); }}
        />
      )}

      <header className="flex flex-col gap-5 border-b pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <ProfileAvatar name={p.name} email={p.email} url={p.avatar_url} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 truncate text-2xl font-semibold tracking-tight">{p.name ?? p.email}</h1>
              <Badge variant={badge(p.status)}>{p.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {p.job_title ?? "No job title"}
              {(p.department_name || p.hr_department) ? ` · ${p.department_name ?? p.hr_department}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="capitalize">{p.is_admin ? "admin" : p.role}</Badge>
              {p.employment_type ? (
                <Badge variant="secondary" className="capitalize">{p.employment_type.replace("_", " ")}</Badge>
              ) : null}
            </div>
          </div>
          {p.can_manage ? (
            <Button type="button" variant="outline" className="self-start sm:self-center" onClick={() => setEditing(true)}>
              <Pencil data-icon="inline-start" strokeWidth={1.5} /> Edit profile
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Fact icon={<Building2 />} value={p.department_name ?? p.hr_department} />
          {p.manager_id ? (
            <Fact icon={<Users />} value={<Link to={`/people/${p.manager_id}`} className="font-medium hover:underline">{p.manager_name}</Link>} />
          ) : null}
          <Fact icon={<MapPin />} value={p.office_location} />
          <Fact icon={<CalendarDays />} value={p.hire_date ? `Joined ${p.hire_date}` : null} />
          <Fact icon={<Mail />} value={p.email} />
          <Fact icon={<Phone />} value={p.mobile_phone} />
        </div>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row">
        <aside className="lg:w-56 lg:shrink-0">
          <nav aria-label="Profile sections" className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:flex lg:flex-col">
            {tabs.map((item) => (
              <Button
                key={item.key}
                type="button"
                variant="ghost"
                onClick={() => setTab(item.key)}
                className={tab === item.key
                  ? "h-9 w-full justify-start bg-foreground px-3 text-background hover:bg-foreground hover:text-background"
                  : "h-9 w-full justify-start px-3 text-foreground/75 hover:text-foreground"}
                aria-current={tab === item.key ? "page" : undefined}
              >
                <item.icon data-icon="inline-start" strokeWidth={1.5} />
                <span className="truncate">{item.label}</span>
              </Button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-5">
            <h2 className="m-0 text-lg font-semibold">{activeTab.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{activeTab.description}</p>
          </div>
          <div className="flex flex-col gap-4">
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
                    <span className="text-muted-foreground">Manager</span>
                    <Link to={`/people/${p.manager_id}`} className="font-medium hover:underline">{p.manager_name}</Link>
                  </div>
                ) : <Row label="Manager" value={null} />}
                <div className="mt-1">
                  <div className="mb-1 text-xs text-muted-foreground">Direct reports ({p.direct_reports.length})</div>
                  {p.direct_reports.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None.</p>
                  ) : (
                    p.direct_reports.map((r) => (
                      <Link key={r.id} to={`/people/${r.id}`} className="block text-sm font-medium hover:underline">
                        {r.label} {r.sub && <span className="text-xs text-muted-foreground">· {r.sub}</span>}
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

        {tab === "history" && p.can_see_sensitive && <FieldHistorySection userId={p.id} />}

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
                  right={<Badge variant="secondary">{s.source === "seat" ? (s.seat_status ?? "seat") : s.source}</Badge>} />
              ))}
            </Section>
            <div className="grid gap-4 md:grid-cols-2">
              <Section icon={<Boxes size={16} />} title="Assets" count={p.assets.length}>
                {p.assets.length === 0 ? <Muted>None assigned.</Muted> : p.assets.map((a) => (
                  <Item key={a.id} label={a.label} sub={a.sub} right={<Badge variant={badge(a.status)}>{a.status}</Badge>} />
                ))}
              </Section>
              <Section icon={<Smartphone size={16} />} title="Phone lines" count={p.phones.length}>
                {p.phones.length === 0 ? <Muted>None assigned.</Muted> : p.phones.map((a) => (
                  <Item key={a.id} label={a.label} sub={a.sub} right={<Badge variant={badge(a.status)}>{a.status}</Badge>} />
                ))}
              </Section>
            </div>
            <Section icon={<KeyRound size={16} />} title="Access grants" count={p.access_grants.length}>
              {p.access_grants.length === 0 ? <Muted>No tracked accounts.</Muted> : p.access_grants.map((g) => (
                <Item key={g.id} label={g.label} sub={g.sub} right={<Badge variant={badge(g.status)}>{g.status}</Badge>} />
              ))}
            </Section>
            <Section icon={<CheckSquare size={16} />} title="Open tasks" count={p.open_tasks.length}>
              {p.open_tasks.length === 0 ? <Muted>No open tasks.</Muted> : p.open_tasks.map((t) => (
                <Item key={t.id} label={t.title} sub={t.due_date ? `due ${t.due_date}` : null} right={<Badge variant="secondary">{t.status}</Badge>} />
              ))}
            </Section>
            <Section icon={<KeyRound size={16} />} title="Module access" count={p.modules.length}>
              <div className="flex flex-wrap gap-1 py-1">
                {p.modules.map((m) => <Badge key={m} variant="secondary">{m}</Badge>)}
              </div>
            </Section>
            {p.journeys.length > 0 && (
              <Section icon={<ListChecks size={16} />} title="Onboarding / Offboarding" count={p.journeys.length}>
                {p.journeys.map((j) => (
                  <Link
                    key={j.id}
                    to="/people-ops"
                    className="block"
                    aria-label={j.kind === "offboarding" ? "Offboarding journey" : "Onboarding journey"}
                    title={j.kind === "offboarding" ? "Offboarding" : "Onboarding"}
                  >
                    <Item label={j.kind === "offboarding" ? "Offboarding" : "Onboarding"}
                      sub={`${j.done_tasks}/${j.total_tasks} steps`}
                      right={<Badge variant={badge(j.status === "completed" ? "active" : "pending")}>{j.status}</Badge>} />
                  </Link>
                ))}
              </Section>
            )}
          </>
        )}
          </div>
        </main>
      </div>
    </div>
  );
}

function ProfileAvatar({ name, email, url }: { name?: string | null; email?: string | null; url?: string | null }) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  const init = (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
  return (
    <Avatar className="size-20">
      {url && <AvatarImage src={url} alt="" />}
      <AvatarFallback className="bg-primary/15 text-xl font-semibold text-foreground">{init}</AvatarFallback>
    </Avatar>
  );
}

function Fact({ icon, value }: { icon: React.ReactNode; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5 [&_svg]:stroke-[1.5]">
      <span aria-hidden="true">{icon}</span> {value}
    </span>
  );
}

function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2 [&_svg]:stroke-[1.5]">{icon} {title}</CardTitle></CardHeader><CardContent className="flex flex-col gap-1 text-sm">{children}</CardContent></Card>
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
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
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Target /> Goals</CardTitle>
        {canEdit && (
          <CardAction>
          <Button aria-label="Adding" type="button" size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Goal"}
          </Button>
          </CardAction>
        )}
      </CardHeader><CardContent>
      {adding && (
        <form onSubmit={add} className="mb-3 flex flex-col gap-4 border border-border p-2"><FieldGroup><Field><FieldLabel htmlFor="profile-goal">Goal</FieldLabel><Input id="profile-goal" aria-label="Ship the HR module" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Ship the HR module" /></Field><Field><FieldLabel htmlFor="profile-goal-due">Due</FieldLabel><Input id="profile-goal-due" type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} /></Field></FieldGroup><Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add goal"}
          </Button></form>
      )}
      {(goals.data?.length ?? 0) === 0 ? (
        <Muted>No goals set.</Muted>
      ) : (
        <div className="flex flex-col gap-2">
          {goals.data!.map((g) => (
            <div key={g.id} className="border border-border p-2">
              <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                <span className="font-medium">{g.title}</span>
                <div className="flex w-full flex-none items-center gap-2 sm:w-auto">
                  {canEdit ? (
                    <Select items={GOAL_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))} value={g.status} onValueChange={(value) => value !== null && patch(g.id, { status: value })}>
                      <SelectTrigger id={`goal-status-${g.id}`} aria-label="Status" className="w-full" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{GOAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{g.status.replace("_", " ")}</Badge>
                  )}
                  {canEdit && (
                    <Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={() => del(g.id)}><Trash2 /></Button>
                  )}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 bg-muted">
                  <div className="h-1.5 bg-foreground/60" style={{ width: `${g.progress}%` }} />
                </div>
                {canEdit ? (
                  <Input aria-label="Numeric value"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={g.progress}
                    className="w-16"
                    onBlur={(e) => { const v = numericInput(e.target.value, g.progress); if (v !== g.progress) patch(g.id, { progress: v }); }}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">{g.progress}%</span>
                )}
              </div>
              {g.due_date && <div className="mt-1 text-xs text-muted-foreground">Due {g.due_date}</div>}
            </div>
          ))}
        </div>
      )}</CardContent>
    </Card>
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.amount) return;
    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
    }

  }
  async function del(id: string) {
    await api(`/api/compensation/${id}`, { method: "DELETE" });
    current.reload();
    records.reload();
  }

  const c = current.data;
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Banknote /> Compensation</CardTitle>
        {canManage && (
          <CardAction>
          <Button aria-label="Adding" type="button" size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Record"}
          </Button>
          </CardAction>
        )}
      </CardHeader><CardContent>

      {c?.amount ? (
        <div className="mb-2">
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold">{money(c.amount, c.currency)}</span>
            <span className="mb-0.5 text-sm text-muted-foreground">/ {c.pay_period}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            since {c.effective_date}
            {c.pay_period !== "annual" && c.annualised ? ` · ${money(c.annualised, c.currency)}/yr` : ""}
            {c.band_name ? ` · ${c.band_name}` : ""}
          </div>
        </div>
      ) : (
        <Muted>No salary on record.</Muted>
      )}

      {adding && (
        <form onSubmit={add} className="mb-3 flex flex-col gap-4 border border-border p-2"><FieldGroup><div className="grid gap-4 sm:grid-cols-[1fr_1fr_80px]"><Field><FieldLabel htmlFor="comp-type">Type</FieldLabel><Select items={COMP_TYPES.map((t) => ({ value: t, label: t }))} value={f.record_type} onValueChange={(value) => setF((p) => ({ ...p, record_type: value ?? "" }))}><SelectTrigger id="comp-type" aria-label="Type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{COMP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="comp-amount">Amount</FieldLabel><Input id="comp-amount" type="number" step="0.01" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} /></Field><Field><FieldLabel htmlFor="comp-currency">Currency</FieldLabel><Input id="comp-currency" value={f.currency} onChange={(e) => setF((p) => ({ ...p, currency: e.target.value.toUpperCase() }))} /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="comp-period">Period</FieldLabel><Select items={PAY_PERIODS.map((t) => ({ value: t, label: t }))} value={f.pay_period} onValueChange={(value) => setF((p) => ({ ...p, pay_period: value ?? "" }))}><SelectTrigger id="comp-period" aria-label="Period" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{PAY_PERIODS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="comp-effective">Effective</FieldLabel><Input id="comp-effective" type="date" value={f.effective_date} onChange={(e) => setF((p) => ({ ...p, effective_date: e.target.value }))} /></Field></div><Field><FieldLabel htmlFor="comp-note">Note</FieldLabel><Input id="comp-note" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} /></Field></FieldGroup><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</Button></form>
      )}

      {(records.data?.length ?? 0) > 0 && (
        <div className="divide-y divide-border">
          {records.data!.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
              <div>
                <Badge variant="secondary" className="mr-1">{r.record_type}</Badge>
                <span className="font-medium">{money(r.amount, r.currency)}</span>
                <span className="text-muted-foreground"> / {r.pay_period} · {r.effective_date}</span>
              </div>
              {canManage && (
                <Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={() => del(r.id)}><Trash2 /></Button>
              )}
            </div>
          ))}
        </div>
      )}

      {rewards.data && Number(rewards.data.total_annual) > 0 && (
        <div className="mt-3 border border-border bg-muted p-3">
          <div className="mb-1 flex flex-col items-start justify-between gap-1 sm:flex-row sm:items-center">
            <span className="text-sm font-semibold">Total rewards (annual)</span>
            <span className="text-lg font-bold">{money(String(rewards.data.total_annual), rewards.data.currency)}</span>
          </div>
          <div className="flex flex-col gap-0.5 text-xs">
            {rewards.data.components.map((c) => (
              <div key={`${c.label}-${c.annual_amount}`} className="flex justify-between">
                <span className="text-muted-foreground">{c.label}</span>
                <span>{money(String(c.annual_amount), rewards.data!.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}</CardContent>
    </Card>
  );
}

function DocumentsSection({ userId, canManage, isSelf }: { userId: string; canManage: boolean; isSelf: boolean }) {
  const { notify } = useToast();
  const docs = useFetch<HrDocument[]>(`/api/hr-documents/by-user/${userId}`);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", category: "contract", issue_date: "", expiry_date: "" });
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
    }

  }
  async function del(id: string) {
    await api(`/api/hr-documents/${id}`, { method: "DELETE" });
    docs.reload();
  }

  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText /> Documents</CardTitle>
        {canManage && (
          <CardAction>
          <Button aria-label="Adding" type="button" size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Upload"}
          </Button>
          </CardAction>
        )}
      </CardHeader><CardContent>
      {adding && (
        <form onSubmit={upload} className="mb-3 flex flex-col gap-4 border border-border p-2"><FieldGroup><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="doc-title">Title</FieldLabel><Input id="doc-title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></Field><Field><FieldLabel htmlFor="doc-category">Category</FieldLabel><Select items={DOC_CATEGORIES.map((c) => ({ value: c, label: c.replace("_", " ") }))} value={form.category} onValueChange={(value) => setForm((p) => ({ ...p, category: value ?? "" }))}><SelectTrigger id="doc-category" aria-label="Category" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{DOC_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="doc-issue">Issue date</FieldLabel><Input id="doc-issue" type="date" value={form.issue_date} onChange={(e) => setForm((p) => ({ ...p, issue_date: e.target.value }))} /></Field><Field><FieldLabel htmlFor="doc-expiry">Expiry date</FieldLabel><Input id="doc-expiry" type="date" value={form.expiry_date} onChange={(e) => setForm((p) => ({ ...p, expiry_date: e.target.value }))} /></Field></div><Field><FieldLabel htmlFor="doc-file">File</FieldLabel><Input id="doc-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field></FieldGroup><Button type="submit" disabled={isSubmitting || !file}>{isSubmitting ? "Uploading…" : "Upload"}</Button></form>
      )}
      {docs.loading ? (
        <Loading />
      ) : (docs.data?.length ?? 0) === 0 ? (
        <Muted>No documents.</Muted>
      ) : (
        <div className="divide-y divide-border">
          {docs.data!.map((d) => {
            const expSoon = d.days_to_expiry != null && d.days_to_expiry <= 30;
            const expired = d.days_to_expiry != null && d.days_to_expiry < 0;
            return (
              <div key={d.id} className="flex flex-col items-start justify-between gap-2 py-1.5 text-sm sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <div className="font-medium">
                    <Badge variant="secondary" className="mr-1">{d.category.replace("_", " ")}</Badge>{d.title}
                  </div>
                  {d.expiry_date && (
                <div className={`text-xs ${expired ? "text-destructive" : expSoon ? "text-warning-foreground" : "text-muted-foreground"}`}>
                      {expired ? "Expired " : "Expires "}{d.expiry_date}
                      {d.days_to_expiry != null && !expired ? ` (${d.days_to_expiry}d)` : ""}
                    </div>
                  )}
                  {d.signature_status && (
                    <div className="mt-0.5">
                      <Badge variant={d.signature_status === "signed" ? "success" : "warning"}>
                        {d.signature_status === "signed" ? "signed" : "awaiting signature"}
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="flex flex-none gap-1">
                  {isSelf && d.signature_status === "pending" && (
                    <Button type="button" size="sm" onClick={() => setSigning(d)}>
                      Sign
                    </Button>
                  )}
                  {canManage && !d.signature_status && (
                    <Button type="button" size="icon-sm" variant="outline" aria-label="Request signature" onClick={() => requestSig(d.id)} title="Request signature"><PenLine /></Button>
                  )}
                  <Button aria-label="Download" type="button" size="icon-sm" variant="outline"
                    onClick={() => downloadFile(`/api/hr-documents/${d.id}/download`, d.title).catch(() => notify("Download failed", "error"))}
                  >
                    <Download />
                  </Button>
                  {canManage && (
                    <Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={() => del(d.id)}><Trash2 /></Button>
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
    </CardContent></Card>
  );
}

function SignModal({ doc, onClose, onDone }: { doc: HrDocument; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !consent || !doc.signature_request_id) return;
    setIsSubmitting(true);
    try {
      await api(`/api/hr-documents/signatures/${doc.signature_request_id}/sign`, {
        method: "POST",
        body: { typed_name: name.trim(), consent },
      });
      notify("Document signed.");
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Sign — ${doc.title}`} onClose={onClose} maxWidth={460}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Review the document, then type your full name to e-sign. This records a
          legal audit trail (your name, the date, and your IP address).
        </p>
        <Button
          type="button"
          size="sm" variant="outline"
          onClick={() => downloadFile(`/api/hr-documents/${doc.id}/download`, doc.title).catch(() => notify("Download failed", "error"))}
        >
          <Download data-icon="inline-start" /> View document
        </Button>
        <FieldGroup><Field><FieldLabel htmlFor="signature-name">Full name</FieldLabel><Input id="signature-name" aria-label="Your full legal name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full legal name" /></Field><Field orientation="horizontal"><Checkbox id="signature-consent" checked={consent} onCheckedChange={(checked) => setConsent(Boolean(checked))} /><FieldLabel htmlFor="signature-consent">I agree this constitutes my electronic signature.</FieldLabel></Field></FieldGroup>
        <div className="mt-3 flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={isSubmitting || !name.trim() || !consent}>
            {isSubmitting ? "Signing…" : "Sign"}
          </Button>
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
    }
  }
  async function del(id: string) {
    await api(`/api/people/events/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock /> Employment history</CardTitle>
        {canManage && (
          <CardAction>
          <Button aria-label="Adding" type="button" size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Add"}
          </Button>
          </CardAction>
        )}
      </CardHeader><CardContent>
      {adding && (
        <form onSubmit={add} className="mb-3 flex flex-col gap-4 border border-border p-2"><FieldGroup><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="event-type">Type</FieldLabel><Select items={EVENT_TYPES.map((t) => ({ value: t, label: t.replace("_", " ") }))} value={form.event_type} onValueChange={(value) => setForm((p) => ({ ...p, event_type: value ?? "" }))}><SelectTrigger id="event-type" aria-label="Type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="event-date">Date</FieldLabel><Input id="event-date" type="date" value={form.effective_date} onChange={(e) => setForm((p) => ({ ...p, effective_date: e.target.value }))} /></Field></div><Field><FieldLabel htmlFor="event-title">Title</FieldLabel><Input id="event-title" aria-label="Promoted to Senior" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Promoted to Senior" /></Field><Field><FieldLabel htmlFor="event-detail">Detail</FieldLabel><Textarea id="event-detail" rows={2} value={form.detail} onChange={(e) => setForm((p) => ({ ...p, detail: e.target.value }))} /></Field></FieldGroup><Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add event"}
          </Button></form>
      )}
      {events.length === 0 ? (
        <Muted>No history recorded.</Muted>
      ) : (
        <div className="divide-y divide-border">
          {events.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-2 py-1.5 text-sm">
              <div className="min-w-0">
                <div className="font-medium">
                  <Badge variant="secondary" className="mr-1">{e.event_type.replace("_", " ")}</Badge>
                  {e.title}
                </div>
                <div className="text-xs text-muted-foreground">{e.effective_date}{e.detail ? ` · ${e.detail}` : ""}</div>
              </div>
              {canManage && (
                <Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={() => del(e.id)}><Trash2 /></Button>
              )}
            </div>
          ))}
        </div>
      )}</CardContent>
    </Card>
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
    display_name: profile.name ?? "",
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        job_title: f.job_title || null,
        hr_department: f.hr_department || null,
      };
      // A name is required — only send it when non-empty so we never wipe it.
      if (f.display_name.trim()) body.display_name = f.display_name.trim();
      Object.assign(body, {
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
      });
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

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Edit ${profile.name ?? profile.email}`} onClose={onClose} maxWidth={560}>
      <form onSubmit={save} className="flex flex-col gap-4"><FieldGroup>
        <ProfileInput id="profile-name" label="Full name" value={f.display_name} onChange={(value) => set("display_name", value)} placeholder="e.g. Sana Khan" />
        <div className="grid gap-4 sm:grid-cols-2"><ProfileInput id="profile-title" label="Job title" value={f.job_title} onChange={(value) => set("job_title", value)} placeholder="e.g. CEO" /><ProfileInput id="profile-department" label="Department (label)" value={f.hr_department} onChange={(value) => set("hr_department", value)} /></div>
        <ProfileInput id="profile-office" label="Office location" value={f.office_location} onChange={(value) => set("office_location", value)} />
        <div className="grid gap-4 sm:grid-cols-2"><ProfileInput id="profile-mobile" label="Mobile" value={f.mobile_phone} onChange={(value) => set("mobile_phone", value)} /><ProfileInput id="profile-work-phone" label="Work phone" value={f.business_phone} onChange={(value) => set("business_phone", value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="profile-employment">Employment type</FieldLabel><Select items={[{ value: null, label: "—" }, ...EMPLOYMENT_TYPES.map((type) => ({ value: type, label: type.replace("_", " ") }))]} value={f.employment_type || null} onValueChange={(value) => set("employment_type", value ?? "")}><SelectTrigger id="profile-employment" aria-label="Employment type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>—</SelectItem>{EMPLOYMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{type.replace("_", " ")}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><ProfileInput id="profile-hire-date" label="Hire date" type="date" value={f.hire_date} onChange={(value) => set("hire_date", value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2"><ProfileInput id="profile-probation" label="Probation end" type="date" value={f.probation_end_date} onChange={(value) => set("probation_end_date", value)} /><ProfileInput id="profile-contract" label="Contract end" type="date" value={f.contract_end_date} onChange={(value) => set("contract_end_date", value)} /></div>
        {isAdmin && <Field><FieldLabel htmlFor="profile-manager">Manager</FieldLabel><Select items={[{ value: null, label: "— None —" }, ...(people.data ?? []).filter((person) => person.id !== profile.id).map((person) => ({ value: person.id, label: person.display_name ?? person.email }))]} value={f.manager_id || null} onValueChange={(value) => set("manager_id", value ?? "")}><SelectTrigger id="profile-manager" aria-label="Manager" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>— None —</SelectItem>{(people.data ?? []).filter((person) => person.id !== profile.id).map((person) => <SelectItem key={person.id} value={person.id}>{person.display_name ?? person.email}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>}
        {profile.can_see_sensitive && <><ProfileInput id="profile-personal-email" label="Personal email" value={f.personal_email} onChange={(value) => set("personal_email", value)} /><div className="grid gap-4 sm:grid-cols-3"><ProfileInput id="profile-nationality" label="Nationality" value={f.nationality} onChange={(value) => set("nationality", value)} /><ProfileInput id="profile-passport" label="Passport" value={f.passport_no} onChange={(value) => set("passport_no", value)} /><ProfileInput id="profile-birth" label="Date of birth" type="date" value={f.date_of_birth} onChange={(value) => set("date_of_birth", value)} /></div><div className="grid gap-4 sm:grid-cols-3"><ProfileInput id="profile-emergency" label="Emergency contact" value={f.emergency_contact_name} onChange={(value) => set("emergency_contact_name", value)} /><ProfileInput id="profile-emergency-phone" label="Contact phone" value={f.emergency_contact_phone} onChange={(value) => set("emergency_contact_phone", value)} /><ProfileInput id="profile-relationship" label="Relationship" value={f.emergency_contact_relationship} onChange={(value) => set("emergency_contact_relationship", value)} /></div></>}
        {isAdmin && <div className="grid gap-4 sm:grid-cols-3"><ProfileSelect id="profile-role" label="Role" value={f.role} options={ROLES} onChange={(value) => set("role", value)} /><ProfileSelect id="profile-status" label="Status" value={f.status} options={USER_STATUSES} onChange={(value) => set("status", value)} /><Field><FieldLabel htmlFor="profile-access-department">Access department</FieldLabel><Select items={[{ value: null, label: "Keep current" }, ...(departments.data ?? []).map((department) => ({ value: department.id, label: department.name }))]} value={f.department_id || null} onValueChange={(value) => set("department_id", value ?? "")}><SelectTrigger id="profile-access-department" aria-label="Access department" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Keep current</SelectItem>{(departments.data ?? []).map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></div>}
      </FieldGroup><div className="flex flex-col-reverse justify-end gap-2 sm:flex-row"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</Button></div></form>
    </Modal>
  );
}

function ProfileInput({ id, label, value, onChange, type = "text", placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; type?: React.HTMLInputTypeAttribute; placeholder?: string }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function ProfileSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select items={options.map((option) => ({ value: option, label: option }))} value={value} onValueChange={(nextValue) => onChange(nextValue ?? "")}><SelectTrigger id={id} aria-label={label} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
}

function CustomFieldsSection({ userId }: { userId: string }) {
  const { notify } = useToast();
  const cv = useFetch<CustomValues>(`/api/custom-fields/values/${userId}`);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    setIsSubmitting(true);
    try {
      await api(`/api/custom-fields/values/${userId}`, { method: "PUT", body: { values: draft } });
      setEditing(false);
      cv.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }

  }

  // Group single-value fields by section.
  const bySection: Record<string, typeof data.fields> = {};
  data.fields.forEach((f) => {
    (bySection[f.section] ??= []).push(f);
  });

  return (
    <>
      {data.fields.length > 0 && (
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Sliders /> Additional information</CardTitle>
            {data.can_edit && (
              <CardAction>
                {editing ? (
                  <span className="flex gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button><Button type="button" size="sm" disabled={isSubmitting} onClick={save}>Save</Button>
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={startEdit}>Edit</Button>
                )}
              </CardAction>
            )}
          </CardHeader><CardContent>
          {Object.entries(bySection).map(([section, fields]) => (
            <div key={section} className="mb-2">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{section}</div>
              <div className="flex flex-col gap-1 text-sm">
                {fields.map((f) =>
                  editing ? (
                    <div key={f.def_id} className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center sm:gap-2">
                      <span className="text-muted-foreground">{f.label}</span>
                      <span>{renderInput(f, draft[f.def_id], (v) => setDraft((p) => ({ ...p, [f.def_id]: v })))}</span>
                    </div>
                  ) : (
                    <div key={f.def_id} className="flex justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">{f.label}{f.sensitive && <LockKeyhole aria-label="Sensitive" />}</span>
                      <span className="text-right">{formatValue(f.value) || "—"}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
          </CardContent></Card>
      )}

      {data.tables.map((t) => (
        <CustomTableCard key={t.table_id} userId={userId} table={t} canEdit={data.can_edit} onChange={cv.reload} />
      ))}
    </>
  );
}

function renderInput(f: CustomFieldValue, value: unknown, onChange: (v: unknown) => void) {
  if (f.field_type === "bool")
    return <Checkbox aria-label="Value" checked={!!value} onCheckedChange={(checked) => onChange(Boolean(checked))} />;
  if (f.field_type === "select")
    return (
      <Select items={[{ value: null, label: "—" }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))]} value={String(value ?? "") || null} onValueChange={(nextValue) => onChange(nextValue ?? "")}><SelectTrigger id={`custom-field-${f.def_id}`} aria-label="String Value" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>—</SelectItem>{(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectGroup></SelectContent></Select>
    );
  if (f.field_type === "textarea")
    return <Textarea aria-label="String Value" rows={2} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  const type = f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text";
  return <Input aria-label="type" type={type} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api(`/api/custom-fields/tables/${table.table_id}/rows/${userId}`, { method: "POST", body: { data: row } });
      setRow({});
      setAdding(false);
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }
  async function del(id: string) {
    await api(`/api/custom-fields/rows/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Card className="py-0"><CardHeader className="py-(--card-spacing)"><CardTitle className="flex items-center gap-2">{table.label}{table.sensitive && <LockKeyhole aria-label="Sensitive" />}</CardTitle>
        {canEdit && (
          <CardAction>
          <Button aria-label="Adding" type="button" size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "+ Add"}</Button>
          </CardAction>
        )}
      </CardHeader><CardContent className="p-0">
      {table.rows.length === 0 ? (
        <div className="px-(--card-spacing)"><Muted>No entries.</Muted></div>
      ) : (
        <Table><TableHeader><TableRow>{table.columns.map((c) => <TableHead key={c.key} className="whitespace-normal">{c.label}</TableHead>)}{canEdit && <TableHead><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader><TableBody>
            {table.rows.map((r) => (
              <TableRow key={r.id}>
                {table.columns.map((c) => <TableCell key={c.key} className="max-w-[24rem] whitespace-normal"><span className="block break-words">{formatValue(r.data[c.key])}</span></TableCell>)}
                {canEdit && (
                  <TableCell className="text-right"><Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={() => del(r.id)}><Trash2 /></Button></TableCell>
                )}
              </TableRow>
            ))}
          </TableBody></Table>
      )}
      </CardContent>{adding && (
        <CardFooter><form onSubmit={add} className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))_auto] lg:items-end">
          {table.columns.map((c) => (
            <Field key={c.key}><FieldLabel htmlFor={`custom-${table.table_id}-${c.key}`}>{c.label}</FieldLabel><Input id={`custom-${table.table_id}-${c.key}`} value={row[c.key] ?? ""} onChange={(e) => setRow((p) => ({ ...p, [c.key]: e.target.value }))} /></Field>
          ))}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add"}
          </Button>
        </form></CardFooter>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2 [&_svg]:stroke-[1.5]">{icon} {title}</CardTitle><CardAction><Badge variant="secondary">{count}</Badge></CardAction></CardHeader><CardContent><div className="divide-y divide-border">{children}</div></CardContent></Card>
  );
}

function Item({ label, sub, right }: { label: string; sub?: string | null; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{label}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-sm text-muted-foreground">{children}</p>;
}

interface FieldChangeRow {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  actor_name: string | null;
  created_at: string;
}

function FieldHistorySection({ userId }: { userId: string }) {
  const history = useFetch<FieldChangeRow[]>(`/api/profiles/${userId}/field-history`);
  return (
    <Card className="py-0"><CardHeader className="py-(--card-spacing)"><CardTitle>Change history</CardTitle><CardDescription>Every edit to this profile's fields, with who made it.</CardDescription></CardHeader><CardContent className="p-0">
      {history.loading ? (
        <div className="px-(--card-spacing)"><Loading /></div>
      ) : (history.data?.length ?? 0) === 0 ? (
        <div className="px-(--card-spacing)"><Muted>No changes recorded yet.</Muted></div>
      ) : (
        <Table><TableHeader><TableRow><TableHead>Field</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>By</TableHead><TableHead>When</TableHead></TableRow></TableHeader><TableBody>
            {history.data!.map((h) => (
              <TableRow key={h.id}><TableCell className="font-medium">{h.field.replace(/_/g, " ")}</TableCell><TableCell className="max-w-[20rem] whitespace-normal text-muted-foreground"><span className="break-words">{h.old_value ?? "—"}</span></TableCell><TableCell className="max-w-[20rem] whitespace-normal"><span className="break-words">{h.new_value ?? "—"}</span></TableCell><TableCell className="text-muted-foreground">{h.actor_name ?? "—"}</TableCell><TableCell className="text-muted-foreground">{new Date(h.created_at).toLocaleString()}</TableCell></TableRow>
            ))}
          </TableBody></Table>
      )}
    </CardContent></Card>
  );
}
