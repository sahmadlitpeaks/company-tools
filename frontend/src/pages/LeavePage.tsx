import { useState } from "react";
import { CalendarOff, CalendarPlus, Plane, Plus, Settings2, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Holiday, LeaveBalance, LeaveType, WhosOutItem } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Loading, Modal, PageHead, useToast } from "../components/ui";

export default function LeavePage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const isAdmin = !!user?.is_admin;
  const balance = useFetch<LeaveBalance>("/api/leave/balance");
  const out = useFetch<WhosOutItem[]>("/api/leave/whos-out?days=150");
  const types = useFetch<LeaveType[]>("/api/leave/types");
  const holidays = useFetch<Holiday[]>("/api/leave/holidays");
  const team = useFetch<LeaveBalance[]>(
    user?.is_admin || user?.role === "manager" ? "/api/leave/balances" : null,
  );
  const [requesting, setRequesting] = useState(false);
  const [managingTypes, setManagingTypes] = useState(false);

  async function setEntitlement(b: LeaveBalance, value: number) {
    await api(`/api/leave/balances/${b.user_id}`, {
      method: "PUT",
      body: { entitlement_days: value },
    });
    notify("Entitlement updated.");
    team.reload();
    balance.reload();
  }

  const b = balance.data;

  return (
    <div>
      <PageHead
        title="Leave"
        subtitle="Balances by type, the holiday calendar, and who's off across the team."
        action={
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            {isAdmin && (
              <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setManagingTypes(true)}>
                <Settings2 size={15} /> Leave types
              </button>
            )}
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setRequesting(true)}>
              <Plane size={15} /> Request leave
            </button>
          </div>
        }
      />

      {/* Per-type balance cards */}
      <div className="grid mb-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {!b ? (
          <Loading />
        ) : (
          b.by_type.map((t) => (
            <div key={t.leave_type_id} className="card">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                <span className="font-semibold">{t.name}</span>
                {!t.paid && <span className="badge">unpaid</span>}
              </div>
              <div className="mt-2 flex items-end gap-1">
                <span className="text-2xl font-bold" style={{ color: "var(--brand-600)" }}>{t.remaining_days}</span>
                <span className="muted mb-0.5 text-sm">/ {t.entitlement_days} left</span>
              </div>
              <div className="muted mt-1 text-xs">
                {t.used_days} taken{t.pending_days ? ` · ${t.pending_days} pending` : ""}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mb-5">
        <LeaveCalendar whosOut={out.data ?? []} holidays={holidays.data ?? []} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3 className="mt-0 inline-flex items-center gap-2">
            <CalendarOff size={18} className="text-brand-600" /> Who's out
          </h3>
          {out.loading ? (
            <Loading />
          ) : (out.data?.length ?? 0) === 0 ? (
            <p className="muted">Everyone's in. 🎉</p>
          ) : (
            <table>
              <tbody>
                {out.data!.map((o, i) => (
                  <tr key={i}>
                    <td className="font-semibold">{o.user_name ?? "—"}</td>
                    <td>
                      {o.leave_type_name && (
                        <span className="badge" style={{ background: o.color ? `${o.color}22` : undefined }}>
                          {o.leave_type_name}
                        </span>
                      )}
                    </td>
                    <td className="muted text-sm">
                      {o.start_date}
                      {o.end_date && o.end_date !== o.start_date ? ` → ${o.end_date}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <HolidayCalendar holidays={holidays} isAdmin={isAdmin} onChange={() => { holidays.reload(); balance.reload(); }} />
      </div>

      {team.data && (
        <div className="card mt-4">
          <h3 className="mt-0">Team balances (annual)</h3>
          <table>
            <thead>
              <tr><th>Employee</th><th>Entitlement</th><th>Used</th><th>Left</th></tr>
            </thead>
            <tbody>
              {team.data.map((m) => (
                <tr key={m.user_id}>
                  <td className="font-semibold">{m.user_name}</td>
                  <td>
                    {user?.is_admin ? (
                      <input
                        type="number"
                        defaultValue={m.entitlement_days}
                        className="!w-16 !py-1 text-sm"
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (v !== m.entitlement_days) setEntitlement(m, v);
                        }}
                      />
                    ) : (
                      m.entitlement_days
                    )}
                  </td>
                  <td>{m.used_days}</td>
                  <td>
                    <span className={`badge ${m.remaining_days <= 0 ? "red" : "green"}`}>{m.remaining_days}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requesting && (
        <RequestLeaveModal
          types={types.data ?? []}
          onClose={() => setRequesting(false)}
          onDone={() => { setRequesting(false); balance.reload(); notify("Leave request submitted for approval."); }}
        />
      )}
      {managingTypes && (
        <LeaveTypesModal types={types.data ?? []} onClose={() => setManagingTypes(false)} onChange={() => { types.reload(); balance.reload(); }} />
      )}
    </div>
  );
}

function RequestLeaveModal({
  types,
  onClose,
  onDone,
}: {
  types: LeaveType[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify } = useToast();
  const [f, setF] = useState({
    leave_type_id: types[0]?.id ?? "",
    start_date: "",
    end_date: "",
    title: "",
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.start_date) return;
    setBusy(true);
    try {
      const type = types.find((t) => t.id === f.leave_type_id);
      await api("/api/approvals", {
        method: "POST",
        body: {
          type: "leave",
          leave_type_id: f.leave_type_id || null,
          title: f.title.trim() || `${type?.name ?? "Leave"} request`,
          start_date: f.start_date,
          end_date: f.end_date || f.start_date,
        },
      });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="Request leave" onClose={onClose} maxWidth={480}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Leave type</label>
          <select value={f.leave_type_id} onChange={(e) => setF((p) => ({ ...p, leave_type_id: e.target.value }))}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.paid ? "" : " (unpaid)"}</option>
            ))}
          </select>
        </div>
        <div className="row">
          <div className="field"><label>From</label><input type="date" value={f.start_date} onChange={(e) => setF((p) => ({ ...p, start_date: e.target.value }))} required /></div>
          <div className="field"><label>To</label><input type="date" value={f.end_date} onChange={(e) => setF((p) => ({ ...p, end_date: e.target.value }))} /></div>
        </div>
        <div className="field"><label>Note (optional)</label><input value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} placeholder="Reason / details" /></div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>{busy ? "Submitting…" : "Submit"}</button>
        </div>
      </form>
    </Modal>
  );
}

function HolidayCalendar({
  holidays,
  isAdmin,
  onChange,
}: {
  holidays: ReturnType<typeof useFetch<Holiday[]>>;
  isAdmin: boolean;
  onChange: () => void;
}) {
  const { notify } = useToast();
  const [day, setDay] = useState("");
  const [name, setName] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!day || !name.trim()) return;
    try {
      await api("/api/leave/holidays", { method: "POST", body: { day, name: name.trim() } });
      setDay("");
      setName("");
      holidays.reload();
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(id: string) {
    await api(`/api/leave/holidays/${id}`, { method: "DELETE" });
    holidays.reload();
    onChange();
  }

  const upcoming = (holidays.data ?? []).filter((h) => h.day >= new Date().toISOString().slice(0, 10));

  return (
    <div className="card">
      <h3 className="mt-0 inline-flex items-center gap-2">
        <CalendarPlus size={18} className="text-brand-600" /> Public holidays
      </h3>
      {holidays.loading ? (
        <Loading />
      ) : (
        <div className="divide-y divide-slate-100">
          {(upcoming.length ? upcoming : holidays.data ?? []).slice(0, 8).map((h) => (
            <div key={h.id} className="flex items-center justify-between py-1.5 text-sm">
              <span><span className="font-medium">{h.name}</span> <span className="muted">· {h.day}</span></span>
              {isAdmin && (
                <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(h.id)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {(holidays.data?.length ?? 0) === 0 && <p className="muted text-sm">No holidays set.</p>}
        </div>
      )}
      {isAdmin && (
        <form onSubmit={add} className="row mt-2" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0 }}><label>Date</label><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0, flex: 2 }}><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="National Day" /></div>
          <button className="btn inline-flex items-center gap-1" style={{ flex: "0 0 auto" }}><Plus size={14} /> Add</button>
        </form>
      )}
    </div>
  );
}

function LeaveTypesModal({
  types,
  onClose,
  onChange,
}: {
  types: LeaveType[];
  onClose: () => void;
  onChange: () => void;
}) {
  const { notify } = useToast();
  const [form, setForm] = useState({ name: "", default_days: 0, paid: true, color: "#6366f1" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await api("/api/leave/types", { method: "POST", body: form });
      setForm({ name: "", default_days: 0, paid: true, color: "#6366f1" });
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/api/leave/types/${id}`, { method: "PATCH", body });
    onChange();
  }
  async function remove(id: string) {
    await api(`/api/leave/types/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <Modal title="Leave types" onClose={onClose} maxWidth={560}>
      <div className="divide-y divide-slate-100">
        {types.map((t) => (
          <div key={t.id} className="flex items-center gap-2 py-2 text-sm">
            <span className="h-3 w-3 flex-none rounded-full" style={{ background: t.color }} />
            <span className="flex-1 font-medium">{t.name}{t.paid ? "" : " (unpaid)"}</span>
            <label className="muted text-xs">Default days</label>
            <input
              type="number"
              defaultValue={t.default_days}
              className="!w-16 !py-1"
              onBlur={(e) => { const v = Number(e.target.value); if (v !== t.default_days) patch(t.id, { default_days: v }); }}
            />
            <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => remove(t.id)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={add} className="mt-3 rounded-lg border border-slate-200 p-2">
        <div className="row">
          <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
          <div className="field" style={{ maxWidth: 110 }}><label>Default days</label><input type="number" value={form.default_days} onChange={(e) => setForm((p) => ({ ...p, default_days: Number(e.target.value) }))} /></div>
          <div className="field" style={{ maxWidth: 70 }}><label>Color</label><input type="color" value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="!w-auto" checked={form.paid} onChange={(e) => setForm((p) => ({ ...p, paid: e.target.checked }))} /> Paid leave
        </label>
        <button className="btn-primary mt-2" style={{ flex: "0 0 auto" }}>Add type</button>
      </form>
    </Modal>
  );
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function initials(name?: string | null): string {
  const s = (name || "?").trim().split(/\s+/);
  return (s.length >= 2 ? s[0][0] + s[1][0] : (name || "?").slice(0, 2)).toUpperCase();
}

function LeaveCalendar({ whosOut, holidays }: { whosOut: WhosOutItem[]; holidays: Holiday[] }) {
  const [offset, setOffset] = useState(0);
  const base = new Date();
  const view = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const monthLabel = view.toLocaleString(undefined, { month: "long", year: "numeric" });

  // Holiday + leave lookups keyed by ISO day.
  const holByDay = new Map<string, string>();
  for (const h of holidays) holByDay.set(h.day, h.name);

  const outByDay = new Map<string, { name: string; color?: string | null }[]>();
  for (const o of whosOut) {
    if (!o.start_date) continue;
    const start = new Date(o.start_date + "T00:00:00");
    const end = new Date((o.end_date ?? o.start_date) + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() === year && d.getMonth() === month) {
        const key = iso(d);
        const arr = outByDay.get(key) ?? [];
        arr.push({ name: o.user_name ?? "—", color: o.color });
        outByDay.set(key, arr);
      }
    }
  }

  // Build the grid: lead with blanks so the 1st lands on the right weekday (Mon start).
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = Monday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const todayKey = iso(new Date());

  return (
    <div className="card">
      <div className="spread mb-3">
        <h3 className="m-0 inline-flex items-center gap-2"><CalendarOff size={18} className="text-brand-600" /> Team calendar</h3>
        <div className="inline-flex items-center gap-2">
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setOffset((o) => o - 1)}>‹</button>
          <span className="min-w-[150px] text-center text-sm font-semibold">{monthLabel}</span>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setOffset((o) => o + 1)}>›</button>
          {offset !== 0 && <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setOffset(0)}>Today</button>}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="muted pb-1 text-center text-xs font-medium">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const key = iso(new Date(year, month, day));
          const holiday = holByDay.get(key);
          const people = outByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const weekend = (i % 7) >= 5;
          return (
            <div
              key={i}
              className="min-h-[78px] rounded-lg border p-1.5"
              style={{
                borderColor: isToday ? "var(--brand-400)" : "var(--border)",
                background: holiday ? "var(--brand-50)" : weekend ? "var(--surface-2)" : "var(--surface)",
              }}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs ${isToday ? "font-bold text-brand-700" : "muted"}`}>{day}</span>
              </div>
              {holiday && <div className="truncate text-[10px] font-medium text-brand-700" title={holiday}>🎉 {holiday}</div>}
              <div className="mt-1 flex flex-wrap gap-0.5">
                {people.slice(0, 4).map((p, j) => (
                  <span
                    key={j}
                    title={p.name}
                    className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold text-white"
                    style={{ background: p.color || "#64748b" }}
                  >
                    {initials(p.name)}
                  </span>
                ))}
                {people.length > 4 && <span className="muted text-[10px]">+{people.length - 4}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
