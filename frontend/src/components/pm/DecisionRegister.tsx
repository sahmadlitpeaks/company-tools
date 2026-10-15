import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { canEdit, type PmIssue, type PmMember, type PmProject } from "@/api/pm";
import { DECISION_CATEGORIES, DECISION_STATUSES, decisionLabel, type DecisionPage } from "@/api/pm-decisions";
import { DateRangeFields, FilterSelect, ListPagination } from "@/components/ListControls";
import { Empty, ErrorState, Loading } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { useFetch } from "@/hooks/useApi";
import { DecisionForm } from "./DecisionForm";

export function DecisionStatus({ status }: { status: string }) {
  return <Badge variant={status === "approved" ? "success" : status === "rejected" ? "destructive" : status === "pending_approval" ? "warning" : "secondary"}>
    {decisionLabel(DECISION_STATUSES, status)}
  </Badge>;
}
export function DecisionRegister({ project, members, issues }: { project: PmProject; members: PmMember[]; issues: PmIssue[] }) {
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(params);
  useEffect(() => { latestParams.current = params; }, [params]);
  const [creating, setCreating] = useState(false);
  const filter = (name: string) => params.get(`d_${name}`) ?? "";
  const limit = [10, 25, 50, 100].includes(Number(filter("limit"))) ? Number(filter("limit")) : 25;
  const offset = Math.max(0, Number(filter("offset")) || 0);
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  for (const name of ["q", "status", "category", "owner_id", "approver_id", "proposed_by_id", "after", "before"]) if (filter(name)) query.set(name, filter(name));
  const list = useFetch<DecisionPage>(`/api/pm/projects/${project.id}/decisions?${query}`, true);
  function updateParams(update: (next: URLSearchParams) => void, replace = false) {
    // Router search-parameter callbacks do not queue updates like React state.
    const next = new URLSearchParams(latestParams.current);
    update(next);
    latestParams.current = next;
    setParams(next, { replace });
  }
  function change(name: string, value: string) {
    updateParams((next) => { if (value) next.set(`d_${name}`, value); else next.delete(`d_${name}`); if (name !== "offset") next.delete("d_offset"); }, name === "q");
  }
  function href(id: string) { const next = new URLSearchParams(params); next.delete("issue"); next.set("decision", id); return `?${next}`; }
  const people = members.map((m) => ({ value: m.user_id, label: m.name }));
  const advancedCount = ["owner_id", "approver_id", "proposed_by_id", "after", "before"].filter((name) => filter(name)).length;
  const [filtersOpen, setFiltersOpen] = useState(advancedCount > 0);
  return <section aria-label="Decision register" className="flex flex-col gap-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Decisions</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Find what was agreed, why, who approved it and the work it affects.</p></div>
      {canEdit(project.my_role) && project.status === "active" && <Button onClick={() => setCreating(true)}><Plus data-icon="inline-start" />Create decision</Button>}
    </div>
    <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field className="sm:col-span-2"><FieldLabel htmlFor="decision-search">Search decisions or linked issue key</FieldLabel><Input id="decision-search" type="search" value={filter("q")} placeholder="Decision key, title, text or issue key" onChange={(e) => change("q", e.target.value)} /></Field>
      <FilterSelect id="decision-filter-status" label="Decision status" value={filter("status")} options={[{ value: "", label: "All statuses" }, ...DECISION_STATUSES]} onChange={(v) => change("status", v)} />
      <FilterSelect id="decision-filter-category" label="Decision category" value={filter("category")} options={[{ value: "", label: "All categories" }, ...DECISION_CATEGORIES]} onChange={(v) => change("category", v)} />
    </FieldGroup>
    <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
      <div className="flex flex-wrap gap-2">
        <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>More filters{advancedCount ? ` (${advancedCount} applied)` : ""}<ChevronDown data-icon="inline-end" /></CollapsibleTrigger>
        <Button variant="ghost" size="sm" onClick={() => updateParams((next) => { for (const key of [...next.keys()]) if (key.startsWith("d_")) next.delete(key); })}>Clear filters</Button>
      </div>
      <CollapsibleContent className="pt-4"><FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <FilterSelect id="decision-filter-owner" label="Decision owner" value={filter("owner_id")} options={[{ value: "", label: "All owners" }, ...people]} onChange={(v) => change("owner_id", v)} />
      <FilterSelect id="decision-filter-approver" label="Decision approver" value={filter("approver_id")} options={[{ value: "", label: "All approvers" }, ...people]} onChange={(v) => change("approver_id", v)} />
      <FilterSelect id="decision-filter-proposer" label="Proposed by" value={filter("proposed_by_id")} options={[{ value: "", label: "All proposers" }, ...people]} onChange={(v) => change("proposed_by_id", v)} />
      <div className="sm:col-span-2"><DateRangeFields id="decision-created" after={filter("after")} before={filter("before")} onChange={change} /></div>
      </FieldGroup><p className="mt-2 text-xs text-muted-foreground">Date filters use the date the decision was created, in UTC.</p></CollapsibleContent>
    </Collapsible>
    {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : !list.data.items.length ?
      <Empty message={list.data.total ? "No decisions on this page" : "No decisions found"} hint="Create a decision or adjust the search and filters." /> : <>
        <TableSurface className="hidden md:block"><Table><TableHeader><TableRow>
          <TableHead>Decision</TableHead><TableHead>Status</TableHead><TableHead>Category</TableHead><TableHead>Owner / Approver</TableHead><TableHead>Updated</TableHead>
        </TableRow></TableHeader><TableBody>{list.data.items.map((row) => <TableRow key={row.id}>
          <TableCell className="max-w-md whitespace-normal"><Link to={href(row.id)} className="font-medium underline-offset-4 hover:underline"><span className="block text-xs text-muted-foreground">{row.key}</span><span className="break-words">{row.title}</span></Link></TableCell>
          <TableCell><DecisionStatus status={row.status} /></TableCell><TableCell>{decisionLabel(DECISION_CATEGORIES, row.category)}</TableCell>
          <TableCell className="whitespace-normal"><span className="block">{row.owner_name ?? "Former employee"}</span><span className="block text-xs text-muted-foreground">Approver: {row.approver_name ?? "Not assigned"}</span></TableCell>
          <TableCell>{new Date(row.updated_at).toLocaleDateString()}</TableCell>
        </TableRow>)}</TableBody></Table></TableSurface>
        <ul className="flex flex-col divide-y divide-border border border-border md:hidden">{list.data.items.map((row) => <li key={row.id} className="flex min-w-0 flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{row.key}</span><DecisionStatus status={row.status} /></div>
          <Link to={href(row.id)} className="break-words font-medium underline-offset-4 hover:underline">{row.title}</Link>
          <p className="text-sm text-muted-foreground">{decisionLabel(DECISION_CATEGORIES, row.category)} · Owner: {row.owner_name ?? "Former employee"}</p>
          <p className="text-sm text-muted-foreground">Approver: {row.approver_name ?? "Not assigned"} · Updated {new Date(row.updated_at).toLocaleDateString()}</p>
        </li>)}</ul>
      </>}
    {list.data && <ListPagination id="decisions" total={list.data.total} offset={offset} limit={limit} loading={list.loading} onPage={(v) => change("offset", String(v))} onPageSize={(v) => change("limit", String(v))} />}
    {creating && <DecisionForm project={project} members={members} issues={issues} onClose={() => setCreating(false)} onSaved={(row) => {
      setCreating(false); void list.reload(); updateParams((next) => { next.set("decision", row.id); });
    }} />}
  </section>;
}
