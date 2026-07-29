import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ListTree,
  Network,
  Search,
  Users,
} from "lucide-react";

import type { OrgNode } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, ErrorBox, Loading, PageHead } from "../components/ui";
import { OrgChartFlow } from "../components/org-chart/OrgChartFlow";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function initials(name?: string | null): string {
  const source = (name || "?").trim().split(/\s+/);
  return (source.length > 1 ? source[0][0] + source[1][0] : source[0].slice(0, 2)).toUpperCase();
}

function flatten(nodes: OrgNode[], parents: string[] = []): Array<{ node: OrgNode; parents: string[] }> {
  return nodes.flatMap((node) => [
    { node, parents },
    ...flatten(node.reports, [...parents, node.id]),
  ]);
}

function defaultExpanded(nodes: OrgNode[], depth = 0): Set<string> {
  const expanded = new Set<string>();
  for (const node of nodes) {
    if (node.reports.length && depth < 2) expanded.add(node.id);
    for (const id of defaultExpanded(node.reports, depth + 1)) expanded.add(id);
  }
  return expanded;
}

function PersonAvatar({ node, size = "default" }: { node: OrgNode; size?: "default" | "lg" }) {
  return (
    <Avatar size={size} className="rounded-none after:rounded-none">
      {node.avatar_url ? <AvatarImage src={node.avatar_url} alt="" className="rounded-none" /> : null}
      <AvatarFallback className="rounded-none bg-primary/15 text-foreground">{initials(node.name)}</AvatarFallback>
    </Avatar>
  );
}

export default function OrgChartPage() {
  const { data, loading, error } = useFetch<OrgNode[]>("/api/people/org-chart");
  const roots = useMemo(() => data ?? [], [data]);
  const people = useMemo(() => flatten(roots), [roots]);
  const [view, setView] = useState<"list" | "tree">("list");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (roots.length) setExpanded(defaultExpanded(roots));
  }, [roots]);

  const departments = useMemo(
    () => Array.from(new Set(people.map(({ node }) => node.department_name).filter(Boolean) as string[])).sort(),
    [people],
  );

  const filterResult = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery && !department) return null;
    const visible = new Set<string>();
    let matches = 0;
    for (const { node, parents } of people) {
      const text = [node.name, node.job_title, node.department_name].filter(Boolean).join(" ").toLowerCase();
      if ((!normalizedQuery || text.includes(normalizedQuery)) && (!department || node.department_name === department)) {
        matches += 1;
        visible.add(node.id);
        parents.forEach((id) => visible.add(id));
      }
    }
    return { visible, matches };
  }, [department, people, query]);
  const visibleIds = filterResult?.visible ?? null;

  const matchCount = filterResult?.matches ?? people.length;

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function expandAll() {
    setExpanded(new Set(people.filter(({ node }) => node.reports.length).map(({ node }) => node.id)));
  }

  return (
    <div>
      <PageHead
        title="Org Chart"
        subtitle="Explore reporting lines across the company."
        action={
          <Badge variant="secondary">
            <Users data-icon="inline-start" />
            {people.length} people
          </Badge>
        }
      />

      {loading ? <Loading /> : error ? <ErrorBox message={error} /> : roots.length === 0 ? (
        <Empty icon={<Network />} message="No reporting lines yet" hint="Set managers on people's profiles to build the hierarchy." />
      ) : (
        <Card className="py-0">
          <CardHeader className="border-b py-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(16rem,1fr)_14rem]">
                <InputGroup>
                  <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
                  <InputGroupInput
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search people, roles, departments..."
                    aria-label="Search organization"
                  />
                </InputGroup>
                <Select value={department || null} onValueChange={(value) => setDepartment(value ?? "")}>
                  <SelectTrigger className="w-full" aria-label="Filter by department">
                    <SelectValue placeholder="All departments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={null}>All departments</SelectItem>
                      {departments.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  value={[view]}
                  onValueChange={(values) => values[0] && setView(values[0] as "list" | "tree")}
                  variant="outline"
                  spacing={0}
                >
                  <ToggleGroupItem value="list"><ListTree data-icon="inline-start" />List</ToggleGroupItem>
                  <ToggleGroupItem value="tree"><Network data-icon="inline-start" />Tree</ToggleGroupItem>
                </ToggleGroup>
                <Button type="button" variant="outline" size="sm" onClick={expandAll} disabled={Boolean(visibleIds)}>
                  <ChevronsUpDown data-icon="inline-start" />Expand all
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(new Set())} disabled={Boolean(visibleIds)}>
                  <ChevronsDownUp data-icon="inline-start" />Collapse all
                </Button>
              </div>
            </div>
            <CardDescription>{matchCount} visible {matchCount === 1 ? "person" : "people"}</CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            {visibleIds?.size === 0 ? (
              <Empty icon={<Search />} message="No people found" hint="Try a different name, role, or department." />
            ) : view === "list" ? (
              <div role="tree" aria-label="Organization hierarchy" className="org-chart-list">
                {roots.map((node) => (
                  <ListNode key={node.id} node={node} depth={0} expanded={expanded} visibleIds={visibleIds} onToggle={toggle} />
                ))}
              </div>
            ) : (
              <OrgChartFlow roots={roots} expanded={expanded} visibleIds={visibleIds} onToggle={toggle} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ListNode({
  node,
  depth,
  expanded,
  visibleIds,
  onToggle,
}: {
  node: OrgNode;
  depth: number;
  expanded: Set<string>;
  visibleIds: Set<string> | null;
  onToggle: (id: string) => void;
}) {
  if (visibleIds && !visibleIds.has(node.id)) return null;
  const hasReports = node.reports.length > 0;
  const filtering = visibleIds !== null;
  const open = filtering || expanded.has(node.id);
  const rowStyle = {
    "--org-chart-depth": Math.min(depth, 7),
    "--org-chart-mobile-depth": Math.min(depth, 4),
  } as CSSProperties;
  const reportLabel = `${node.report_count} direct ${node.report_count === 1 ? "report" : "reports"}`;

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasReports ? open : undefined}
      className="org-chart-item"
    >
      <div
        className="org-chart-row"
        style={rowStyle}
      >
        {hasReports && !filtering ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="org-chart-disclosure"
            onClick={() => onToggle(node.id)}
            aria-label={`${open ? "Collapse" : "Expand"} reports for ${node.name ?? "person"}`}
            aria-expanded={open}
          >
            {open ? <ChevronDown /> : <ChevronRight />}
          </Button>
        ) : <span className="org-chart-disclosure-spacer" aria-hidden="true" />}
        <PersonAvatar node={node} />
        <div className="org-chart-identity">
          <Link to={`/people/${node.id}`} className="org-chart-person-link">
            {node.name ?? "Unnamed person"}
          </Link>
          <span className="org-chart-role">{node.job_title || "Role not set"}</span>
        </div>
        <span className="org-chart-department">{node.department_name || "Department not set"}</span>
        {hasReports ? (
          <span className="org-chart-report-count" aria-label={reportLabel}>
            <Users aria-hidden="true" />
            <span>{node.report_count}</span>
            <span className="org-chart-report-word">direct</span>
          </span>
        ) : <span className="org-chart-report-spacer" aria-hidden="true" />}
      </div>
      {hasReports && open ? (
        <div
          role="group"
          className="org-chart-children"
          style={{
            "--org-chart-parent-depth": Math.min(depth, 7),
            "--org-chart-mobile-parent-depth": Math.min(depth, 4),
          } as CSSProperties}
        >
          {node.reports.map((child) => (
            <ListNode key={child.id} node={child} depth={depth + 1} expanded={expanded} visibleIds={visibleIds} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
