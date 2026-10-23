import { Link } from "react-router-dom";
import type { Decision } from "@/api/pm-decisions";
import { ErrorState, Loading } from "@/components/ui";
import { useFetch } from "@/hooks/useApi";
import { DecisionStatus } from "./DecisionRegister";

export function IssueDecisions({ issueId, projectKey }: { issueId: string; projectKey: string }) {
  const list = useFetch<Decision[]>(`/api/pm/issues/${issueId}/decisions`, true);
  return <section className="flex flex-col gap-2" aria-label="Linked decisions"><h3 className="text-sm font-semibold">Linked decisions</h3>
    {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : !list.data.length ? <p className="text-sm text-muted-foreground">No decisions linked to this issue. Record a decision here or manage links from a decision.</p> :
      <ul className="flex flex-col gap-2">{list.data.map((row) => <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 border border-border p-3">
        <Link to={`/projects/${projectKey}?tab=decisions&decision=${row.id}`} className="min-w-0 flex-1 break-words text-sm font-medium underline-offset-4 hover:underline">{row.key} · {row.title}</Link><DecisionStatus status={row.status} />
      </li>)}</ul>}
  </section>;
}
