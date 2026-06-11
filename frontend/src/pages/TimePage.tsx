import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Clock, Play, Plus, Settings2, Square, Trash2, Zap } from "lucide-react";
import { api } from "../api/client";
import type { TimeEntry, Timesheet, TimeSummary, WorkSchedule } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function hm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monday(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

const STATUS_BADGE: Record<string, string> = {
  open: "", submitted: "amber", approved: "green", rejected: "red",
};

export default function TimePage() {
  const { notify } = useToast();
  const { user } = useAuth();
  const canManage = !!user?.is_admin || !!user?.effective_permissions?.includes("hr");
  const [managingSchedules, setManagingSchedules] = useState(false);
  const summary = useFetch<TimeSummary>("/api/time/summary");
  const approvals = useFetch<Timesheet[]>("/api/time/approvals");
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => {
    const m = monday(new Date());
    m.setDate(m.getDate() + weekOffset * 7);
    return iso(m);
  }, [weekOffset]);
  const sheet = useFetch<Timesheet>(`/api/time/timesheet?week=${weekStart}`);

  function reloadAll() {
    summary.reload();
    sheet.reload();
    approvals.reload();
  }

  async function clock() {
    try {
      await api("/api/time/clock", { method: "POST" });
      reloadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function submitWeek() {
    try {
      await api(`/api/time/timesheet/submit?week=${weekStart}`, { method: "POST" });
      notify("Timesheet submitted.");
      reloadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  const s = summary.data;
  const isClockedIn = !!s?.open_entry;

  return (
    <div>
      <PageHead
        title="Time Tracking"
        subtitle="Clock in/out, log time and submit your weekly timesheet."
        action={
          canManage ? (
            <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setManagingSchedules(true)}>
              <Settings2 size={15} /> Work schedules
            </button>
          ) : undefined
        }
      />

      {/* Clock + summary */}
      <div className="grid mb-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <div className="card flex flex-col items-center justify-center text-center">
          <button
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-base font-semibold text-white ${isClockedIn ? "bg-rose-500 hover:bg-rose-600" : "bg-brand-600 hover:bg-brand-700"}`}
            onClick={clock}
          >
            {isClockedIn ? <Square size={18} /> : <Play size={18} />}
            {isClockedIn ? "Clock out" : "Clock in"}
          </button>
          {isClockedIn && <div className="muted mt-2 text-xs">Clocked in — running…</div>}
        </div>
        <Stat icon={<Clock size={16} />} label="Today" value={hm(s?.today_minutes ?? 0)} />
        <Stat icon={<Clock size={16} />} label="This week" value={hm(s?.week_minutes ?? 0)} />
        <Stat icon={<CalendarClock size={16} />} label="Expected" value={hm(s?.week_expected_minutes ?? 0)} />
        <Stat icon={<Zap size={16} />} label="Overtime" value={<span className={(s?.week_overtime_minutes ?? 0) > 0 ? "text-amber-600" : ""}>{hm(s?.week_overtime_minutes ?? 0)}</span>} />
        <Stat label="Week status" value={<span className={`badge ${STATUS_BADGE[s?.week_status ?? "open"]}`}>{s?.week_status ?? "open"}</span>} />
      </div>

      {/* Weekly timesheet */}
      {sheet.loading || !sheet.data ? (
        <Loading />
      ) : (
        <WeekSheet
          sheet={sheet.data}
          weekStart={weekStart}
          onPrev={() => setWeekOffset((o) => o - 1)}
          onNext={() => setWeekOffset((o) => o + 1)}
          onToday={() => setWeekOffset(0)}
          onChange={reloadAll}
          onSubmit={submitWeek}
        />
      )}

      {/* Manager approvals */}
      {(approvals.data?.length ?? 0) > 0 && (
        <div className="card mt-4">
          <h3 className="mt-0 inline-flex items-center gap-2"><CheckCircle2 size={18} className="text-brand-600" /> Timesheets to approve</h3>
          <div className="divide-y divide-slate-100">
            {approvals.data!.map((t) => (
              <ApprovalRow key={t.id} t={t} onDone={reloadAll} />
            ))}
          </div>
        </div>
      )}

      {managingSchedules && <SchedulesModal onClose={() => setManagingSchedules(false)} />}
    </div>
  );
}

function SchedulesModal({ onClose }: { onClose: () => void }) {
  const { notify } = useToast();
  const schedules = useFetch<WorkSchedule[]>("/api/time/schedules");
  const [form, setForm] = useState({ name: "", daily_hours: "8", workdays: [0, 1, 2, 3, 4], is_default: false });

  function toggleDay(d: number) {
    setForm((p) => ({
      ...p,
      workdays: p.workdays.includes(d) ? p.workdays.filter((x) => x !== d) : [...p.workdays, d].sort(),
    }));
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await api("/api/time/schedules", {
        method: "POST",
        body: {
          name: form.name.trim(),
          daily_minutes: Math.round(parseFloat(form.daily_hours) * 60),
          workdays: form.workdays,
          is_default: form.is_default,
        },
      });
      setForm({ name: "", daily_hours: "8", workdays: [0, 1, 2, 3, 4], is_default: false });
      schedules.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function patch(id: string, body: Record<string, unknown>) {
    await api(`/api/time/schedules/${id}`, { method: "PATCH", body });
    schedules.reload();
  }
  async function remove(id: string) {
    await api(`/api/time/schedules/${id}`, { method: "DELETE" });
    schedules.reload();
  }

  return (
    <Modal title="Work schedules" onClose={onClose} maxWidth={560}>
      {schedules.loading ? (
        <Loading />
      ) : (schedules.data?.length ?? 0) === 0 ? (
        <Empty icon="🗓" message="No schedules yet" hint="Add a work pattern below." />
      ) : (
        <div className="divide-y divide-slate-100">
          {schedules.data!.map((sc) => (
            <div key={sc.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="flex-1 font-medium">
                {sc.name} {sc.is_default && <span className="badge green">default</span>}
              </span>
              <span className="muted">{(sc.daily_minutes / 60).toFixed(2).replace(/\.00$/, "")}h/day · {sc.workdays.map((d) => DOW[d]).join(" ")}</span>
              <span className="muted text-xs">{sc.assigned_count} assigned</span>
              {!sc.is_default && (
                <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => patch(sc.id, { is_default: true })}>Make default</button>
              )}
              <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => remove(sc.id)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="mt-3 rounded-lg border border-slate-200 p-2">
        <div className="row">
          <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Standard 40h" /></div>
          <div className="field" style={{ maxWidth: 110 }}><label>Hours/day</label><input type="number" step="0.25" value={form.daily_hours} onChange={(e) => setForm((p) => ({ ...p, daily_hours: e.target.value }))} /></div>
        </div>
        <label className="muted text-xs">Workdays</label>
        <div className="mt-1 flex flex-wrap gap-1">
          {DOW.map((d, i) => (
            <button type="button" key={d} className={form.workdays.includes(i) ? "btn-sm btn-primary" : "btn-sm"} style={{ flex: "0 0 auto" }} onClick={() => toggleDay(i)}>{d}</button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="!w-auto" checked={form.is_default} onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))} /> Use as the default schedule
        </label>
        <button className="btn-primary mt-2" style={{ flex: "0 0 auto" }}>Add schedule</button>
      </form>
    </Modal>
  );
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="card">
      <div className="muted flex items-center gap-1.5 text-xs">{icon} {label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function WeekSheet({
  sheet, weekStart, onPrev, onNext, onToday, onChange, onSubmit,
}: {
  sheet: Timesheet;
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onChange: () => void;
  onSubmit: () => void;
}) {
  const { notify } = useToast();
  const locked = sheet.status === "submitted" || sheet.status === "approved";
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + "T00:00:00");
    d.setDate(d.getDate() + i);
    return iso(d);
  });
  const byDay: Record<string, TimeEntry[]> = {};
  for (const e of sheet.entries) (byDay[e.work_date] ??= []).push(e);
  const [addDay, setAddDay] = useState<string | null>(null);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");

  async function addEntry(day: string) {
    const mins = Math.round(parseFloat(hours) * 60);
    if (!mins || mins <= 0) return;
    try {
      await api("/api/time/entries", { method: "POST", body: { work_date: day, minutes: mins, note: note || null } });
      setAddDay(null); setHours(""); setNote("");
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  async function del(id: string) {
    await api(`/api/time/entries/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="card">
      <div className="spread mb-3">
        <h3 className="m-0 inline-flex items-center gap-2">
          Week of {weekStart}
          <span className={`badge ${STATUS_BADGE[sheet.status]}`}>{sheet.status}</span>
        </h3>
        <div className="inline-flex items-center gap-2">
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={onPrev}>‹</button>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={onToday}>This week</button>
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={onNext}>›</button>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {days.map((day) => {
          const entries = byDay[day] ?? [];
          const total = entries.reduce((a, e) => a + e.minutes, 0);
          const dow = new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
          return (
            <div key={day} className="py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{dow}</span>
                <span className="muted text-sm">{total ? hm(total) : "—"}</span>
              </div>
              {entries.map((e) => (
                <div key={e.id} className="mt-1 flex items-center justify-between rounded-lg px-2 py-1 text-sm" style={{ background: "var(--surface-2)" }}>
                  <span>
                    {hm(e.minutes)}
                    <span className="muted"> · {e.source === "clock" ? "clocked" : "manual"}{e.note ? ` · ${e.note}` : ""}</span>
                  </span>
                  {!locked && (
                    <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(e.id)}><Trash2 size={12} /></button>
                  )}
                </div>
              ))}
              {!locked && (
                addDay === day ? (
                  <div className="mt-1 flex flex-wrap items-end gap-1">
                    <div className="field" style={{ marginBottom: 0, maxWidth: 90 }}><label>Hours</label><input type="number" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
                    <div className="field" style={{ marginBottom: 0, flex: 1 }}><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} /></div>
                    <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={() => addEntry(day)}>Add</button>
                    <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setAddDay(null)}>×</button>
                  </div>
                ) : (
                  <button className="btn-sm mt-1 inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => { setAddDay(day); setHours(""); setNote(""); }}>
                    <Plus size={12} /> Add time
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold">Total: {hm(sheet.total_minutes)}</span>
        <span className="muted">Expected: {hm(sheet.expected_minutes)}</span>
        {sheet.overtime_minutes > 0 && <span className="text-amber-600">Overtime: {hm(sheet.overtime_minutes)}</span>}
        {sheet.leave_days > 0 && <span className="badge blue">On leave: {sheet.leave_days} day{sheet.leave_days === 1 ? "" : "s"}</span>}
      </div>
      <div className="spread mt-2">
        <span />
        {!locked ? (
          <button className="btn-primary" style={{ flex: "0 0 auto" }} onClick={onSubmit}>Submit for approval</button>
        ) : (
          <span className="muted text-sm">{sheet.status === "approved" ? "Approved ✓" : "Submitted — awaiting approval"}</span>
        )}
      </div>
    </div>
  );
}

function ApprovalRow({ t, onDone }: { t: Timesheet; onDone: () => void }) {
  const { notify } = useToast();
  async function decide(status: string) {
    try {
      await api(`/api/time/timesheet/${t.id}/decision`, { method: "POST", body: { status } });
      notify(`Timesheet ${status}.`);
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span>
        <span className="font-medium">{t.user_name}</span>
        <span className="muted"> · week of {t.week_start} · {hm(t.total_minutes)}</span>
      </span>
      <span className="flex gap-1">
        <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => decide("rejected")}>Reject</button>
        <button className="btn-sm btn-primary" style={{ flex: "0 0 auto" }} onClick={() => decide("approved")}>Approve</button>
      </span>
    </div>
  );
}
