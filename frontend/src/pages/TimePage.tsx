import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Coffee,
  Play,
  Plus,
  Settings2,
  Square,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { api } from "../api/client";
import type { TimeBreak, TimeEntry, TimeSummary, Timesheet, WorkSchedule } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function hm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monday(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function parseUtc(isoStr: string): number {
  const hasZone = /Z$|[+-]\d{2}:\d{2}$/.test(isoStr);
  return new Date(hasZone ? isoStr : `${isoStr}Z`).getTime();
}

const STATUS_BADGE: Record<string, "secondary" | "warning" | "success" | "destructive"> = {
  open: "secondary",
  submitted: "warning",
  approved: "success",
  rejected: "destructive",
};

/** Live today work / break / remaining seconds from summary + local clock. */
function useLiveTimeTotals(summary: TimeSummary | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const running = !!(summary?.open_entry || summary?.active_break);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  return useMemo(() => {
    if (!summary) {
      return { workSec: 0, breakSec: 0, remainingSec: 0, displaySec: 0 };
    }

    let workSec = summary.today_completed_work_seconds ?? 0;
    let breakSec = summary.today_completed_break_seconds ?? 0;
    const openBreakDone = summary.open_completed_break_seconds ?? 0;

    if (summary.open_entry?.clock_in) {
      const clockIn = parseUtc(summary.open_entry.clock_in);
      if (summary.active_break?.started_at) {
        const breakStart = parseUtc(summary.active_break.started_at);
        workSec += Math.max(0, Math.floor((breakStart - clockIn) / 1000) - openBreakDone);
        breakSec += Math.max(0, Math.floor((now - breakStart) / 1000));
      } else {
        workSec += Math.max(0, Math.floor((now - clockIn) / 1000) - openBreakDone);
      }
    }

    // Prefer schedule daily expected; fallback ≈ week/5 or 8h.
    const dailyExpectedMin = Math.max(
      60,
      summary.daily_expected_minutes ||
        Math.round((summary.week_expected_minutes || 2400) / 5),
    );
    const remainingSec = Math.max(0, dailyExpectedMin * 60 - workSec);
    const mainSec = summary.active_break
      ? Math.max(0, Math.floor((now - parseUtc(summary.active_break.started_at)) / 1000))
      : workSec;

    return { workSec, breakSec, remainingSec, mainSec };
  }, [summary, now]);
}

export default function TimePage() {
  const { notify } = useToast();
  const { user } = useAuth();
  const canManage = !!user?.is_admin || !!user?.effective_permissions?.includes("hr");
  const [managingSchedules, setManagingSchedules] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const summary = useFetch<TimeSummary>("/api/time/summary");
  const approvals = useFetch<Timesheet[]>("/api/time/approvals");
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => {
    const m = monday(new Date());
    m.setDate(m.getDate() + weekOffset * 7);
    return iso(m);
  }, [weekOffset]);
  const sheet = useFetch<Timesheet>(`/api/time/timesheet?week=${weekStart}`);
  const totals = useLiveTimeTotals(summary.data);

  function reloadAll() {
    summary.reload();
    sheet.reload();
    approvals.reload();
  }

  async function clock() {
    setActionBusy(true);
    try {
      await api("/api/time/clock", { method: "POST" });
      reloadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setActionBusy(false);
    }
  }

  async function toggleBreak() {
    setActionBusy(true);
    try {
      await api("/api/time/break", { method: "POST" });
      reloadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setActionBusy(false);
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
  const onBreak = !!s?.active_break;
  const clockInLabel = s?.open_entry?.clock_in
    ? new Date(parseUtc(s.open_entry.clock_in)).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div>
      <PageHead
        title="Time Tracking"
        subtitle="Clock in, take breaks, and submit your weekly timesheet."
        action={
          canManage ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setManagingSchedules(true)}
            >
              <Settings2 data-icon="inline-start" /> Work schedules
            </Button>
          ) : undefined
        }
      />

      {/* Calamari-style clock hero */}
      <Card className="mb-5">
        <CardContent>
        {summary.loading && !s ? (
          <Loading />
        ) : (
          <div className="flex flex-col items-center gap-6 py-4 sm:py-6">
            {/* Big square actions */}
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              {/* Primary action: start or resume work. */}
              <Button
                type="button"
                variant="default"
                size="icon-lg"
                disabled={actionBusy || (isClockedIn && !onBreak)}
                onClick={() => {
                  if (!isClockedIn) void clock();
                  else if (onBreak) void toggleBreak();
                }}
                aria-label={!isClockedIn ? "Start work" : onBreak ? "Resume work" : "Working"}
                className="size-24 sm:size-28"
              >
                <Play className="fill-current" strokeWidth={1.75} />
              </Button>

              {/* Destructive action: stop or clock out. */}
              <Button
                type="button"
                variant="destructive"
                size="icon-lg"
                disabled={actionBusy || !isClockedIn}
                onClick={() => void clock()}
                aria-label="Stop work"
                className="size-24 sm:size-28"
              >
                <Square className="fill-current" strokeWidth={1.75} />
              </Button>

              {/* Break action is available only while clocked in. */}
              {isClockedIn && (
                <Button
                  type="button"
                  variant="default"
                  size="icon-lg"
                  disabled={actionBusy}
                  onClick={() => void toggleBreak()}
                  aria-label={onBreak ? "End break" : "Start break"}
                  className="size-24 sm:size-28"
                >
                  <Coffee strokeWidth={1.75} />
                </Button>
              )}
            </div>

            {/* Status caption */}
            <div className="text-center">
              <div className="text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
                {hms(onBreak ? totals.breakSec : totals.workSec)}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {!isClockedIn && "Not clocked in — press start to begin"}
                {isClockedIn && !onBreak && (
                  <>
                    Working
                    {clockInLabel ? (
                      <span>
                        {" "}
                        since <span className="font-medium text-foreground">{clockInLabel}</span>
                      </span>
                    ) : null}
                  </>
                )}
                {isClockedIn && onBreak && "On break — press resume to continue"}
              </p>
            </div>

            {/* Day timeline bar — green = work, yellow = break */}
            {s && (
              <DayTimelineBar summary={s} className="w-full max-w-2xl px-1" />
            )}

            {/* Three totals under the bar */}
            <div className="grid w-full max-w-2xl grid-cols-3 gap-2 sm:gap-4">
              <TimeStat
                label="Working time"
                value={hms(totals.workSec)}
                accent="text-success"
              />
              <TimeStat
                label="Break time"
                value={hms(totals.breakSec)}
                accent="text-warning-foreground"
              />
              <TimeStat
                label="Remaining"
                value={hms(totals.remainingSec)}
                accent="text-info"
              />
            </div>

            {/* Compact week strip */}
            <div className="flex w-full max-w-2xl flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t pt-4 text-xs text-muted-foreground sm:text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" /> Week {hm(s?.week_minutes ?? 0)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-3.5" /> Expected {hm(s?.week_expected_minutes ?? 0)}
              </span>
              {(s?.week_overtime_minutes ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 text-warning-foreground">
                  <Zap className="size-3.5" /> OT {hm(s?.week_overtime_minutes ?? 0)}
                </span>
              )}
              <Badge variant={STATUS_BADGE[s?.week_status ?? "open"]}>
                {s?.week_status ?? "open"}
              </Badge>
            </div>
          </div>
        )}
        </CardContent>
      </Card>

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
          onWeekSubmit={submitWeek}
        />
      )}

      {/* Manager approvals */}
      {(approvals.data?.length ?? 0) > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <CheckCircle2 /> Timesheets to approve
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {approvals.data!.map((t) => (
              <ApprovalRow key={t.id} t={t} onDone={reloadAll} />
            ))}
          </CardContent>
        </Card>
      )}

      {managingSchedules && <SchedulesModal onClose={() => setManagingSchedules(false)} />}
    </div>
  );
}

function TimeStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="border bg-muted/40 px-2 py-3 text-center sm:px-4 sm:py-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
        {label}
      </div>
      <div className={`mt-1 text-base font-semibold tabular-nums sm:text-xl ${accent ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function parseTimeMs(isoStr: string): number {
  const direct = Date.parse(isoStr);
  if (!Number.isNaN(direct)) return direct;
  const asUtc = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(isoStr) ? isoStr : `${isoStr}Z`);
  return Number.isNaN(asUtc) ? Date.now() : asUtc;
}

function formatTimeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

type BarPiece = {
  kind: "work" | "break";
  seconds: number;
  startMs: number;
  endMs: number;
};

/**
 * Calamari-style day bar that fills left → right as time elapses.
 * Green = work, yellow = break. Total width = expected day (e.g. 8h).
 */
function DayTimelineBar({
  summary,
  className,
}: {
  summary: TimeSummary;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = !!(summary.open_entry || summary.active_break);

  useEffect(() => {
    // Always tick every second while mounted so the bar visibly grows.
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const dailyExpectedMin = Math.max(60, summary.daily_expected_minutes ?? 480);
  const dailyExpectedSec = dailyExpectedMin * 60;
  const dayStartLabel = formatTimeOfDay(new Date().setHours(8, 0, 0, 0));
  const dayEndLabel = formatTimeOfDay(
    new Date().setHours(8, 0, 0, 0) + dailyExpectedMin * 60_000,
  );

  const { pieces, events, firstClockInMs, late } = useMemo(() => {
    const entries: TimeEntry[] = summary.today_entries?.length
      ? summary.today_entries
      : summary.open_entry
        ? [summary.open_entry]
        : [];
    const breaks: TimeBreak[] = [...(summary.today_breaks ?? [])];
    if (
      summary.active_break &&
      !breaks.some((b) => b.id === summary.active_break!.id)
    ) {
      breaks.push(summary.active_break);
    }

    const piecesOut: BarPiece[] = [];
    const eventRows: { kind: "start" | "break"; label: string; detail: string; t: number }[] =
      [];
    let firstIn: number | null = null;

    // Prefer chronological session segments (work/break) so the bar fills as time passes.
    for (const entry of entries) {
      if (!entry.clock_in) continue;
      const entryStart = parseTimeMs(entry.clock_in);
      const entryEnd = entry.clock_out ? parseTimeMs(entry.clock_out) : now;
      if (firstIn === null || entryStart < firstIn) firstIn = entryStart;

      eventRows.push({
        kind: "start",
        label: "START",
        detail: formatTimeOfDay(entryStart),
        t: entryStart,
      });

      const entryBreaks = breaks
        .filter((b) => String(b.entry_id) === String(entry.id))
        .map((b) => ({
          start: parseTimeMs(b.started_at),
          end: b.ended_at ? parseTimeMs(b.ended_at) : now,
          open: !b.ended_at,
        }))
        .sort((a, b) => a.start - b.start);

      let cursor = entryStart;
      for (const br of entryBreaks) {
        if (br.start > cursor) {
          piecesOut.push({
            kind: "work",
            seconds: Math.max(0, (br.start - cursor) / 1000),
            startMs: cursor,
            endMs: br.start,
          });
        }
        const brEnd = Math.max(br.start, br.end);
        piecesOut.push({
          kind: "break",
          seconds: Math.max(0, (brEnd - br.start) / 1000),
          startMs: br.start,
          endMs: brEnd,
        });
        eventRows.push({
          kind: "break",
          label: "BREAK",
          detail: br.open
            ? `${formatTimeOfDay(br.start)} – now`
            : `${formatTimeOfDay(br.start)} – ${formatTimeOfDay(brEnd)}`,
          t: br.start,
        });
        cursor = Math.max(cursor, brEnd);
      }
      if (entryEnd > cursor) {
        piecesOut.push({
          kind: "work",
          seconds: Math.max(0, (entryEnd - cursor) / 1000),
          startMs: cursor,
          endMs: entryEnd,
        });
      }
    }

    // Fallback when API has no today_entries/breaks but we have open_entry + live totals.
    if (piecesOut.length === 0 && summary.open_entry?.clock_in) {
      const start = parseTimeMs(summary.open_entry.clock_in);
      firstIn = start;
      eventRows.push({
        kind: "start",
        label: "START",
        detail: formatTimeOfDay(start),
        t: start,
      });
      if (summary.active_break?.started_at) {
        const brStart = parseTimeMs(summary.active_break.started_at);
        piecesOut.push({
          kind: "work",
          seconds: Math.max(0, (brStart - start) / 1000),
          startMs: start,
          endMs: brStart,
        });
        piecesOut.push({
          kind: "break",
          seconds: Math.max(0, (now - brStart) / 1000),
          startMs: brStart,
          endMs: now,
        });
        eventRows.push({
          kind: "break",
          label: "BREAK",
          detail: `${formatTimeOfDay(brStart)} – now`,
          t: brStart,
        });
      } else {
        piecesOut.push({
          kind: "work",
          seconds: Math.max(0, (now - start) / 1000),
          startMs: start,
          endMs: now,
        });
      }
    }

    eventRows.sort((a, b) => a.t - b.t);

    // 8:00 AM local today for late detection
    const eightAm = new Date();
    eightAm.setHours(8, 0, 0, 0);
    const isLate = firstIn != null && firstIn > eightAm.getTime() + 60_000;

    return {
      pieces: piecesOut.filter((p) => p.seconds > 0.05),
      events: eventRows.map(({ kind, label, detail }) => ({ kind, label, detail })),
      firstClockInMs: firstIn,
      late: isLate,
    };
  }, [summary, now]);

  const filledSec = pieces.reduce((a, p) => a + p.seconds, 0);
  // Cap visual fill at 100% of expected day; allow slight overfill clamp
  const scale = dailyExpectedSec;

  return (
    <div className={className}>
      <div className="relative pt-5 pb-1">
        {/* Clock-in / Late marker above the leading edge of the fill */}
        {firstClockInMs != null && filledSec > 0 && (
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium">
            <span className="text-muted-foreground">{formatTimeOfDay(firstClockInMs)}</span>
            {late && (
              <span className="inline-flex items-center gap-0.5 text-destructive">
                <TriangleAlert aria-hidden="true" /> Late
              </span>
            )}
            {running && (
              <span className="text-muted-foreground">
                · now {formatTimeOfDay(now)}
              </span>
            )}
          </div>
        )}

        {/* Track — fills left → right as time elapses */}
        <div
          className="relative flex h-4 w-full overflow-hidden bg-muted ring-1 ring-border/60"
          role="img"
          aria-label="Day progress: green is work, yellow is break"
        >
          {pieces.map((p, i) => {
            const pct = Math.min(100, (p.seconds / scale) * 100);
            if (pct <= 0) return null;
            return (
              <div
                key={`${p.kind}-${p.startMs}-${i}`}
                className={[
                  "h-full shrink-0 transition-[width] duration-1000 ease-linear",
                  p.kind === "work" ? "bg-success" : "bg-primary",
                ].join(" ")}
                style={{ width: `${pct}%` }}
                title={`${p.kind}: ${hms(p.seconds)}`}
              />
            );
          })}
          {/* Soft edge at the live fill tip */}
          {running && filledSec > 0 && filledSec < scale && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-foreground/50"
              style={{ left: `${Math.min(100, (filledSec / scale) * 100)}%` }}
            />
          )}
        </div>

        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{dayStartLabel}</span>
          <span className="tabular-nums">
            {hms(filledSec)} / {hms(dailyExpectedSec)}
          </span>
          <span>{dayEndLabel}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 bg-success" /> Work
        </span>
        <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 bg-primary" /> Break
        </span>
      </div>

      {events.length > 0 && (
        <div className="mx-auto mt-4 flex w-full max-w-md flex-col gap-2">
          {events.map((ev, i) => (
            <div key={`${ev.kind}-${i}`} className="flex items-center gap-3 text-sm">
              <span
                className={[
                  "inline-flex size-7 shrink-0 items-center justify-center",
                  ev.kind === "start" ? "bg-success text-background" : "bg-primary text-primary-foreground",
                ].join(" ")}
              >
                {ev.kind === "start" ? (
                  <Play className="size-3.5 fill-current" />
                ) : (
                  <Coffee className="size-3.5" />
                )}
              </span>
              <span className="w-14 shrink-0 font-semibold uppercase tracking-wide text-muted-foreground">
                {ev.label}
              </span>
              <span className="tabular-nums text-foreground">{ev.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SchedulesModal({ onClose }: { onClose: () => void }) {
  const { notify } = useToast();
  const schedules = useFetch<WorkSchedule[]>("/api/time/schedules");
  const [form, setForm] = useState({
    name: "",
    daily_hours: "8",
    workdays: [0, 1, 2, 3, 4],
    is_default: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
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
        <Empty icon={<CalendarClock />} message="No schedules yet" hint="Add a work pattern below." />
      ) : (
        <div className="divide-y">
          {schedules.data!.map((sc) => (
            <div key={sc.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="flex-1 font-medium">
                {sc.name} {sc.is_default && <Badge variant="success">default</Badge>}
              </span>
              <span className="text-muted-foreground">
                {(sc.daily_minutes / 60).toFixed(2).replace(/\.00$/, "")}h/day ·{" "}
                {sc.workdays.map((d) => DOW[d]).join(" ")}
              </span>
              <span className="text-xs text-muted-foreground">{sc.assigned_count} assigned</span>
              {!sc.is_default && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => patch(sc.id, { is_default: true })}
                >
                  Make default
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                size="icon-sm"
                aria-label={`Delete schedule ${sc.name}`}
                onClick={() => remove(sc.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="mt-3 border p-3">
        <FieldGroup>
          <FieldGroup className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <Field>
            <FieldLabel htmlFor="schedule-name">Name</FieldLabel>
            <Input
              id="schedule-name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Standard 40h"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="schedule-hours">Hours/day</FieldLabel>
            <Input
              id="schedule-hours"
              type="number"
              step="0.25"
              value={form.daily_hours}
              onChange={(e) => setForm((p) => ({ ...p, daily_hours: e.target.value }))}
            />
          </Field>
          </FieldGroup>
        <Field>
          <FieldLabel>Workdays</FieldLabel>
        <ToggleGroup
          className="flex-wrap"
          multiple
          value={form.workdays.map(String)}
          onValueChange={(value) => setForm((p) => ({ ...p, workdays: value.map(Number).sort() }))}
          variant="outline"
          size="sm"
          aria-label="Workdays"
        >
          {DOW.map((d, i) => (
            <ToggleGroupItem
              key={d}
              value={String(i)}
            >
              {d}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            checked={form.is_default}
            onCheckedChange={(checked) => setForm((p) => ({ ...p, is_default: checked === true }))}
            id="schedule-default"
          />
          <FieldLabel htmlFor="schedule-default">Use as the default schedule</FieldLabel>
        </Field>
        <Button
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Adding…" : "Add schedule"}
        </Button>
        </FieldGroup>
      </form>
    </Modal>
  );
}

function WeekSheet({
  sheet,
  weekStart,
  onPrev,
  onNext,
  onToday,
  onChange,
  onWeekSubmit,
}: {
  sheet: Timesheet;
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onChange: () => void;
  onWeekSubmit: () => void;
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
      await api("/api/time/entries", {
        method: "POST",
        body: { work_date: day, minutes: mins, note: note || null },
      });
      setAddDay(null);
      setHours("");
      setNote("");
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
    <Card>
      <CardHeader className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <CardTitle className="inline-flex items-center gap-2">
          Week of {weekStart}
          <Badge variant={STATUS_BADGE[sheet.status]}>{sheet.status}</Badge>
        </CardTitle>
        <div className="inline-flex items-center gap-2">
          <Button type="button" variant="outline" size="icon-sm" onClick={onPrev} aria-label="Previous week">
            ‹
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onToday}>
            This week
          </Button>
          <Button type="button" variant="outline" size="icon-sm" onClick={onNext} aria-label="Next week">
            ›
          </Button>
        </div>
      </CardHeader>

      <CardContent className="divide-y">
        {days.map((day) => {
          const entries = byDay[day] ?? [];
          const total = entries.reduce((a, e) => a + e.minutes, 0);
          const dow = new Date(day + "T00:00:00").toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
          return (
            <div key={day} className="py-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{dow}</span>
                <span className="text-sm text-muted-foreground">{total ? hm(total) : "—"}</span>
              </div>
              {entries.map((e) => (
                <div
                  key={e.id}
                  className="mt-1 flex items-center justify-between bg-muted/40 px-2 py-1 text-sm"
                >
                  <span>
                    {hm(e.minutes)}
                    <span className="text-muted-foreground">
                      {" "}
                      · {e.source === "clock" ? "clocked" : "manual"}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                  </span>
                  {!locked && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      aria-label="Delete time entry"
                      onClick={() => del(e.id)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              {!locked &&
                (addDay === day ? (
                  <FieldGroup className="mt-2 grid gap-2 sm:grid-cols-[5rem_1fr_auto_auto] sm:items-end">
                    <Field>
                      <FieldLabel htmlFor="time-entry-hours">Hours</FieldLabel>
                      <Input
                        id="time-entry-hours"
                        type="number"
                        step="0.25"
                        value={hours}
                        onChange={(e) => setHours(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="time-entry-note">Note</FieldLabel>
                      <Input
                        id="time-entry-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </Field>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => addEntry(day)}
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setAddDay(null)}
                      aria-label="Cancel adding time"
                    >
                      ×
                    </Button>
                  </FieldGroup>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    onClick={() => {
                      setAddDay(day);
                      setHours("");
                      setNote("");
                    }}
                  >
                    <Plus data-icon="inline-start" /> Add time
                  </Button>
                ))}
            </div>
          );
        })}
      </CardContent>

      <CardFooter className="flex flex-wrap justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold">Total: {hm(sheet.total_minutes)}</span>
        <span className="text-muted-foreground">Expected: {hm(sheet.expected_minutes)}</span>
        {sheet.overtime_minutes > 0 && (
          <span className="text-warning-foreground">Overtime: {hm(sheet.overtime_minutes)}</span>
        )}
        {sheet.leave_days > 0 && (
          <Badge variant="info">
            On leave: {sheet.leave_days} day{sheet.leave_days === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
        {!locked ? (
          <Button
            type="button"
            onClick={onWeekSubmit}
          >
            Submit for approval
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">
            {sheet.status === "approved" ? "Approved" : "Submitted — awaiting approval"}
          </span>
        )}
      </CardFooter>
    </Card>
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
        <span className="text-muted-foreground">
          {" "}
          · week of {t.week_start} · {hm(t.total_minutes)}
        </span>
      </span>
      <span className="flex gap-1">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => decide("rejected")}
        >
          Reject
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => decide("approved")}
        >
          Approve
        </Button>
      </span>
    </div>
  );
}
