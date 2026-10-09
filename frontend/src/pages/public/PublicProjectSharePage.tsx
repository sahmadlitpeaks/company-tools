import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Eye } from "lucide-react";
import { fromShared, HEALTH, ISSUE_STATUSES, labelOf, SHARE_VIEWS, type PublicShare } from "@/api/pm";
import { dateLabel } from "@/api/tasks";
import { BurndownChart, VelocityChart } from "@/components/pm/Charts";
import { IssueBoard } from "@/components/pm/IssueBoard";
import { StatusBadge } from "@/components/pm/IssueBits";
import { HealthBadge } from "@/components/pm/ProjectsTimeline";
import { Timeline } from "@/components/pm/Timeline";
import { Empty, ErrorState, Loading } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useFetch } from "@/hooks/useApi";

// The server's message for unknown, expired and revoked links alike.
const UNAVAILABLE = "This link isn't available. It may have expired or been revoked.";

/** Read-only project view opened from a share link; no account needed. */
export default function PublicProjectSharePage() {
  const { token = "" } = useParams();
  const share = useFetch<PublicShare>(`/api/public/pm-shares/${encodeURIComponent(token)}`, true);

  // The app is already noindex (index.html); also keep the link out of referrers.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const data = share.data;
  return <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-5 bg-background p-4 sm:p-6">
    {share.error ? <div className="flex flex-1 items-center justify-center">
      {share.error === UNAVAILABLE
        ? <Empty message="This link isn't available" hint="It may have expired or been revoked. Ask the person who shared it for a new link." />
        : <ErrorState message={share.error} onRetry={share.reload} />}
    </div> : !data ? <Loading /> : <>
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Eye className="size-3.5" aria-hidden="true" />Read-only {labelOf(SHARE_VIEWS, data.view).toLowerCase()} view</p>
        <h1 className="text-2xl font-semibold">{data.project.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{data.project.key}</span>
          <HealthBadge project={data.project} />
          {data.project.status === "archived" && <Badge variant="outline">Archived</Badge>}
          {data.project.target_date && <span>Target {dateLabel(data.project.target_date)}</span>}
          <span>{data.project.done_count} of {data.project.issue_count} issues done</span>
        </div>
        {data.label && <p className="text-sm">{data.label}</p>}
      </header>
      {data.board && <SharedBoard share={data} />}
      {data.timeline && <Timeline issues={data.timeline.issues.map((i) => fromShared(i))} links={data.timeline.links}
        sprints={data.timeline.sprints.map((s) => ({ ...s, project_id: "", started_at: null, completed_at: null, committed_points: null, completed_points: null, issue_count: 0, done_count: 0, points: 0, done_points: 0 }))}
        editable={false} />}
      {data.progress && <SharedProgress share={data} />}
      <footer className="mt-auto pt-6 text-xs text-muted-foreground">
        Updated {new Date(data.generated_at).toLocaleString()}{data.expires_at && ` · This link expires ${dateLabel(data.expires_at.slice(0, 10))}`}
      </footer>
    </>}
  </main>;
}

function SharedBoard({ share }: { share: PublicShare }) {
  const board = share.board!;
  if (share.project.sprints_enabled && !board.sprint) return <Empty message="No sprint is running" hint="The board shows the active sprint once one starts." />;
  return <div className="flex flex-col gap-3">
    {board.sprint && <div className="border border-border bg-card p-3">
      <p className="font-semibold">{board.sprint.name}</p>
      {board.sprint.start_date && board.sprint.end_date && <p className="text-xs text-muted-foreground">{dateLabel(board.sprint.start_date)} – {dateLabel(board.sprint.end_date)}</p>}
      {board.sprint.goal && <p className="text-sm">Goal: {board.sprint.goal}</p>}
    </div>}
    <IssueBoard project={share.project} issues={board.issues.map((i) => fromShared(i))} editable={false} busy={null} onMove={() => undefined} linkIssues={false} />
  </div>;
}

function SharedProgress({ share }: { share: PublicShare }) {
  const progress = share.progress!;
  const total = Object.values(progress.counts).reduce((sum, n) => sum + n, 0);
  return <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
    <Card className="min-w-0">
      <CardHeader><CardTitle>Status</CardTitle><CardDescription>{total} issues, not counting epics. {HEALTH[share.project.health].label}{share.project.overdue_count ? `: ${share.project.overdue_count} overdue` : ""}.</CardDescription></CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ISSUE_STATUSES.map((s) => <div key={s.value} className="border border-border p-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="text-2xl font-semibold">{progress.counts[s.value] ?? 0}</dd>
          </div>)}
        </dl>
      </CardContent>
    </Card>
    <Card className="min-w-0">
      <CardHeader><CardTitle>Epics</CardTitle><CardDescription>Share of each epic's issues that are done.</CardDescription></CardHeader>
      <CardContent>
        {progress.epics.length === 0 ? <p className="text-sm text-muted-foreground">No epics yet.</p> :
          <ul className="flex flex-col gap-3">
            {progress.epics.map((epic) => {
              const percent = epic.issue_count ? Math.round(epic.done_count / epic.issue_count * 100) : 0;
              return <li key={epic.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{epic.key}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{epic.summary}</span>
                  <StatusBadge status={epic.status} />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Progress value={percent} className="flex-1" aria-label={`${epic.key} ${percent}% done`} />
                  <span className="shrink-0">{epic.done_count}/{epic.issue_count}{epic.due_date ? ` · due ${dateLabel(epic.due_date)}` : ""}</span>
                </div>
              </li>;
            })}
          </ul>}
      </CardContent>
    </Card>
    {progress.burndown?.sprint && <Card className="min-w-0">
      <CardHeader><CardTitle>Sprint burndown</CardTitle><CardDescription>{progress.burndown.sprint.name}: story points left each day against a steady pace.</CardDescription></CardHeader>
      <CardContent className="min-w-0"><BurndownChart days={progress.burndown.days} total={progress.burndown.total_points} /></CardContent>
    </Card>}
    {progress.velocity && progress.velocity.sprints.length > 0 && <Card className="min-w-0">
      <CardHeader><CardTitle>Velocity</CardTitle><CardDescription>Points committed and completed in recent sprints.</CardDescription></CardHeader>
      <CardContent className="min-w-0"><VelocityChart sprints={progress.velocity.sprints} average={progress.velocity.average_completed} /></CardContent>
    </Card>}
  </div>;
}
