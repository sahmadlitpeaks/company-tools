import { useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { TriangleAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { pointsLabel } from "./IssueBits";

const weekLabel = (iso: string) => format(parseISO(iso), "d MMM");

/**
 * Sequential steps of the one-hue chart ramp, light to dark. Values inside
 * fills use ink on the light steps and inverse ink on the darkest one.
 */
const STEPS = [
  "bg-muted text-muted-foreground",
  "bg-chart-1 text-chart-ink",
  "bg-chart-2 text-chart-ink",
  "bg-chart-3 text-chart-ink",
  "bg-chart-5 text-chart-ink-inverse",
];

export type HeatRow = { id: string; label: string; values: number[]; note?: string };

/**
 * People × weeks heat map. `level` maps a value to a ramp step (0 = empty);
 * `flag` marks a cell that needs attention with an icon, never colour alone.
 */
export function HeatGrid({ caption, weeks, rows, level, flag, format: formatValue = String, legend }: {
  caption: string;
  weeks: string[];
  rows: HeatRow[];
  level: (value: number) => 0 | 1 | 2 | 3 | 4;
  flag?: (value: number) => boolean;
  format?: (value: number) => string;
  legend: ReactNode;
}) {
  return <div className="flex min-w-0 flex-col gap-3">
    {/* Focusable so keyboard users can scroll a wide grid on small screens. */}
    <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[36rem] border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-36 text-left font-medium text-muted-foreground">Person</th>
            {weeks.map((week) => <th key={week} scope="col" className="font-medium text-muted-foreground tabular-nums">{weekLabel(week)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <tr key={row.id}>
            <th scope="row" className="max-w-36 truncate pr-2 text-left font-medium" title={row.label}>
              {row.label}
              {row.note && <span className="block text-[11px] font-normal text-muted-foreground">{row.note}</span>}
            </th>
            {row.values.map((value, index) => {
              const flagged = flag?.(value) ?? false;
              const text = `${row.label}, week of ${weekLabel(weeks[index])}: ${formatValue(value)}${flagged ? ", over capacity" : ""}`;
              return <td key={weeks[index]} title={text} aria-label={text}
                className={cn("h-9 min-w-12 px-1 text-center font-medium tabular-nums", STEPS[level(value)], flagged && "outline-2 -outline-offset-2 outline-destructive")}>
                <span className="inline-flex items-center gap-0.5">
                  {flagged && <TriangleAlert className="size-3" aria-hidden="true" />}
                  {value ? formatValue(value) : ""}
                </span>
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">{legend}</div>
  </div>;
}

export function RampLegend({ labels }: { labels: [string, string, string, string, string] }) {
  return <>{labels.map((label, index) => <span key={label} className="inline-flex items-center gap-1.5">
    <span className={cn("inline-block size-3", STEPS[index].split(" ")[0])} aria-hidden="true" />{label}
  </span>)}</>;
}

/** The figure plus an on-demand table of the same numbers. */
function Figure({ title, table, children }: { title: string; table: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <figure className="flex min-w-0 flex-col gap-2">
    {children}
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="link" size="sm" className="h-auto p-0" />}>{open ? "Hide" : "Show"} data table</CollapsibleTrigger>
      <CollapsibleContent className="pt-2"><TableSurface><Table aria-label={title}>{table}</Table></TableSurface></CollapsibleContent>
    </Collapsible>
  </figure>;
}

const W = 640;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 34, left: 40 };

function ticks(max: number) {
  const step = max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const out: number[] = [];
  for (let value = 0; value <= max + 0.0001; value += step) out.push(value);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** Remaining story points per day against the straight ideal line. */
export function BurndownChart({ days, total }: { days: Array<{ date: string; ideal: number; remaining: number | null }>; total: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const scale = ticks(Math.max(total, 1));
  const top = scale[scale.length - 1];
  const x = (i: number) => PAD.left + (days.length < 2 ? 0 : (i / (days.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const actual = days.map((d, i) => d.remaining === null ? null : `${x(i)},${y(d.remaining)}`).filter(Boolean);
  const lastActual = days.reduce((last, d, i) => d.remaining !== null ? i : last, -1);
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));
  const point = hover !== null ? days[hover] : null;

  function locate(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (days.length - 1));
    setHover(Math.min(days.length - 1, Math.max(0, i)));
  }

  return <Figure title="Burndown data" table={<>
    <TableHeader><TableRow><TableHead>Day</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="text-right">Ideal</TableHead></TableRow></TableHeader>
    <TableBody>{days.map((d) => <TableRow key={d.date}><TableCell>{format(parseISO(d.date), "EEE d MMM")}</TableCell><TableCell className="text-right tabular-nums">{d.remaining === null ? "–" : pointsLabel(d.remaining)}</TableCell><TableCell className="text-right tabular-nums">{pointsLabel(d.ideal)}</TableCell></TableRow>)}</TableBody>
  </>}>
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-chart-4" aria-hidden="true" />Remaining points</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-px w-4 bg-muted-foreground" aria-hidden="true" />Ideal</span>
    </div>
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Burndown: ${total} points committed${lastActual >= 0 ? `, ${pointsLabel(days[lastActual].remaining ?? 0)} remaining` : ""}`}
        tabIndex={0}
        onPointerMove={(event) => locate(event.clientX, event.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(Math.max(0, lastActual))} onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") setHover((h) => Math.min(days.length - 1, (h ?? 0) + 1));
          if (event.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? 0) - 1));
        }}>
        {scale.map((v) => <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
          <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[15px] tabular-nums">{v}</text>
        </g>)}
        {days.map((d, i) => i % labelEvery === 0 || i === days.length - 1
          ? <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[15px]">{format(parseISO(d.date), "d MMM")}</text> : null)}
        <polyline points={days.map((d, i) => `${x(i)},${y(d.ideal)}`).join(" ")} fill="none" className="stroke-muted-foreground" strokeWidth={1} />
        {actual.length > 0 && <polyline points={actual.join(" ")} fill="none" className="stroke-chart-4" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {lastActual >= 0 && <circle cx={x(lastActual)} cy={y(days[lastActual].remaining ?? 0)} r={4} className="fill-chart-4 stroke-card" strokeWidth={2} />}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-foreground/40" strokeWidth={1} />}
      </svg>
      {point && hover !== null && <div role="status" className="pointer-events-none absolute top-2 border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm"
        style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% + 8px), calc(100% - 9rem))` }}>
        <p className="text-muted-foreground">{format(parseISO(point.date), "EEE d MMM")}</p>
        <p><span className="font-semibold tabular-nums">{point.remaining === null ? "–" : pointsLabel(point.remaining)}</span> remaining</p>
        <p><span className="font-semibold tabular-nums">{pointsLabel(point.ideal)}</span> ideal</p>
      </div>}
    </div>
  </Figure>;
}

/** Shorten a label to roughly `chars` characters (full text lives in the table). */
function fit(text: string, chars: number) {
  return text.length > chars ? `${text.slice(0, Math.max(1, chars - 1))}…` : text;
}

/** Committed vs completed points for recent sprints. */
export function VelocityChart({ sprints, average }: { sprints: Array<{ id: string; name: string; committed: number; completed: number }>; average: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const scale = ticks(Math.max(1, ...sprints.flatMap((s) => [s.committed, s.completed])));
  const top = scale[scale.length - 1];
  const band = (W - PAD.left - PAD.right) / sprints.length;
  const bar = Math.min(24, (band - 16) / 2);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const base = y(0);
  const column = (cx: number, value: number, className: string, label: string, key: string) => {
    const height = Math.max(0, base - y(value));
    const r = Math.min(4, height / 2, bar / 2);
    const left = cx;
    const d = height === 0 ? "" : `M${left},${base} V${base - height + r} Q${left},${base - height} ${left + r},${base - height} H${left + bar - r} Q${left + bar},${base - height} ${left + bar},${base - height + r} V${base} Z`;
    return <g key={key}>
      <path d={d} className={className} />
      <text x={left + bar / 2} y={base - height - 4} textAnchor="middle" className="fill-foreground text-[15px] tabular-nums">{pointsLabel(value)}</text>
      <title>{label}</title>
    </g>;
  };
  const focused = sprints.find((s) => s.id === hover);
  return <Figure title="Velocity data" table={<>
    <TableHeader><TableRow><TableHead>Sprint</TableHead><TableHead className="text-right">Committed</TableHead><TableHead className="text-right">Completed</TableHead></TableRow></TableHeader>
    <TableBody>{sprints.map((s) => <TableRow key={s.id}><TableCell>{s.name}</TableCell><TableCell className="text-right tabular-nums">{pointsLabel(s.committed)}</TableCell><TableCell className="text-right tabular-nums">{pointsLabel(s.completed)}</TableCell></TableRow>)}</TableBody>
  </>}>
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block size-3 bg-chart-2" aria-hidden="true" />Committed</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block size-3 bg-chart-5" aria-hidden="true" />Completed</span>
      <span>Average completed: <span className="font-semibold text-foreground">{pointsLabel(average)}</span> points</span>
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Velocity over ${sprints.length} sprints, average ${pointsLabel(average)} points completed`}>
      {scale.map((v) => <g key={v}>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
        <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[15px] tabular-nums">{v}</text>
      </g>)}
      {sprints.map((s, i) => {
        const start = PAD.left + i * band + (band - bar * 2 - 2) / 2;
        return <g key={s.id} onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)} className={hover && hover !== s.id ? "opacity-60" : undefined}>
          <rect x={PAD.left + i * band} y={PAD.top} width={band} height={H - PAD.top - PAD.bottom} fill="transparent" />
          {column(start, s.committed, "fill-chart-2", `${s.name}: ${pointsLabel(s.committed)} committed`, "c")}
          {column(start + bar + 2, s.completed, "fill-chart-5", `${s.name}: ${pointsLabel(s.completed)} completed`, "d")}
          <text x={PAD.left + i * band + band / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[15px]">{fit(s.name, Math.floor(band / 8.5))}</text>
        </g>;
      })}
    </svg>
    {focused && <p role="status" className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{focused.name}</span>: {pointsLabel(focused.completed)} of {pointsLabel(focused.committed)} points completed</p>}
  </Figure>;
}
