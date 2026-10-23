import { Link } from "react-router-dom";
import { requirementHref, requirementLabel, type Requirement } from "@/api/pm-requirements";
import { ErrorState, Loading } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/hooks/useApi";

export function LinkedRequirements({ kind, id }: { kind: "issues" | "decisions"; id: string }) {
  const list = useFetch<Requirement[]>(`/api/pm/${kind}/${id}/requirements`, true);
  return <section className="flex flex-col gap-2"><h3 className="text-sm font-semibold">Linked requirements</h3>
    {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : !list.data.length ? <p className="text-sm text-muted-foreground">No linked requirements. Open a requirement to link this record to its brief.</p> : <ul className="divide-y divide-border border border-border">{list.data.map((row) => <li key={row.id}><Link to={requirementHref(row)} className="flex items-start justify-between gap-3 p-3 text-sm hover:bg-muted"><span className="min-w-0"><span className="block text-xs text-muted-foreground">{row.key}</span><span className="break-words font-medium">{row.title}</span></span><Badge variant="secondary">{requirementLabel(row.status)}</Badge></Link></li>)}</ul>}
  </section>;
}
