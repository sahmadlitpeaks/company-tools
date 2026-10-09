import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { addDays, differenceInCalendarDays, eachMonthOfInterval, format, max as maxDate, min as minDate, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { BOARD_TYPES, ISSUE_STATUSES, labelOf, type IssueStatus, type PmIssue, type PmLinkRow, type PmSprint } from "@/api/pm";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { IssueTypeIcon } from "./IssueBits";

export type Zoom = "weeks" | "months" | "quarters";
const DAY_WIDTH: Record<Zoom, number> = { weeks: 28, months: 8, quarters: 3 };
const ROW = 36;
const HEADER = 44;

export type TimeScale = { start: Date; days: number; dayWidth: number; x: (day: Date) => number; width: number };

/** A day scale covering every date given, padded and aligned to Mondays. */
export function buildScale(dates: Date[], zoom: Zoom): TimeScale {
  const today = new Date();
  const known = dates.length ? dates : [today];
  const first = startOfWeek(addDays(minDate([...known, today]), -7), { weekStartsOn: 1 });
  const last = addDays(maxDate([...known, today]), zoom === "weeks" ? 21 : 45);
  const days = Math.max(differenceInCalendarDays(last, first) + 1, zoom === "weeks" ? 56 : 120);
  const dayWidth = DAY_WIDTH[zoom];
  return { start: first, days, dayWidth, width: days * dayWidth, x: (day) => differenceInCalendarDays(day, first) * dayWidth };
}

/** Month labels with week (or month) ticks, plus an optional band row. */
export function TimeAxis({ scale, zoom, bands }: { scale: TimeScale; zoom: Zoom; bands?: ReactNode }) {
  const end = addDays(scale.start, scale.days - 1);
  const months = eachMonthOfInterval({ start: scale.start, end });
  const weeks = zoom === "weeks" ? Array.from({ length: Math.ceil(scale.days / 7) }, (_, i) => addDays(scale.start, i * 7)) : [];
  return <div className="relative border-b border-border" style={{ width: scale.width, height: HEADER + (bands ? 22 : 0) }} aria-hidden="true">
    {months.map((month, index) => {
      const left = Math.max(0, scale.x(startOfMonth(month)));
      const right = index + 1 < months.length ? scale.x(months[index + 1]) : scale.width;
      // Each label stays inside its own month so neighbours never overlap.
      return <div key={month.toISOString()} className="absolute top-0 h-full truncate border-l border-border pl-1 text-xs font-medium text-muted-foreground" style={{ left, width: Math.max(0, right - left) }}>
        {format(month, zoom === "weeks" ? "MMMM yyyy" : "MMM yy")}
      </div>;
    })}
    {weeks.map((week) => <div key={week.toISOString()} className="absolute top-5 border-l border-border/60 pl-1 text-[11px] text-muted-foreground tabular-nums" style={{ left: scale.x(week) }}>{format(week, "d")}</div>)}
    {bands && <div className="absolute inset-x-0 bottom-0 h-[22px]">{bands}</div>}
  </div>;
}

/** Vertical gridlines and the today marker, behind the bars. */
export function TimeGrid({ scale, height, zoom }: { scale: TimeScale; height: number; zoom: Zoom }) {
  const step = zoom === "weeks" ? 7 : zoom === "months" ? 7 : 30;
  const lines = Array.from({ length: Math.ceil(scale.days / step) }, (_, i) => i * step);
  const today = scale.x(new Date());
  return <div className="pointer-events-none absolute inset-0" aria-hidden="true">
    {lines.map((day) => <div key={day} className="absolute top-0 border-l border-border/50" style={{ left: day * scale.dayWidth, height }} />)}
    <div className="absolute top-0 border-l-2 border-primary" style={{ left: today + scale.dayWidth / 2, height }} />
  </div>;
}

// Hover keeps the status colour (the Button's own hover would turn it grey).
const STATUS_BAR: Record<IssueStatus, string> = {
  todo: "bg-muted-foreground/45 hover:bg-muted-foreground/55",
  in_progress: "bg-chart-2 hover:bg-chart-2/90",
  in_review: "bg-chart-4 hover:bg-chart-4/90",
  done: "bg-success hover:bg-success/90",
};

function StatusLegend({ extra }: { extra?: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
    <span className="inline-flex items-center gap-1.5"><span className="inline-flex h-2.5 w-4 bg-chart-1" aria-hidden="true"><span className="w-2 bg-chart-4/70" /></span>Epic, filled as its issues finish</span>
    {ISSUE_STATUSES.map((status) => <span key={status.value} className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-2.5 w-4", STATUS_BAR[status.value])} aria-hidden="true" />{status.label}</span>)}
    <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 border-l-2 border-primary" aria-hidden="true" />Today</span>
    {extra}
  </div>;
}

type Span = { start: Date; end: Date; derived: boolean } | null;
type Row = { issue: PmIssue; depth: number; span: Span; expandable: boolean };
type Drag = { id: string; mode: "move" | "start" | "end"; originX: number; start: Date; end: Date; moved: boolean };

function ownSpan(issue: PmIssue): Span {
  const start = issue.start_date ?? issue.due_date;
  const end = issue.due_date ?? issue.start_date;
  return start && end ? { start: parseISO(start), end: parseISO(end), derived: false } : null;
}

/** Jira-style timeline: epics with their issues, dates as bars, dependencies as arrows. */
export function Timeline({ issues, links, sprints, editable, onOpen, onReschedule }: {
  issues: PmIssue[];
  links: PmLinkRow[];
  sprints: PmSprint[];
  editable: boolean;
  /** Omit (with editable false) for a static, read-only timeline. */
  onOpen?: (key: string) => void;
  onReschedule?: (issue: PmIssue, start: string, due: string) => void;
}) {
  const [zoom, setZoom] = useState<Zoom>("weeks");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const { rows, unscheduled } = useMemo(() => {
    const ordered = [...issues].sort((a, b) => a.rank - b.rank || a.number - b.number);
    const epics = ordered.filter((issue) => issue.issue_type === "epic");
    const planned = ordered.filter((issue) => BOARD_TYPES.includes(issue.issue_type));
    const result: Row[] = [];
    for (const epic of epics) {
      const children = planned.filter((issue) => issue.parent_id === epic.id);
      const childSpans = children.map(ownSpan).filter((span): span is NonNullable<Span> => span !== null);
      const span = ownSpan(epic) ?? (childSpans.length
        ? { start: minDate(childSpans.map((s) => s.start)), end: maxDate(childSpans.map((s) => s.end)), derived: true }
        : null);
      result.push({ issue: epic, depth: 0, span, expandable: children.length > 0 });
      if (!collapsed.has(epic.id)) for (const child of children) result.push({ issue: child, depth: 1, span: ownSpan(child), expandable: false });
    }
    const loose = planned.filter((issue) => !issue.parent_id || !epics.some((epic) => epic.id === issue.parent_id));
    for (const issue of loose) if (ownSpan(issue)) result.push({ issue, depth: 0, span: ownSpan(issue), expandable: false });
    return { rows: result, unscheduled: loose.filter((issue) => !ownSpan(issue)).length };
  }, [issues, collapsed]);

  const scale = useMemo(() => buildScale([
    ...rows.flatMap((row) => row.span ? [row.span.start, row.span.end] : []),
    ...sprints.flatMap((s) => [s.start_date, s.end_date]).filter((d): d is string => Boolean(d)).map((d) => parseISO(d)),
  ], zoom), [rows, sprints, zoom]);

  // Open on today (a week of context to its left) rather than the range start.
  const todayX = scale.x(new Date());
  const hasRows = rows.length > 0;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 7 * scale.dayWidth);
  }, [todayX, scale.dayWidth, hasRows]);

  const spanOf = (row: Row): Span => drag && drag.id === row.issue.id ? { start: drag.start, end: drag.end, derived: false } : row.span;
  const indexOf = new Map(rows.map((row, i) => [row.issue.id, i]));
  const bodyHeight = rows.length * ROW;

  function begin(event: PointerEvent, row: Row, mode: Drag["mode"]) {
    if (!editable || !row.span || row.span.derived || event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const next = { id: row.issue.id, mode, originX: event.clientX, start: row.span.start, end: row.span.end, moved: false };
    dragRef.current = next;
    setDrag(next);
  }
  function move(event: PointerEvent, row: Row) {
    const current = dragRef.current;
    if (!current || current.id !== row.issue.id || !row.span) return;
    const delta = Math.round((event.clientX - current.originX) / scale.dayWidth);
    let start = row.span.start;
    let end = row.span.end;
    if (current.mode === "move") { start = addDays(start, delta); end = addDays(end, delta); }
    if (current.mode === "start") start = minDate([addDays(start, delta), end]);
    if (current.mode === "end") end = maxDate([addDays(end, delta), start]);
    const next = { ...current, start, end, moved: current.moved || Math.abs(event.clientX - current.originX) > 3 };
    dragRef.current = next;
    setDrag(next);
  }
  function finish(row: Row) {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current || current.id !== row.issue.id) return;
    if (!current.moved) { onOpen?.(row.issue.key); return; }
    const before = row.span!;
    if (+current.start !== +before.start || +current.end !== +before.end) {
      onReschedule?.(row.issue, format(current.start, "yyyy-MM-dd"), format(current.end, "yyyy-MM-dd"));
    }
  }
  function keys(event: KeyboardEvent, row: Row) {
    if (event.key === "Enter") { onOpen?.(row.issue.key); return; }
    if (!editable || !row.span || row.span.derived || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    // Arrows move the bar; with Shift they change the due date.
    const start = event.shiftKey ? row.span.start : addDays(row.span.start, step);
    const end = maxDate([addDays(row.span.end, step), start]);
    onReschedule?.(row.issue, format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd"));
  }

  const bands = sprints.filter((s) => s.start_date && s.end_date).map((s) => {
    const left = scale.x(parseISO(s.start_date!));
    const width = (differenceInCalendarDays(parseISO(s.end_date!), parseISO(s.start_date!)) + 1) * scale.dayWidth;
    return <div key={s.id} title={`${s.name}: ${s.start_date} – ${s.end_date}`}
      className={cn("absolute top-0.5 h-4 truncate border border-border px-1 text-[10px] leading-4", s.status === "active" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}
      style={{ left, width }}>{s.name}</div>;
  });

  const arrows = links.filter((link) => link.link_type === "blocks").flatMap((link) => {
    const from = indexOf.get(link.source_id);
    const to = indexOf.get(link.target_id);
    if (from === undefined || to === undefined) return [];
    const a = spanOf(rows[from]);
    const b = spanOf(rows[to]);
    if (!a || !b) return [];
    const x1 = scale.x(a.end) + scale.dayWidth;
    const y1 = from * ROW + ROW / 2;
    const x2 = scale.x(b.start);
    const y2 = to * ROW + ROW / 2;
    const conflict = b.start <= a.end;
    // Out of the blocker's end, down to the blocked row, into its start.
    return [{ id: link.id, conflict, d: `M${x1},${y1} H${x1 + 8} V${y2} H${x2 - 2}` }];
  });

  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ToggleGroup value={[zoom]} onValueChange={(values) => values[0] && setZoom(values[0] as Zoom)} aria-label="Timeline zoom">
        <ToggleGroupItem value="weeks">Weeks</ToggleGroupItem>
        <ToggleGroupItem value="months">Months</ToggleGroupItem>
        <ToggleGroupItem value="quarters">Quarters</ToggleGroupItem>
      </ToggleGroup>
      <StatusLegend extra={arrows.length > 0 && <>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t border-muted-foreground" aria-hidden="true" />Blocks</span>
        {arrows.some((a) => a.conflict) && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-destructive" aria-hidden="true" />Starts before its blocker ends</span>}
      </>} />
    </div>
    {editable && <p className="text-xs text-muted-foreground">Drag a bar to move it, or its ends to change dates. On a focused bar, arrow keys move it a day; Shift with arrows changes the due date. Enter opens the issue.</p>}
    {rows.length === 0 ? <p className="text-sm text-muted-foreground">Give epics or issues start and due dates to see them on the timeline.</p> :
      <div ref={scroller} className="overflow-x-auto border border-border bg-card [--timeline-label:10rem] sm:[--timeline-label:16rem]">
        <div className="flex" style={{ width: `calc(var(--timeline-label) + ${scale.width}px)` }}>
          <div className="sticky left-0 z-20 shrink-0 border-r border-border bg-card" style={{ width: "var(--timeline-label)" }}>
            <div className="flex items-end border-b border-border px-2 pb-1 text-xs font-medium text-muted-foreground" style={{ height: HEADER + (bands.length ? 22 : 0) }}>Work</div>
            {rows.map((row) => <div key={row.issue.id} className="flex items-center gap-1 border-b border-border/60 px-1 text-sm" style={{ height: ROW, paddingLeft: 4 + row.depth * 16 }}>
              {row.expandable ? <Button variant="ghost" size="icon-xs" aria-label={`${collapsed.has(row.issue.id) ? "Expand" : "Collapse"} ${row.issue.key}`} aria-expanded={!collapsed.has(row.issue.id)}
                onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(row.issue.id)) next.delete(row.issue.id); else next.add(row.issue.id); return next; })}>
                {collapsed.has(row.issue.id) ? <ChevronRight /> : <ChevronDown />}
              </Button> : <span className="w-6 shrink-0" />}
              <IssueTypeIcon type={row.issue.issue_type} />
              <span className="min-w-0 truncate" title={`${row.issue.key} ${row.issue.summary}`}><span className="text-muted-foreground">{row.issue.key}</span> {row.issue.summary}</span>
            </div>)}
          </div>
          <div className="relative shrink-0" style={{ width: scale.width }}>
            <TimeAxis scale={scale} zoom={zoom} bands={bands.length ? bands : undefined} />
            <div className="relative" style={{ height: bodyHeight }}>
              <TimeGrid scale={scale} height={bodyHeight} zoom={zoom} />
              {rows.map((row, i) => <div key={row.issue.id} className="absolute inset-x-0 border-b border-border/60" style={{ top: i * ROW, height: ROW }} />)}
              <svg className="pointer-events-none absolute inset-0 overflow-visible" width={scale.width} height={bodyHeight} aria-hidden="true">
                <defs>
                  <marker id="pm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 Z" className="fill-muted-foreground" /></marker>
                  <marker id="pm-arrow-conflict" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 Z" className="fill-destructive" /></marker>
                </defs>
                {arrows.map((a) => <path key={a.id} d={a.d} fill="none" strokeWidth={a.conflict ? 2 : 1}
                  className={a.conflict ? "stroke-destructive" : "stroke-muted-foreground"} markerEnd={`url(#${a.conflict ? "pm-arrow-conflict" : "pm-arrow"})`} />)}
              </svg>
              {rows.map((row, i) => {
                const span = spanOf(row);
                if (!span) return <div key={row.issue.id} className="absolute px-2 text-xs text-muted-foreground" style={{ top: i * ROW + 10, left: scale.x(new Date()) + 8 }}>No dates</div>;
                const left = scale.x(span.start);
                const width = Math.max(scale.dayWidth, (differenceInCalendarDays(span.end, span.start) + 1) * scale.dayWidth);
                const draggable = editable && !span.derived;
                const epic = row.issue.issue_type === "epic";
                const done = epic && row.issue.child_count ? row.issue.child_done / row.issue.child_count : null;
                const label = `${row.issue.key} ${row.issue.summary}: ${format(span.start, "d MMM")} to ${format(span.end, "d MMM yyyy")}, ${labelOf(ISSUE_STATUSES, row.issue.status)}${done !== null ? `, ${Math.round(done * 100)}% done` : ""}${span.derived ? ", dates from its issues" : ""}`;
                const fill = cn(epic ? "bg-chart-1 text-chart-ink hover:bg-chart-1/90 hover:text-chart-ink" : cn(STATUS_BAR[row.issue.status], row.issue.status === "todo" ? "text-foreground hover:text-foreground" : "text-chart-ink hover:text-chart-ink"),
                  span.derived && "border border-dashed border-chart-4 bg-chart-1/50");
                if (!editable && !onOpen) {
                  // Read-only (shared) timeline: a plain bar with its details for screen readers.
                  return <div key={row.issue.id} title={label} className={cn("absolute flex items-center overflow-hidden text-[11px] font-medium", fill)}
                    style={{ top: i * ROW + 7, height: ROW - 14, left, width }}>
                    {done !== null && <span className="absolute inset-y-0 left-0 bg-chart-4/70" style={{ width: `${done * 100}%` }} aria-hidden="true" />}
                    <span className="relative truncate px-2" aria-hidden="true">{width > 60 ? row.issue.key : ""}</span>
                    <span className="sr-only">{label}</span>
                  </div>;
                }
                return <Button key={row.issue.id} type="button" variant="ghost" aria-label={label} title={label}
                  className={cn("absolute h-auto justify-start overflow-hidden p-0 text-[11px] active:not-aria-[haspopup]:translate-y-0", fill,
                    draggable ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",
                    drag?.id === row.issue.id && "opacity-80 ring-2 ring-ring")}
                  style={{ top: i * ROW + 7, height: ROW - 14, left, width }}
                  onPointerDown={(event) => draggable ? begin(event, row, "move") : undefined}
                  onPointerMove={(event) => move(event, row)}
                  onPointerUp={() => draggable ? finish(row) : onOpen?.(row.issue.key)}
                  onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
                  onKeyDown={(event) => keys(event, row)}>
                  {done !== null && <span className="absolute inset-y-0 left-0 bg-chart-4/70" style={{ width: `${done * 100}%` }} aria-hidden="true" />}
                  <span className="relative truncate px-2">{width > 60 ? row.issue.key : ""}</span>
                  {draggable && <>
                    <span className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" aria-hidden="true" onPointerDown={(event) => begin(event, row, "start")} />
                    <span className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" aria-hidden="true" onPointerDown={(event) => begin(event, row, "end")} />
                  </>}
                </Button>;
              })}
            </div>
          </div>
        </div>
      </div>}
    {unscheduled > 0 && <p className="text-xs text-muted-foreground">{unscheduled} {unscheduled === 1 ? "issue outside an epic has" : "issues outside an epic have"} no dates and {unscheduled === 1 ? "isn't" : "aren't"} shown.</p>}
  </div>;
}
