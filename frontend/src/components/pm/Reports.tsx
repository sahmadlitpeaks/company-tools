import { useState, type ReactNode } from "react";
import { addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TriangleAlert } from "lucide-react";
import type { ActivityReport, BurndownReport, PmProject, PmSprint, VelocityReport, WorkloadReport } from "@/api/pm";
import { TaskChoice } from "@/components/tasks/TaskChoice";
import { Empty, ErrorState, Loading } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFetch } from "@/hooks/useApi";
import { BurndownChart, HeatGrid, RampLegend, VelocityChart } from "./Charts";
import { pointsLabel } from "./IssueBits";

const WORKLOAD_WEEKS = 8;
const ACTIVITY_WEEKS = 12;

export function Reports({ project }: { project: PmProject }) {
  // min-w-0 lets wide heat maps scroll inside their card instead of widening the page.
  return <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
    {project.sprints_enabled && <Burndown project={project} />}
    {project.sprints_enabled && <Velocity project={project} />}
    <div className="min-w-0 xl:col-span-2"><Workload project={project} /></div>
    <div className="min-w-0 xl:col-span-2"><Activity project={project} /></div>
  </div>;
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card className="min-w-0">
    <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent className="min-w-0">{children}</CardContent>
  </Card>;
}

function Burndown({ project }: { project: PmProject }) {
  const sprints = useFetch<PmSprint[]>(`/api/pm/projects/${project.id}/sprints?state=all`);
  const [sprintId, setSprintId] = useState("");
  const report = useFetch<BurndownReport>(`/api/pm/projects/${project.id}/reports/burndown${sprintId ? `?sprint_id=${sprintId}` : ""}`);
  const choices = (sprints.data ?? []).filter((s) => s.status !== "future");
  return <Section title="Sprint burndown" description="Story points left to finish each day, against a steady pace to zero.">
    {report.error ? <ErrorState message={report.error} onRetry={report.reload} /> : !report.data ? <Loading /> :
      !report.data.sprint ? <Empty message="No sprint to chart yet" hint="Start a sprint with dates to see its burndown." /> :
      <div className="flex flex-col gap-3">
        {choices.length > 1 && <div className="max-w-xs"><TaskChoice id="pm-burndown-sprint" label="Sprint" value={sprintId || report.data.sprint.id}
          items={choices.map((s) => ({ value: s.id, label: `${s.name}${s.status === "active" ? " (active)" : ""}` }))} onChange={setSprintId} /></div>}
        <BurndownChart days={report.data.days} total={report.data.total_points} />
      </div>}
  </Section>;
}

function Velocity({ project }: { project: PmProject }) {
  const report = useFetch<VelocityReport>(`/api/pm/projects/${project.id}/reports/velocity`);
  return <Section title="Velocity" description="Points committed at sprint start and completed by the end, for recent sprints.">
    {report.error ? <ErrorState message={report.error} onRetry={report.reload} /> : !report.data ? <Loading /> :
      report.data.sprints.length === 0 ? <Empty message="No completed sprints yet" hint="Velocity appears after the first sprint is completed." /> :
      <VelocityChart sprints={report.data.sprints} average={report.data.average_completed} />}
  </Section>;
}

function Workload({ project }: { project: PmProject }) {
  const [offset, setOffset] = useState(0);
  // Two weeks of history, then what's coming; Earlier/Later page by the window.
  const from = format(addWeeks(subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 2), offset), "yyyy-MM-dd");
  const report = useFetch<WorkloadReport>(`/api/pm/projects/${project.id}/reports/workload?weeks=${WORKLOAD_WEEKS}&start=${from}`);
  const [metric, setMetric] = useState<"points" | "issues">("points");
  const [capacity, setCapacity] = useState("8");
  const limit = Math.max(1, Number(capacity) || 8);
  const level = (value: number) => (value <= 0 ? 0 : value > limit ? 4 : value > limit * 0.6 ? 3 : value > limit * 0.3 ? 2 : 1) as 0 | 1 | 2 | 3 | 4;
  const data = report.data;
  return <Section title="Team workload" description="Work scheduled per person per week, from each issue's start and due dates or its sprint. Points are spread across the weeks an issue spans.">
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <ToggleGroup value={[metric]} onValueChange={(values) => values[0] && setMetric(values[0] as typeof metric)} aria-label="Workload measure">
          <ToggleGroupItem value="points">Story points</ToggleGroupItem>
          <ToggleGroupItem value="issues">Issues</ToggleGroupItem>
        </ToggleGroup>
        <Field className="w-36">
          <FieldLabel htmlFor="pm-capacity">Weekly capacity</FieldLabel>
          <Input id="pm-capacity" type="number" min={1} step={1} value={capacity} onChange={(event) => setCapacity(event.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOffset((o) => o - WORKLOAD_WEEKS)}><ChevronLeft data-icon="inline-start" />Earlier</Button>
          <Button variant="outline" onClick={() => setOffset((o) => o + WORKLOAD_WEEKS)}>Later<ChevronRight data-icon="inline-end" /></Button>
          {offset !== 0 && <Button variant="ghost" onClick={() => setOffset(0)}>This week</Button>}
        </div>
      </div>
      {report.error ? <ErrorState message={report.error} onRetry={report.reload} /> : !data ? <Loading /> :
        data.people.length === 0 ? <Empty message="Nobody on this project yet" hint="Add people on the People tab." /> :
        <HeatGrid
          caption={`Workload in ${metric === "points" ? "story points" : "issues"} per person per week`}
          weeks={data.weeks}
          rows={data.people.map((p) => ({ id: p.user_id, label: p.name, values: metric === "points" ? p.points : p.issues, note: p.unscheduled ? `${p.unscheduled} without dates` : undefined }))}
          level={level}
          flag={(value) => value > limit}
          format={(value) => metric === "points" ? pointsLabel(value) : String(value)}
          legend={<>
            <RampLegend labels={["None", `Up to ${pointsLabel(limit * 0.3)}`, `Up to ${pointsLabel(limit * 0.6)}`, `Up to ${limit}`, `Over ${limit}`]} />
            <span className="inline-flex items-center gap-1"><TriangleAlert className="size-3" aria-hidden="true" />Over capacity</span>
          </>}
        />}
    </div>
  </Section>;
}

function Activity({ project }: { project: PmProject }) {
  const report = useFetch<ActivityReport>(`/api/pm/projects/${project.id}/reports/activity?weeks=${ACTIVITY_WEEKS}`);
  const data = report.data;
  const max = data ? Math.max(1, ...data.people.flatMap((p) => p.counts)) : 1;
  const level = (value: number) => (value <= 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4))) as 0 | 1 | 2 | 3 | 4;
  return <Section title="Activity" description={`Issues created, changes made and comments written each week over the last ${ACTIVITY_WEEKS} weeks.`}>
    {report.error ? <ErrorState message={report.error} onRetry={report.reload} /> : !data ? <Loading /> :
      <HeatGrid
        caption="Activity per person per week"
        weeks={data.weeks}
        rows={[...data.people.map((p) => ({ id: p.user_id, label: p.name, values: p.counts })), { id: "total", label: "Whole team", values: data.totals }]}
        level={(value) => level(Math.min(value, max))}
        legend={<RampLegend labels={["None", "Low", "Medium", "High", "Highest"]} />}
      />}
  </Section>;
}
