import { useIssueHref } from "./useIssueHref";
import { addDays, addMonths, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { type PmIssue } from "@/api/pm";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui";
import { useIsMobile } from "@/hooks/use-mobile";
import { StatusBadge } from "./IssueBits";

export function IssueCalendar({ issues, projectKey, month, onMonth }: { issues: PmIssue[]; projectKey?: string; month: Date; onMonth: (month: Date) => void }) {
  const issueHref = useIssueHref();
  const mobile = useIsMobile();
  const first = startOfWeek(month, { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, index) => addDays(first, index));
  const from = format(month, "yyyy-MM-dd"), to = format(endOfMonth(month), "yyyy-MM-dd");
  const visible = issues.filter((issue) => issue.due_date && issue.due_date >= from && issue.due_date <= to).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
  function item(issue: PmIssue) {
    return <Link key={issue.id} to={issueHref(projectKey ?? issue.key.split("-")[0], issue.key)} className="flex min-w-0 flex-col gap-1 border border-border bg-card p-2 text-sm hover:bg-accent">
      <span className="text-xs text-muted-foreground">{issue.key}</span><span className="break-words font-medium">{issue.summary}</span><StatusBadge status={issue.status} label={issue.workflow_name} />
    </Link>;
  }
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold" aria-live="polite">{format(month, "MMMM yyyy")}</h2>
      <div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous month" onClick={() => onMonth(addMonths(month, -1))}><ChevronLeft /></Button>
        <Button variant="outline" onClick={() => onMonth(startOfMonth(new Date()))}>Today</Button>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => onMonth(addMonths(month, 1))}><ChevronRight /></Button></div>
    </div>
    <p className="text-sm text-muted-foreground">Issues appear on their due date. Filters still apply; pagination below moves through this month's results.</p>
    {mobile ? visible.length ? <div className="flex flex-col gap-4">{[...new Set(visible.map((issue) => issue.due_date!))].map((day) => <section key={day} className="flex flex-col gap-2" aria-label={day}><h3 className="text-sm font-medium">{day}</h3>{visible.filter((issue) => issue.due_date === day).map(item)}</section>)}</div> : <Empty message="No issues due this month" hint="Add a due date to an issue, or choose another month." /> :
      <div className="grid grid-cols-7 border-l border-t border-border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="border-b border-r border-border bg-muted/30 p-2 text-center text-xs font-semibold">{day}</div>)}
        {days.map((day) => { const key = format(day, "yyyy-MM-dd"); const outside = day.getMonth() !== month.getMonth(); return <section key={key} aria-label={key} className={`flex min-h-28 min-w-0 flex-col gap-2 border-b border-r border-border p-2 ${outside ? "bg-muted/20 text-muted-foreground" : ""}`}>
          <h3 className={`text-xs ${key === format(new Date(), "yyyy-MM-dd") ? "font-bold text-primary-foreground bg-primary p-1" : ""}`}>{format(day, "d")}</h3>
          {issues.filter((issue) => issue.due_date === key).map(item)}
        </section>; })}
      </div>}
    {issues.some((issue) => !issue.due_date) && <p className="text-xs text-muted-foreground">{issues.filter((issue) => !issue.due_date).length} issues have no due date and do not appear on the calendar.</p>}
  </div>;
}
