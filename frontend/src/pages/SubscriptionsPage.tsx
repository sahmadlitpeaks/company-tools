import { useMemo, useState } from "react";
import { CalendarClock, Plus, Trash2, UserMinus, Wallet } from "lucide-react";
import { api } from "../api/client";
import type { Department, Subscription, SubscriptionSummary, User } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const STATUSES = ["active", "trial", "paused", "cancelled", "expired"];
const CYCLES = ["monthly", "quarterly", "annual", "weekly", "one_time"];
const STATUS_BADGE: Record<string, string> = {
  active: "green",
  trial: "blue",
  paused: "amber",
  cancelled: "red",
  expired: "red",
};

function money(v?: string | null, ccy = "USD") {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return `${ccy} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CYCLE_LABEL: Record<string, string> = {
  monthly: "/mo",
  quarterly: "/qtr",
  annual: "/yr",
  weekly: "/wk",
  one_time: " once",
};

export default function SubscriptionsPage() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    return p.toString();
  }, [status, q]);
  const subs = useFetch<Subscription[]>(`/api/subscriptions${qs ? `?${qs}` : ""}`);
  const summary = useFetch<SubscriptionSummary>("/api/subscriptions/summary");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function reloadAll() {
    subs.reload();
    summary.reload();
  }

  const s = summary.data;
  return (
    <div>
      <PageHead
        title="Subscriptions"
        subtitle="SaaS & tools the company pays for — billing, renewals and who holds a seat."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setAdding(true)}>
            <Plus size={15} /> New subscription
          </button>
        }
      />

      {s && (
        <div className="grid mb-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
          <Metric icon={<Wallet size={16} />} label="Subscriptions" value={s.total} />
          <Metric icon={<Wallet size={16} />} label="Monthly spend" value={money(s.monthly_spend)} />
          <Metric icon={<CalendarClock size={16} />} label="Renewing ≤30d" value={s.renewing_soon} />
          <Metric label="Active" value={s.by_status.active ?? 0} />
        </div>
      )}

      <div className="card mb-4">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 3 }}>
            <label>Search</label>
            <input placeholder="Name or vendor…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {subs.loading ? (
          <Loading />
        ) : (subs.data?.length ?? 0) === 0 ? (
          <Empty message="No subscriptions yet." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Subscription</th>
                <th>Assignment</th>
                <th>Billing</th>
                <th>Seats</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subs.data!.map((sub) => (
                <tr key={sub.id} className="cursor-pointer" onClick={() => setOpenId(sub.id)}>
                  <td>
                    <div className="font-semibold">{sub.name}</div>
                    {sub.vendor && <div className="muted text-xs">{sub.vendor}</div>}
                  </td>
                  <td>
                    <span className="badge">{sub.scope}</span>
                    {sub.scope === "department" && sub.department_name && (
                      <span className="muted text-xs"> · {sub.department_name}</span>
                    )}
                  </td>
                  <td>
                    {money(sub.monthly_cost, sub.currency)}
                    <span className="muted text-xs">/mo</span>
                    {sub.cost != null && (
                      <div className="muted text-xs">
                        {money(sub.cost, sub.currency)}
                        {CYCLE_LABEL[sub.billing_cycle] ?? ""}
                        {sub.cost_type === "per_seat" ? " / seat" : ""}
                      </div>
                    )}
                  </td>
                  <td>{sub.scope === "person" ? sub.active_seats : "—"}</td>
                  <td><span className={`badge ${STATUS_BADGE[sub.status] ?? ""}`}>{sub.status}</span></td>
                  <td className="text-right font-medium text-brand-600">Open ›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <SubscriptionModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reloadAll(); }} />
      )}
      {openId && (
        <SubscriptionDetail id={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} />
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="card">
      <div className="muted flex items-center gap-1.5 text-xs">{icon} {label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

type FormState = Partial<Subscription> & { user_ids?: string[] };

function SubscriptionModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Subscription;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const departments = useFetch<Department[]>("/api/departments");
  const users = useFetch<User[]>("/api/users");
  const [f, setF] = useState<FormState>(
    initial ?? {
      name: "",
      scope: "person",
      cost_type: "flat",
      currency: "USD",
      billing_cycle: "monthly",
      status: "active",
      auto_renew: true,
      user_ids: [],
    },
  );
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormState, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: (f.name ?? "").trim(),
        vendor: f.vendor || null,
        plan: f.plan || null,
        url: f.url || null,
        status: f.status,
        scope: f.scope,
        department_id: f.scope === "department" ? f.department_id || null : null,
        cost_type: f.cost_type,
        cost: f.cost === "" ? null : f.cost ?? null,
        currency: f.currency || "USD",
        billing_cycle: f.billing_cycle,
        start_date: f.start_date || null,
        end_date: f.end_date || null,
        auto_renew: f.auto_renew ?? true,
        owner_id: f.owner_id || null,
        notes: f.notes || null,
      };
      if (initial) {
        await api(`/api/subscriptions/${initial.id}`, { method: "PATCH", body });
      } else {
        await api("/api/subscriptions", { method: "POST", body: { ...body, user_ids: f.user_ids ?? [] } });
      }
      notify(initial ? "Subscription updated." : "Subscription created.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? `Edit ${initial.name}` : "New subscription"} onClose={onClose} maxWidth={620}>
      <form onSubmit={save}>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label>Name *</label>
            <input required value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="ChatGPT Team" />
          </div>
          <div className="field">
            <label>Vendor</label>
            <input value={f.vendor ?? ""} onChange={(e) => set("vendor", e.target.value)} placeholder="OpenAI" />
          </div>
        </div>
        <div className="row">
          <div className="field"><label>Plan</label><input value={f.plan ?? ""} onChange={(e) => set("plan", e.target.value)} /></div>
          <div className="field"><label>Login URL</label><input value={f.url ?? ""} onChange={(e) => set("url", e.target.value)} /></div>
        </div>

        <div className="row">
          <div className="field">
            <label>Assignment</label>
            <select value={f.scope} onChange={(e) => set("scope", e.target.value)}>
              <option value="company">Company-wide</option>
              <option value="department">Department</option>
              <option value="person">Specific people (seats)</option>
            </select>
          </div>
          {f.scope === "department" && (
            <div className="field">
              <label>Department</label>
              <select value={f.department_id ?? ""} onChange={(e) => set("department_id", e.target.value)}>
                <option value="">Select…</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Status</label>
            <select value={f.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Cost type</label>
            <select value={f.cost_type} onChange={(e) => set("cost_type", e.target.value)}>
              <option value="flat">Flat total</option>
              <option value="per_seat">Per seat</option>
            </select>
          </div>
          <div className="field">
            <label>{f.cost_type === "per_seat" ? "Cost / seat" : "Cost"}</label>
            <input type="number" step="0.01" value={f.cost ?? ""} onChange={(e) => set("cost", e.target.value)} />
          </div>
          <div className="field" style={{ maxWidth: 90 }}>
            <label>Currency</label>
            <input value={f.currency ?? "USD"} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
          </div>
          <div className="field">
            <label>Billing</label>
            <select value={f.billing_cycle} onChange={(e) => set("billing_cycle", e.target.value)}>
              {CYCLES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
            </select>
          </div>
        </div>

        <div className="row">
          <div className="field"><label>Start date</label><input type="date" value={f.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} /></div>
          <div className="field"><label>End / renewal date</label><input type="date" value={f.end_date ?? ""} onChange={(e) => set("end_date", e.target.value)} /></div>
          <div className="field">
            <label>Owner</label>
            <select value={f.owner_id ?? ""} onChange={(e) => set("owner_id", e.target.value)}>
              <option value="">—</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.display_name ?? u.email}</option>
              ))}
            </select>
          </div>
        </div>

        {!initial && f.scope === "person" && (
          <SeatPicker
            users={users.data ?? []}
            selected={f.user_ids ?? []}
            onChange={(ids) => set("user_ids", ids)}
          />
        )}

        <div className="field"><label>Notes</label><textarea rows={2} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></div>

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SeatPicker({
  users,
  selected,
  onChange,
}: {
  users: User[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = users.filter((u) =>
    (u.display_name ?? u.email ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }
  return (
    <div className="field">
      <label>Assign people ({selected.length})</label>
      <input placeholder="Search staff…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-slate-200">
        {filtered.slice(0, 60).map((u) => (
          <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-slate-50">
            <input type="checkbox" className="!w-auto" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
            <span>{u.display_name ?? u.email}</span>
            {u.job_title && <span className="muted text-xs">· {u.job_title}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

function SubscriptionDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const sub = useFetch<Subscription>(`/api/subscriptions/${id}`);
  const users = useFetch<User[]>("/api/users");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const data = sub.data;

  async function revokeSeat(seatId: string) {
    await api(`/api/subscriptions/seats/${seatId}/revoke`, { method: "POST" });
    notify("Seat revoked.");
    sub.reload();
    onChanged();
  }
  async function removeSeat(seatId: string) {
    await api(`/api/subscriptions/seats/${seatId}`, { method: "DELETE" });
    sub.reload();
    onChanged();
  }
  async function remove() {
    if (!data || !confirm(`Delete subscription “${data.name}”?`)) return;
    await api(`/api/subscriptions/${id}`, { method: "DELETE" });
    notify("Subscription deleted.");
    onChanged();
    onClose();
  }

  if (editing && data) {
    return (
      <SubscriptionModal
        initial={data}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); sub.reload(); onChanged(); }}
      />
    );
  }

  return (
    <Modal title={data?.name ?? "Subscription"} onClose={onClose} maxWidth={620}>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={`badge ${STATUS_BADGE[data.status] ?? ""}`}>{data.status}</span>
            <span className="badge">{data.scope}</span>
            {data.vendor && <span className="badge">{data.vendor}</span>}
            <span className="muted text-sm">
              {money(data.monthly_cost, data.currency)}/mo
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            {data.plan && <Field label="Plan" value={data.plan} />}
            <Field label="Billing" value={`${money(data.cost, data.currency)}${CYCLE_LABEL[data.billing_cycle] ?? ""}${data.cost_type === "per_seat" ? " / seat" : ""}`} />
            {data.start_date && <Field label="Start" value={data.start_date} />}
            {data.end_date && <Field label="End / renewal" value={data.end_date} />}
            {data.owner_name && <Field label="Owner" value={data.owner_name} />}
            {data.department_name && <Field label="Department" value={data.department_name} />}
          </div>
          {data.url && (
            <a href={data.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-brand-600">
              Open login ↗
            </a>
          )}
          {data.notes && <p className="muted mt-2 text-sm">{data.notes}</p>}

          {data.scope === "person" && (
            <div className="mt-4">
              <div className="spread mb-1">
                <h4 className="m-0">Seats ({data.active_seats} active)</h4>
                <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAdding((v) => !v)}>
                  {adding ? "Done" : "+ Add people"}
                </button>
              </div>
              {adding && (
                <AddSeats
                  users={users.data ?? []}
                  existing={data.seats.map((s) => s.user_id)}
                  onAdd={async (ids) => {
                    await api(`/api/subscriptions/${id}/seats`, { method: "POST", body: { user_ids: ids } });
                    sub.reload();
                    onChanged();
                  }}
                />
              )}
              <div className="mt-2 divide-y divide-slate-100">
                {data.seats.length === 0 && <p className="muted text-sm">No one assigned yet.</p>}
                {data.seats.map((seat) => (
                  <div key={seat.id} className="flex items-center justify-between py-1.5 text-sm">
                    <div>
                      {seat.user_name}
                      {seat.user_title && <span className="muted text-xs"> · {seat.user_title}</span>}
                      {seat.status === "revoked" && <span className="badge red ml-2">revoked</span>}
                    </div>
                    <div className="flex gap-1">
                      {seat.status === "active" && (
                        <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => revokeSeat(seat.id)}>
                          <UserMinus size={13} /> Revoke
                        </button>
                      )}
                      <button className="btn-sm btn-danger inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => removeSeat(seat.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="row mt-4" style={{ justifyContent: "space-between" }}>
            <button className="btn btn-danger" style={{ flex: "0 0 auto" }} onClick={remove}>Delete</button>
            <button className="btn-primary" style={{ flex: "0 0 auto" }} onClick={() => setEditing(true)}>Edit</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function AddSeats({ users, existing, onAdd }: { users: User[]; existing: string[]; onAdd: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <SeatPicker
        users={users.filter((u) => !existing.includes(u.id))}
        selected={sel}
        onChange={setSel}
      />
      <button
        className="btn-primary mt-1"
        style={{ flex: "0 0 auto" }}
        disabled={!sel.length}
        onClick={() => { onAdd(sel); setSel([]); }}
      >
        Add {sel.length || ""}
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="muted text-xs">{label}</div>
      <div>{value}</div>
    </div>
  );
}
