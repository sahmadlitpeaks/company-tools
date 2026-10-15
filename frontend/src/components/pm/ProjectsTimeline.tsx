import { useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { ArrowRight, CalendarOff, CircleAlert, CircleCheck, FolderKanban, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { HEALTH, type PmProject } from "@/api/pm";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  return <div className="flex flex-col gap-5">
    {dated.length > 0 && <div className="flex flex-wrap items-center gap-3"><span id="pm-timeline-scale" className="text-sm font-medium">Time scale</span>
    <ToggleGroup variant="outline" value={[zoom]} onValueChange={(values) => values[0] && setZoom(values[0] as Zoom)} aria-labelledby="pm-timeline-scale">
      <ToggleGroupItem value="weeks">Weeks</ToggleGroupItem>
      <ToggleGroupItem value="months">Months</ToggleGroupItem>
      <ToggleGroupItem value="quarters">Quarters</ToggleGroupItem>
    </ToggleGroup></div>}
    {dated.length === 0 ? <Alert><CalendarOff aria-hidden="true" /><AlertTitle>No scheduled projects</AlertTitle>
      <AlertDescription>Open a project below to view its work. Project administrators can add a start or target date in Settings to place it on the timeline.</AlertDescription>
    </Alert> : <>
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
    {undated.length > 0 && <section aria-labelledby="undated-projects-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1"><h2 id="undated-projects-title" className="flex items-center gap-2 text-sm font-semibold">Without dates<Badge variant="secondary">{undated.length}</Badge></h2>
        <p className="text-sm text-muted-foreground">Projects without a start or target date. Their work is still available.</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {undated.map((project) => <li key={project.id} className="min-w-0"><Card size="sm" className="h-full gap-3">
          <CardHeader className="min-w-0">
            <CardTitle className="min-w-0 pr-1"><Link className="break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" to={`/projects/${project.key}`}>{project.name}</Link></CardTitle>
            <CardDescription className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium">{project.key}</span><span className="break-words">Lead: {project.lead_name ?? "Not assigned"}</span></CardDescription>
            <CardAction><FolderKanban className="size-4 text-muted-foreground" aria-hidden="true" /></CardAction>
          </CardHeader>
          <CardContent className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-xs text-muted-foreground">{project.issue_count ? `${project.done_count} of ${project.issue_count} issues done` : "No issues yet"}</span>
            <Button role="link" variant="ghost" size="sm" nativeButton={false} render={<Link to={`/projects/${project.key}`} />} aria-label={`Open project ${project.name}`}>
              Open project<ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card></li>)}
      </ul>
    </section>}
  </div>;
}
