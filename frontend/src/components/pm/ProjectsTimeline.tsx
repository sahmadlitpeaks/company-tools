import { useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { HEALTH, type PmProject } from "@/api/pm";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { buildScale, TimeAxis, TimeGrid, type Zoom } from "./Timeline";

const ROW = 44;

export function HealthBadge({ project }: { project: Pick<PmProject, "health" | "overdue_count"> }) {
  const health = HEALTH[project.health];
  const Icon = project.health === "on_track" ? CircleCheck : project.health === "late" ? CircleAlert : TriangleAlert;
  const reason = project.health === "late" ? "Target date passed with work still open"
    : project.health === "at_risk" ? `${project.overdue_count} overdue ${project.overdue_count === 1 ? "issue" : "issues"}` : "No overdue work";
  return <Badge variant={health.variant} title={reason}><Icon data-icon="inline-start" aria-hidden="true" />{health.label}<span className="sr-only">: {reason}</span></Badge>;
}

/** Every visible project from start to target date, with progress and health. */
export function ProjectsTimeline({ projects }: { projects: PmProject[] }) {
  const [zoom, setZoom] = useState<Zoom>("months");
  const dated = projects.filter((p) => p.start_date || p.target_date);
  const scale = useMemo(() => buildScale(dated.flatMap((p) => [p.start_date, p.target_date]).filter((d): d is string => Boolean(d)).map((d) => parseISO(d)), zoom), [dated, zoom]);
  const height = dated.length * ROW;
  const undated = projects.filter((p) => !p.start_date && !p.target_date);
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center gap-3"><span id="pm-timeline-scale" className="text-sm font-medium">Time scale</span>
    <ToggleGroup variant="outline" value={[zoom]} onValueChange={(values) => values[0] && setZoom(values[0] as Zoom)} aria-labelledby="pm-timeline-scale">
      <ToggleGroupItem value="weeks">Weeks</ToggleGroupItem>
      <ToggleGroupItem value="months">Months</ToggleGroupItem>
      <ToggleGroupItem value="quarters">Quarters</ToggleGroupItem>
    </ToggleGroup></div>
    {dated.length === 0 ? <Empty message="No scheduled projects" hint="Projects need a start or target date to appear on the timeline. You can still open undated projects below." /> : <>
      <p id="pm-timeline-help" className="text-xs text-muted-foreground">Scroll horizontally to explore dates. Select a project to open its workspace.</p>
      <div role="region" aria-label="Project schedule" aria-describedby="pm-timeline-help" tabIndex={0} className="overflow-x-auto border border-border bg-card outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring [--timeline-label:11rem] sm:[--timeline-label:18rem]">
        <div className="flex" style={{ width: `calc(var(--timeline-label) + ${scale.width}px)` }}>
          <div className="sticky left-0 z-20 shrink-0 border-r border-border bg-card" style={{ width: "var(--timeline-label)" }}>
            <div className="flex h-11 items-end border-b border-border px-2 pb-1 text-xs font-medium text-muted-foreground">Project</div>
            {dated.map((p) => <div key={p.id} className="flex flex-col justify-center gap-0.5 border-b border-border/60 px-2" style={{ height: ROW }}>
              <Link to={`/projects/${p.key}`} className="truncate text-sm font-medium underline-offset-4 hover:underline">{p.name}</Link>
              <span className="flex items-center gap-2"><HealthBadge project={p} /><span className="text-xs text-muted-foreground">{p.key}</span></span>
            </div>)}
          </div>
          <div className="relative shrink-0" style={{ width: scale.width }}>
            <TimeAxis scale={scale} zoom={zoom} />
            <div className="relative" style={{ height }}>
              <TimeGrid scale={scale} height={height} zoom={zoom} />
              {dated.map((p, i) => {
                const start = parseISO(p.start_date ?? p.target_date!);
                const end = parseISO(p.target_date ?? p.start_date!);
                const left = scale.x(start);
                const width = Math.max(scale.dayWidth, (differenceInCalendarDays(end, start) + 1) * scale.dayWidth);
                const percent = p.issue_count ? Math.round(p.done_count / p.issue_count * 100) : 0;
                const label = `${p.name}: ${format(start, "d MMM yyyy")} to ${format(end, "d MMM yyyy")}, ${percent}% done, ${HEALTH[p.health].label}`;
                return <div key={p.id} className="absolute border-b border-border/60" style={{ top: i * ROW, height: ROW, left: 0, right: 0 }}>
                  <Link to={`/projects/${p.key}`} aria-label={label} title={label}
                    className="absolute top-2.5 flex h-6 items-center overflow-hidden bg-chart-1 text-[11px] font-medium text-chart-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
                    style={{ left, width }}>
                    <span className="absolute inset-y-0 left-0 bg-chart-4/70" style={{ width: `${percent}%` }} aria-hidden="true" />
                    <span className="relative truncate px-2">{width > 70 ? `${percent}%` : ""}</span>
                  </Link>
                </div>;
              })}
            </div>
          </div>
        </div>
      </div></>}
    {dated.length > 0 &&
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 bg-chart-1" aria-hidden="true" />Planned span</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 bg-chart-4/70" aria-hidden="true" />Issues done</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 border-l-2 border-primary" aria-hidden="true" />Today</span>
    </div>}
    {undated.length > 0 && <Card>
      <CardHeader><CardTitle>Without dates ({undated.length})</CardTitle><CardDescription>These projects have no start or target date yet.</CardDescription></CardHeader>
      <CardContent><ul className="flex flex-col gap-2">
        {undated.map((project) => <li key={project.id}><Link className="inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" to={`/projects/${project.key}`}><span className="break-words">{project.name}</span><span className="text-muted-foreground">{project.key}</span></Link></li>)}
      </ul></CardContent>
    </Card>}
  </div>;
}
