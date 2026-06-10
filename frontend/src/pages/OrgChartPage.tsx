import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { OrgNode } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead } from "../components/ui";

const AVATAR_COLORS = [
  "#0ea5e9", "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#3b82f6",
];
function colorFor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name?: string | null): string {
  const src = (name || "?").trim();
  const parts = src.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
}

export default function OrgChartPage() {
  const { data, loading } = useFetch<OrgNode[]>("/api/people/org-chart");
  const roots = data ?? [];
  const single = roots.length === 1 ? roots[0] : null;

  return (
    <div>
      <PageHead title="Org Chart" subtitle="Reporting lines across the company." />
      {loading ? (
        <Loading />
      ) : roots.length === 0 ? (
        <Empty message="No reporting lines yet. Set a manager on people's profiles to build the tree." />
      ) : (
        <div className="card !p-0">
          <div className="org-scroll">
            <ul className="org-tree">
              {single ? (
                <Node node={single} depth={0} />
              ) : (
                roots.map((n) => <Node key={n.id} node={n} depth={0} />)
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Node({ node, depth }: { node: OrgNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasReports = node.reports.length > 0;
  const seed = useMemo(() => node.name ?? node.id, [node]);

  return (
    <li>
      <div className="relative inline-block">
        <Link to={`/people/${node.id}`} className="org-card">
          <span className="org-avatar" style={{ background: colorFor(seed) }}>
            {node.avatar_url ? (
              <img src={node.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(node.name)
            )}
          </span>
          <span className="text-sm font-semibold leading-tight text-ink">{node.name ?? "—"}</span>
          <span className="muted text-xs leading-tight">{node.job_title ?? "—"}</span>
          {node.department_name && <span className="badge mt-0.5">{node.department_name}</span>}
          {hasReports && (
            <span className="muted text-[11px]">
              {node.report_count} report{node.report_count > 1 ? "s" : ""}
            </span>
          )}
        </Link>
        {hasReports && (
          <button className="org-toggle" onClick={() => setOpen((v) => !v)} title={open ? "Collapse" : "Expand"}>
            {open ? "−" : "+"}
          </button>
        )}
      </div>
      {hasReports && open && (
        <ul>
          {node.reports.map((c) => (
            <Node key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
