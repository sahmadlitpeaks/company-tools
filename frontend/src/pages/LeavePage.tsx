import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { CalendarOff, CalendarPlus, Download, PartyPopper, Plane, Plus, Settings2, Trash2 } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { Holiday, LeaveBalance, LeaveType, WhosOutItem } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Loading, Modal, PageHead, useToast } from "../components/ui";
import { numericInput } from "../utils/numbers";

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
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <Button type="button" variant="outline"
              onClick={() => downloadFile("/api/leave/calendar.ics", "leave.ics").catch(() => notify("Download failed", "error"))}
            >
              <Download data-icon="inline-start" /> Calendar (iCal)
            </Button>
            {isAdmin && (
              <Button type="button" variant="outline" onClick={() => setManagingTypes(true)}><Settings2 data-icon="inline-start" /> Leave types</Button>
            )}
            <Button type="button" onClick={() => setRequesting(true)}><Plane data-icon="inline-start" /> Request leave</Button>
          </div>
        }
      />

      {/* Per-type balance cards */}
      <div className="mb-5 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        {!b ? (
          <Loading />
        ) : (
          b.by_type.map((t) => (
            <Card key={t.leave_type_id}><CardContent>
              <div className="flex items-center gap-2">
                <span className="size-2.5" style={{ background: t.color }} />
                <span className="font-semibold">{t.name}</span>
                {!t.paid && <Badge variant="secondary">unpaid</Badge>}
              </div>
              <div className="mt-2 flex items-end gap-1">
                <span className="text-2xl font-bold text-primary">{t.remaining_days}</span>
                <span className="mb-0.5 text-sm text-muted-foreground">/ {t.entitlement_days} left</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t.used_days} taken{t.pending_days ? ` · ${t.pending_days} pending` : ""}
              </div>
            </CardContent></Card>
          ))
        )}
      </div>

      <div className="mb-5">
        <LeaveCalendar whosOut={out.data ?? []} holidays={holidays.data ?? []} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="py-0"><CardHeader className="py-(--card-spacing)"><CardTitle className="inline-flex items-center gap-2"><CalendarOff /> Who's out</CardTitle></CardHeader>
          {out.loading ? (
            <CardContent><Loading /></CardContent>
          ) : (out.data?.length ?? 0) === 0 ? (
            <CardContent><p className="inline-flex items-center gap-2 text-muted-foreground"><PartyPopper aria-hidden="true" /> Everyone's in.</p></CardContent>
          ) : (
            <CardContent className="p-0"><Table><TableBody>
                {out.data!.map((o) => (
                  <TableRow key={JSON.stringify(o)}>
                    <TableCell className="font-semibold">{o.user_name ?? "—"}</TableCell>
                    <TableCell>
                      {o.leave_type_name && (
                        <Badge variant="secondary" style={{ background: o.color ? `${o.color}22` : undefined }}>
                          {o.leave_type_name}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.start_date}
                      {o.end_date && o.end_date !== o.start_date ? ` → ${o.end_date}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody></Table></CardContent>
          )}
        </Card>

        <HolidayCalendar holidays={holidays} isAdmin={isAdmin} onChange={() => { holidays.reload(); balance.reload(); }} />
      </div>

      {team.data && (
        <Card className="mt-4 py-0"><CardHeader className="py-(--card-spacing)"><CardTitle>Team balances (annual)</CardTitle></CardHeader><CardContent className="p-0"><Table>
            <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead className="text-right">Entitlement</TableHead><TableHead className="text-right">Used</TableHead><TableHead className="text-right">Left</TableHead></TableRow></TableHeader><TableBody>
              {team.data.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="font-semibold">{m.user_name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {user?.is_admin ? (
                      <Input aria-label="Numeric value"
                        type="number"
                        defaultValue={m.entitlement_days}
                        className="w-16"
                        onBlur={(e) => {
                          const v = numericInput(e.target.value, m.entitlement_days);
                          if (v !== m.entitlement_days) setEntitlement(m, v);
                        }}
                      />
                    ) : (
                      m.entitlement_days
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.used_days}</TableCell>
                  <TableCell className="text-right tabular-nums"><Badge variant={m.remaining_days <= 0 ? "destructive" : "success"}>{m.remaining_days}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody></Table></CardContent></Card>
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
    half_day: false,
    title: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedType = types.find((t) => t.id === f.leave_type_id);
  const singleDay = !!f.start_date && (!f.end_date || f.end_date === f.start_date);
  const canHalfDay = singleDay && (selectedType?.allow_half_day ?? true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.start_date) return;
    setIsSubmitting(true);
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
          half_day: canHalfDay && f.half_day,
        },
      });
      onDone();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Request leave" onClose={onClose} maxWidth={480}>
      <form onSubmit={submit} className="flex flex-col gap-4"><FieldGroup>
        <Field><FieldLabel htmlFor="leave-type">Leave type</FieldLabel>
          <Select items={[{ value: null, label: "Select leave type…" }, ...types.map((t) => ({ value: t.id, label: `${t.name}${t.paid ? "" : " (unpaid)"}` }))]} value={f.leave_type_id || null} onValueChange={(value) => setF((p) => ({ ...p, leave_type_id: value ?? "" }))}>
            <SelectTrigger id="leave-type" aria-label="Leave type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Select leave type…</SelectItem>
            {types.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}{t.paid ? "" : " (unpaid)"}</SelectItem>
            ))}
            </SelectGroup></SelectContent>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="leave-from">From</FieldLabel><Input id="leave-from" type="date" value={f.start_date} onChange={(e) => setF((p) => ({ ...p, start_date: e.target.value }))} required /></Field>
          <Field><FieldLabel htmlFor="leave-to">To</FieldLabel><Input id="leave-to" type="date" value={f.end_date} onChange={(e) => setF((p) => ({ ...p, end_date: e.target.value }))} /></Field>
        </div>
        {canHalfDay && (
          <Field orientation="horizontal"><Checkbox id="leave-half-day" checked={f.half_day} onCheckedChange={(checked) => setF((p) => ({ ...p, half_day: Boolean(checked) }))} /><FieldLabel htmlFor="leave-half-day">Take as a half day (½)</FieldLabel></Field>
        )}
        <Field><FieldLabel htmlFor="leave-note">Note (optional)</FieldLabel><Input id="leave-note" aria-label="Reason / details" value={f.title} onChange={(e) => setF((p) => ({ ...p, title: e.target.value }))} placeholder="Reason / details" /></Field>
        </FieldGroup><div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting…" : "Submit"}</Button>
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!day || !name.trim()) return;
    setIsSubmitting(true);
    try {
      await api("/api/leave/holidays", { method: "POST", body: { day, name: name.trim() } });
      setDay("");
      setName("");
      holidays.reload();
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
    }
  }
  async function del(id: string) {
    await api(`/api/leave/holidays/${id}`, { method: "DELETE" });
    holidays.reload();
    onChange();
  }

  const upcoming = (holidays.data ?? []).filter((h) => h.day >= new Date().toISOString().slice(0, 10));

  return (
    <Card><CardHeader><CardTitle className="inline-flex items-center gap-2"><CalendarPlus /> Public holidays</CardTitle></CardHeader><CardContent>
      {holidays.loading ? (
        <Loading />
      ) : (
        <div className="divide-y divide-border">
          {(upcoming.length ? upcoming : holidays.data ?? []).slice(0, 8).map((h) => (
          <div key={h.id} className="flex items-start justify-between gap-2 py-2 text-sm sm:items-center">
              <span className="min-w-0"><span className="font-medium">{h.name}</span> <span className="text-muted-foreground">· {h.day}</span></span>
              {isAdmin && (
                <Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={() => del(h.id)}><Trash2 /></Button>
              )}
            </div>
          ))}
          {(holidays.data?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No holidays set.</p>}
        </div>
      )}
      {isAdmin && (
        <form onSubmit={add} className="mt-2 grid items-end gap-4 sm:grid-cols-[1fr_2fr_auto]"><Field><FieldLabel htmlFor="holiday-date">Date</FieldLabel><Input id="holiday-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field><Field><FieldLabel htmlFor="holiday-name">Name</FieldLabel><Input id="holiday-name" aria-label="National Day" value={name} onChange={(e) => setName(e.target.value)} placeholder="National Day" /></Field><Button type="submit" variant="outline" disabled={isSubmitting}><Plus data-icon="inline-start" /> {isSubmitting ? "Adding…" : "Add"}</Button></form>
      )}
    </CardContent></Card>
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
  const [form, setForm] = useState({ name: "", default_days: 0, carryover_max: 0, accrual_period: "annual", paid: true, color: "#737373" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setIsSubmitting(true);
    try {
      await api("/api/leave/types", { method: "POST", body: form });
      setForm({ name: "", default_days: 0, carryover_max: 0, accrual_period: "annual", paid: true, color: "#737373" });
      onChange();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setIsSubmitting(false);
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
      <div className="divide-y divide-border">
        {types.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className="size-3 flex-none" style={{ background: t.color }} />
            <span className="flex-1 font-medium">{t.name}{t.paid ? "" : " (unpaid)"}</span>
            <FieldLabel htmlFor={`leave-days-${t.id}`} className="text-xs text-muted-foreground">Days</FieldLabel>
            <Input id={`leave-days-${t.id}`}
              type="number"
              defaultValue={t.default_days}
              className="w-14"
              title="Default annual days"
              onBlur={(e) => { const v = numericInput(e.target.value, t.default_days); if (v !== t.default_days) patch(t.id, { default_days: v }); }}
            />
            <FieldLabel htmlFor={`leave-carryover-${t.id}`} className="text-xs text-muted-foreground">Carryover</FieldLabel>
            <Input id={`leave-carryover-${t.id}`}
              type="number"
              defaultValue={t.carryover_max}
              className="w-14"
              title="Max days carried to next year"
              onBlur={(e) => { const v = numericInput(e.target.value, t.carryover_max); if (v !== t.carryover_max) patch(t.id, { carryover_max: v }); }}
            />
            <Select items={[{ value: "annual", label: "Annual" }, { value: "monthly", label: "Monthly" }]} value={t.accrual_period} onValueChange={(value) => value !== null && patch(t.id, { accrual_period: value })}>
              <SelectTrigger id={`leave-accrual-${t.id}`} aria-label="Accrual schedule" className="w-full" title="Accrual schedule"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="annual">Annual</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectGroup></SelectContent>
            </Select>
            <Button aria-label="Delete" type="button" size="icon-sm" variant="destructive" onClick={() => remove(t.id)}><Trash2 /></Button>
          </div>
        ))}
      </div>
      <form onSubmit={add} className="mt-4 flex flex-col gap-4 border border-border p-3 sm:p-4"><FieldGroup><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="leave-type-name">Name</FieldLabel><Input id="leave-type-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field><Field><FieldLabel htmlFor="leave-default-days">Default days</FieldLabel><Input id="leave-default-days" type="number" value={form.default_days} onChange={(e) => setForm((p) => ({ ...p, default_days: numericInput(e.target.value, p.default_days) }))} /></Field><Field><FieldLabel htmlFor="leave-carryover">Carryover</FieldLabel><Input id="leave-carryover" type="number" value={form.carryover_max} onChange={(e) => setForm((p) => ({ ...p, carryover_max: numericInput(e.target.value, p.carryover_max) }))} /></Field><Field><FieldLabel htmlFor="leave-color">Color</FieldLabel><Input id="leave-color" type="color" value={form.color} onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))} /></Field></div>
        <Field><FieldLabel htmlFor="leave-accrual">Accrual</FieldLabel><Select items={[{ value: "annual", label: "Annual (full upfront)" }, { value: "monthly", label: "Monthly (1/12 per month)" }]} value={form.accrual_period} onValueChange={(value) => setForm((p) => ({ ...p, accrual_period: value ?? "" }))}><SelectTrigger id="leave-accrual" aria-label="Accrual" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="annual">Annual (full upfront)</SelectItem><SelectItem value="monthly">Monthly (1/12 per month)</SelectItem></SelectGroup></SelectContent></Select></Field>
        <Field orientation="horizontal"><Checkbox id="leave-paid" checked={form.paid} onCheckedChange={(checked) => setForm((p) => ({ ...p, paid: Boolean(checked) }))} /><FieldLabel htmlFor="leave-paid">Paid leave</FieldLabel></Field></FieldGroup>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding…" : "Add type"}
        </Button>
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
  const cells: { id: string; day: number | null }[] = [
    ...Array.from({ length: firstDow }, (_, index) => ({
      id: `leading-${year}-${month}-${index}`,
      day: null,
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => ({
      id: iso(new Date(year, month, index + 1)),
      day: index + 1,
    })),
  ];
  while (cells.length % 7 !== 0) {
    cells.push({ id: `trailing-${year}-${month}-${cells.length}`, day: null });
  }
  const todayKey = iso(new Date());

  return (
    <Card><CardHeader>
        <CardTitle className="inline-flex items-center gap-2"><CalendarOff /> Team calendar</CardTitle>
        <CardAction className="col-start-1 row-span-1 row-start-2 flex flex-wrap items-center gap-2 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
          <Button type="button" size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => setOffset((o) => o - 1)}>‹</Button>
          <span className="min-w-[150px] text-center text-sm font-semibold">{monthLabel}</span>
          <Button type="button" size="icon-sm" variant="outline" aria-label="Next month" onClick={() => setOffset((o) => o + 1)}>›</Button>
          {offset !== 0 && <Button type="button" size="sm" variant="outline" onClick={() => setOffset(0)}>Today</Button>}
        </CardAction>
      </CardHeader><CardContent className="overflow-x-auto">
      <div className="grid min-w-[42rem] grid-cols-7 gap-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="pb-1 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
        {cells.map(({ id, day }, i) => {
          if (day === null) return <div key={id} />;
          const key = iso(new Date(year, month, day));
          const holiday = holByDay.get(key);
          const people = outByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const weekend = (i % 7) >= 5;
          return (
            <div
              key={id}
              className={`min-h-[78px] border p-1.5 ${isToday ? "border-primary" : "border-border"} ${holiday ? "bg-primary/10" : weekend ? "bg-muted" : "bg-card"}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>{day}</span>
              </div>
              {holiday && <div className="flex items-center gap-1 truncate text-[10px] font-medium text-primary" title={holiday}><PartyPopper aria-hidden="true" /> {holiday}</div>}
              <div className="mt-1 flex flex-wrap gap-0.5">
                {people.slice(0, 4).map((p, j) => (
                  <Avatar
                    key={j}
                    title={p.name}
                    className="size-5"
                  >
                    <AvatarFallback className="text-[9px] font-semibold text-primary-foreground" style={{ background: p.color || "var(--primary)" }}>
                      {initials(p.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {people.length > 4 && <span className="text-[10px] text-muted-foreground">+{people.length - 4}</span>}
              </div>
            </div>
          );
        })}
      </div></CardContent>
    </Card>
  );
}
