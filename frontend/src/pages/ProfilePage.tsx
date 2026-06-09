import { useParams, Link } from "react-router-dom";
import {
  Boxes,
  CheckSquare,
  KeyRound,
  ListChecks,
  Smartphone,
  UserRound,
  Wallet,
} from "lucide-react";
import type { Profile } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead } from "../components/ui";

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
  const { data: p, loading, error } = useFetch<Profile>(path);

  if (loading) return <Loading />;
  if (error || !p)
    return <Empty message={error ? "You don't have access to this profile." : "Not found."} />;

  return (
    <div>
      <PageHead title={p.name ?? p.email ?? "Profile"} subtitle={p.job_title ?? undefined} />

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
            <Row label="Office" value={p.office_location} />
            <Row label="Mobile" value={p.mobile_phone} />
            <Row label="Work phone" value={p.business_phone} />
            {p.can_see_sensitive && (
              <>
                <Row label="Personal email" value={p.personal_email} />
                <Row label="Nationality" value={p.nationality} />
                <Row label="Passport" value={p.passport_no} />
              </>
            )}
          </div>

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
        </div>
      </div>
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
