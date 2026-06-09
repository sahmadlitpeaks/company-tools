import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, UserRound } from "lucide-react";
import type { OrgNode } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead } from "../components/ui";

export default function OrgChartPage() {
  const { data, loading } = useFetch<OrgNode[]>("/api/people/org-chart");
  return (
    <div>
      <PageHead title="Org Chart" subtitle="Reporting lines across the company." />
      {loading ? (
        <Loading />
      ) : (data?.length ?? 0) === 0 ? (
        <Empty message="No reporting lines yet. Set a manager on people's profiles to build the tree." />
      ) : (
        <div className="card">
          {data!.map((n) => (
            <Node key={n.id} node={n} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function Node({ node, depth }: { node: OrgNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasReports = node.reports.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-lg py-1.5 hover:bg-slate-50"
        style={{ paddingLeft: depth * 20 }}
      >
        <button
          className="grid h-5 w-5 flex-none place-items-center text-ink-muted"
          onClick={() => setOpen((v) => !v)}
          style={{ visibility: hasReports ? "visible" : "hidden" }}
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <span className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full bg-brand-100 text-brand-700">
          {node.avatar_url ? (
            <img src={node.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserRound size={16} />
          )}
        </span>
        <div className="min-w-0">
          <Link to={`/people/${node.id}`} className="font-medium hover:text-brand-600 hover:underline">
            {node.name ?? "—"}
          </Link>
          <div className="muted text-xs">
            {node.job_title ?? "—"}
            {node.department_name ? ` · ${node.department_name}` : ""}
            {node.report_count > 0 ? ` · ${node.report_count} report${node.report_count > 1 ? "s" : ""}` : ""}
          </div>
        </div>
      </div>
      {open && hasReports && (
        <div className="border-l border-slate-100" style={{ marginLeft: depth * 20 + 10 }}>
          {node.reports.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
