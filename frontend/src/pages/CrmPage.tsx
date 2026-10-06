import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateRangeFields, FilterSelect, ListPagination } from "@/components/ListControls";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileUp, Magnet, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { CrmLead, CrmSummary, RecordPage, User } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useBrand } from "../brand/BrandContext";
import { ConfirmDialog, Empty, ErrorState, ListSkeleton, MetricStrip, PageHead, PromptModal, useToast } from "../components/ui";
import CrmImportDialog from "../components/crm/CrmImportDialog";
import LeadFormDialog from "../components/crm/LeadFormDialog";
import { PRIORITIES, PRIORITY_BADGES, PRIORITY_LABELS, SOURCE_LABELS, STAGES, STAGE_BADGES, STAGE_OPTIONS, followUpState, formatDay, leadName, money, stageLabel, todayUtc } from "../components/crm/crm";
import { useFetch } from "../hooks/useApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const EMPTY_FILTERS = { status: "", source: "", owner: "", company_id: "", priority: "", follow_up: "", tag: "", q: "", after: "", before: "", sort: "newest" };
const FOLLOW_UP_OPTIONS = [{ value: "", label: "Any follow-up" }, { value: "overdue", label: "Overdue" }, { value: "today", label: "Due today" }, { value: "upcoming", label: "Upcoming" }, { value: "none", label: "No follow-up set" }];
const SORT_OPTIONS = [{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "follow_up", label: "Follow-up soonest" }, { value: "value_high", label: "Highest value" }, { value: "value_low", label: "Lowest value" }];

/** A pending "mark as lost" that still needs its reason. */
type LostRequest = { ids: string[]; label: string; bulk: boolean };

export default function CrmPage() {
  const { notify } = useToast();
  const { brands } = useBrand();
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(25);
  const debouncedQ = useDebouncedValue(filters.q);
  const debouncedTag = useDebouncedValue(filters.tag);
  const filter = (key: keyof typeof filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setOffset(0); };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setOffset(0); };
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams({ sort: filters.sort });
    for (const key of ["status", "source", "company_id", "priority", "follow_up", "after", "before"] as const) if (filters[key]) params.set(key, filters[key]);
    if (filters.owner === "unassigned") params.set("unassigned", "true");
    else if (filters.owner === "me") { if (user) params.set("owner_id", user.id); }
    else if (filters.owner) params.set("owner_id", filters.owner);
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    if (debouncedTag.trim()) params.set("tag", debouncedTag.trim());
    return params.toString();
  }, [filters, debouncedQ, debouncedTag, user]);
  const query = `${filterQuery}&limit=${limit}&offset=${offset}`;
  const leads = useFetch<RecordPage<CrmLead>>(`/api/crm/leads/page?${query}`);
  const summary = useFetch<CrmSummary>("/api/crm/summary");
  const directory = useFetch<User[]>("/api/users");
  const sources = useMemo(() => {
    const seen = new Set(Object.keys(summary.data?.by_source ?? {}));
    if (filters.source) seen.add(filters.source);
    return [...seen].sort();
  }, [summary.data, filters.source]);
  const [editing, setEditing] = useState<CrmLead | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<CrmLead | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [losing, setLosing] = useState<LostRequest | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Selection belongs to the list it was made in; any filter or page change clears it.
  const [selection, setSelection] = useState<{ query: string; ids: string[] }>({ query: "", ids: [] });
  const selected = selection.query === query ? selection.ids : [];
  const setSelected = (ids: string[]) => setSelection({ query, ids });
  const reloadAll = () => { void leads.reload(); void summary.reload(); };
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  const rows = leads.data?.items ?? [];
  const today = todayUtc();
  const users = directory.data ?? [];
  const selectedLeads = rows.filter((lead) => selected.includes(lead.id));
  const canBulkDelete = selectedLeads.length > 0 && selectedLeads.every((lead) => lead.can_delete);

  async function changeStatus(lead: CrmLead, next: string) {
    if (next === "lost") { setLosing({ ids: [lead.id], label: leadName(lead), bulk: false }); return; }
    setSavingId(lead.id);
    try { await api(`/api/crm/leads/${lead.id}`, { method: "PATCH", body: { status: next } }); notify(`Saved — ${leadName(lead)} is now ${stageLabel(next)}.`); }
    catch (error) { notify(error instanceof Error ? error.message : "Couldn't save the stage", "error"); }
    finally { setSavingId(null); reloadAll(); }
  }
  async function markLost(request: LostRequest, reason: string) {
    try {
      if (!request.bulk) await api(`/api/crm/leads/${request.ids[0]}`, { method: "PATCH", body: { status: "lost", lost_reason: reason } });
      else await api("/api/crm/leads/bulk", { method: "POST", body: { ids: request.ids, action: "status", status: "lost", lost_reason: reason } });
      notify(`Saved — ${request.label} marked as lost.`);
      if (request.bulk) setSelected([]);
      reloadAll();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Couldn't mark as lost", "error");
      throw error;
    }
  }
  async function bulk(body: Record<string, unknown>, done: string) {
    setBulkSaving(true);
    try { const result = await api<{ updated: number }>("/api/crm/leads/bulk", { method: "POST", body: { ids: selected, ...body } }); notify(`${done} ${result.updated} lead${result.updated === 1 ? "" : "s"}.`); setSelected([]); reloadAll(); }
    catch (error) { notify(error instanceof Error ? error.message : "Bulk update failed", "error"); }
    finally { setBulkSaving(false); }
  }
  function bulkStage(stage: string) {
    if (stage === "lost") setLosing({ ids: selected, label: `${selected.length} lead${selected.length === 1 ? "" : "s"}`, bulk: true });
    else void bulk({ action: "status", status: stage }, `Moved to ${stageLabel(stage)}:`);
  }
  async function syncExisting() {
    setSyncing(true);
    try { const result = await api<{ created: number }>("/api/crm/sync-existing", { method: "POST" }); notify(result.created ? `Imported ${result.created} existing leads.` : "Already up to date."); reloadAll(); }
    catch (error) { notify(error instanceof Error ? error.message : "Sync failed", "error"); }
    finally { setSyncing(false); }
  }
  async function exportCsv() {
    setExporting(true);
    try { await downloadFile(`/api/crm/leads/export?${filterQuery}`, `crm-leads-${today}.csv`); }
    catch (error) { notify(error instanceof Error ? error.message : "Export failed", "error"); }
    finally { setExporting(false); }
  }
  async function remove(lead: CrmLead) { await api(`/api/crm/leads/${lead.id}`, { method: "DELETE" }); notify("Lead deleted."); reloadAll(); }
  async function removeSelected() {
    const result = await api<{ updated: number }>("/api/crm/leads/bulk", { method: "POST", body: { ids: selected, action: "delete" } });
    notify(`Deleted ${result.updated} lead${result.updated === 1 ? "" : "s"}.`); setSelected([]); reloadAll();
  }
  const toggle = (id: string, on: boolean) => setSelected(on ? [...selected, id] : selected.filter((item) => item !== id));
  const allSelected = rows.length > 0 && selected.length === rows.length;

  return <div className="flex min-w-0 flex-col gap-4">
    <PageHead title="Leads (CRM)" subtitle="Find the right leads, assign an owner, follow up on time and move each opportunity forward." action={<div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={syncing} onClick={syncExisting}><RefreshCw data-icon="inline-start" />{syncing ? "Syncing…" : "Sync existing"}</Button>
      <Button type="button" variant="outline" onClick={() => setImporting(true)}><FileUp data-icon="inline-start" />Import</Button>
      <Button type="button" variant="outline" disabled={exporting} onClick={() => void exportCsv()}><Download data-icon="inline-start" />{exporting ? "Exporting…" : "Export CSV"}</Button>
      <Button type="button" onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Add lead</Button>
    </div>} />
    <section aria-label="All leads overview" className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Overview of all leads</p>
      {summary.error ? <ErrorState message={summary.error} onRetry={summary.reload} /> : <MetricStrip items={[
        { value: summary.data?.total ?? "—", label: "Total leads" },
        { value: summary.data ? money(summary.data.open_value) : "—", label: "Open pipeline" },
        { value: summary.data ? money(summary.data.won_value) : "—", label: "Won value" },
        { value: summary.data?.overdue ?? "—", label: "Overdue follow-ups" },
        { value: summary.data?.due_today ?? "—", label: "Follow-ups due today" },
      ]} />}
    </section>
    <Card>
      <CardHeader><CardTitle>Lead filters</CardTitle><CardDescription>Combine filters to narrow your list. Dates use UTC calendar days.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleGroup aria-label="Pipeline stage" variant="outline" spacing={0} className="max-w-full flex-wrap justify-start" value={[filters.status || "all"]} onValueChange={(value) => value[0] && filter("status", value[0] === "all" ? "" : value[0])}>
          <ToggleGroupItem value="all">All stages{summary.data ? ` (${summary.data.total})` : ""}</ToggleGroupItem>
          {STAGES.map((stage) => <ToggleGroupItem key={stage} value={stage}>{stageLabel(stage)}{summary.data ? ` (${summary.data.by_status[stage] ?? 0})` : ""}</ToggleGroupItem>)}
        </ToggleGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field className="sm:col-span-2"><FieldLabel htmlFor="crm-search">Search leads</FieldLabel><Input id="crm-search" placeholder="Name, email, phone, company or notes…" maxLength={300} value={filters.q} onChange={(event) => filter("q", event.target.value)} /></Field>
          <FilterSelect id="crm-follow-up-filter" label="Follow-up" value={filters.follow_up} options={FOLLOW_UP_OPTIONS} onChange={(value) => filter("follow_up", value)} />
          <FilterSelect id="crm-filter-owner" label="Owner" value={filters.owner} options={[{ value: "", label: "All owners" }, { value: "me", label: "Assigned to me" }, { value: "unassigned", label: "Unassigned" }, ...users.map((person) => ({ value: person.id, label: person.display_name ?? person.email ?? "Unnamed owner" }))]} onChange={(value) => filter("owner", value)} />
          <FilterSelect id="crm-filter-priority" label="Priority" value={filters.priority} options={[{ value: "", label: "Any priority" }, ...PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }))]} onChange={(value) => filter("priority", value)} />
          <Field><FieldLabel htmlFor="crm-filter-tag">Tag</FieldLabel><Input id="crm-filter-tag" placeholder="e.g. distributor" maxLength={40} value={filters.tag} onChange={(event) => filter("tag", event.target.value)} /></Field>
          <FilterSelect id="crm-source" label="Source" value={filters.source} options={[{ value: "", label: "All sources" }, ...sources.map((value) => ({ value, label: SOURCE_LABELS[value] ?? value }))]} onChange={(value) => filter("source", value)} />
          <FilterSelect id="crm-filter-brand" label="Brand" value={filters.company_id} options={[{ value: "", label: "All brands" }, ...brands.map((brand) => ({ value: brand.id, label: brand.name }))]} onChange={(value) => filter("company_id", value)} />
          <div className="sm:col-span-2"><DateRangeFields id="crm" after={filters.after} before={filters.before} onChange={filter} /></div>
          <FilterSelect id="crm-sort" label="Sort" value={filters.sort} options={SORT_OPTIONS} onChange={(value) => filter("sort", value)} />
        </FieldGroup>
        {directory.error && <p role="status" className="text-sm text-destructive">Owner names could not load. <Button variant="outline" size="sm" onClick={directory.reload}>Retry owners</Button></p>}
        <div className="flex items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{leads.data ? `${leads.data.total} matching leads` : "Lead list"}</p>{hasFilters && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}</div>
      </CardContent>
    </Card>
    {selected.length > 0 && <Card className="py-3" role="region" aria-label="Bulk actions">
      <CardContent className="flex flex-wrap items-end gap-3 px-4">
        <p className="self-center text-sm font-semibold" role="status">{selected.length} selected</p>
        <BulkSelect id="crm-bulk-owner" label="Assign to" placeholder="Choose owner" disabled={bulkSaving} options={[{ value: "none", label: "Unassigned" }, ...users.map((person) => ({ value: person.id, label: person.display_name ?? person.email ?? "Unnamed owner" }))]} onChange={(value) => void bulk({ action: "assign", owner_id: value === "none" ? null : value }, "Assigned")} />
        <BulkSelect id="crm-bulk-stage" label="Move to stage" placeholder="Choose stage" disabled={bulkSaving} options={STAGE_OPTIONS} onChange={bulkStage} />
        {canBulkDelete && <Button type="button" variant="destructive" className="border-destructive/40 bg-background hover:bg-background dark:bg-background dark:hover:bg-background" disabled={bulkSaving} onClick={() => setBulkDeleting(true)}><Trash2 data-icon="inline-start" />Delete</Button>}
        <Button type="button" variant="ghost" onClick={() => setSelected([])}><X data-icon="inline-start" />Clear selection</Button>
      </CardContent>
    </Card>}
    <Card className="py-0">
      <CardContent className="p-0">
        {leads.loading ? <ListSkeleton rows={6} /> : leads.error ? <ErrorState message={leads.error} onRetry={leads.reload} /> : !rows.length ? <Empty icon={<Magnet />} message={hasFilters ? "No matching leads" : "No leads yet"} hint={hasFilters ? "Try changing or clearing your filters." : "Add a lead or import existing contacts to start your pipeline."} action={hasFilters ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : <Button onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Add lead</Button>} /> : <>
          <div className="grid gap-3 p-4 lg:hidden">
            <Field orientation="horizontal"><Checkbox id="crm-select-page" checked={allSelected} onCheckedChange={(on) => setSelected(on ? rows.map((lead) => lead.id) : [])} /><FieldLabel htmlFor="crm-select-page">Select all on this page</FieldLabel></Field>
            {rows.map((lead) => <Card key={lead.id} className="py-3"><CardContent className="flex min-w-0 flex-col gap-3 px-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2"><Checkbox className="mt-1" aria-label={`Select ${leadName(lead)}`} checked={selected.includes(lead.id)} onCheckedChange={(on) => toggle(lead.id, on)} /><LeadLink lead={lead} /></div>
                <Badge variant={STAGE_BADGES[lead.status] ?? "secondary"}>{stageLabel(lead.status)}</Badge>
              </div>
              {lead.company && <p className="break-words text-sm">{lead.company}</p>}
              <p className="break-all text-xs text-muted-foreground">{[lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
              <LeadMeta lead={lead} />
              <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Owner</dt><dd className="break-words">{lead.owner_name ?? "Unassigned"}</dd></div><div><dt className="text-xs text-muted-foreground">Value</dt><dd>{money(lead.value)}</dd></div><div><dt className="text-xs text-muted-foreground">Follow-up</dt><dd><FollowUp lead={lead} today={today} /></dd></div><div><dt className="text-xs text-muted-foreground">Source</dt><dd className="break-words">{SOURCE_LABELS[lead.source] ?? lead.source}</dd></div></dl>
              <LeadStage lead={lead} saving={savingId !== null} onChange={changeStatus} />
              <LeadActions lead={lead} disabled={savingId === lead.id} onEdit={setEditing} onDelete={setDeleting} />
            </CardContent></Card>)}
          </div>
          <div className="hidden lg:block"><Table className="min-w-[1000px]"><TableHeader><TableRow>
            <TableHead className="w-10"><Checkbox aria-label="Select all leads on this page" checked={allSelected} indeterminate={selected.length > 0 && !allSelected} onCheckedChange={(on) => setSelected(on ? rows.map((lead) => lead.id) : [])} /></TableHead>
            <TableHead>Lead</TableHead><TableHead>Stage</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Follow-up</TableHead><TableHead>Source</TableHead><TableHead className="sticky right-0 z-10 bg-table-header text-right">Actions</TableHead>
          </TableRow></TableHeader><TableBody>{rows.map((lead) => <TableRow key={lead.id} data-state={selected.includes(lead.id) ? "selected" : undefined}>
            <TableCell><Checkbox aria-label={`Select ${leadName(lead)}`} checked={selected.includes(lead.id)} onCheckedChange={(on) => toggle(lead.id, on)} /></TableCell>
            <TableCell className="max-w-72 whitespace-normal"><LeadLink lead={lead} /><p className="break-words text-xs text-muted-foreground">{[lead.company, lead.email, lead.phone].filter(Boolean).join(" · ")}</p><LeadMeta lead={lead} /></TableCell>
            <TableCell><LeadStage lead={lead} saving={savingId !== null} onChange={changeStatus} /></TableCell>
            <TableCell className="max-w-36 whitespace-normal">{lead.owner_name ?? "Unassigned"}</TableCell>
            <TableCell className="text-right tabular-nums">{money(lead.value)}</TableCell>
            <TableCell className="max-w-48 whitespace-normal"><FollowUp lead={lead} today={today} />{lead.next_step && <p className="break-words text-xs text-muted-foreground">{lead.next_step}</p>}</TableCell>
            <TableCell className="max-w-48 whitespace-normal"><Badge variant="secondary">{SOURCE_LABELS[lead.source] ?? lead.source}</Badge>{lead.source_detail && <p className="break-words text-xs text-muted-foreground">{lead.source_detail}</p>}<p className="text-xs text-muted-foreground">Added {new Date(lead.created_at).toLocaleDateString()}</p></TableCell>
            <TableCell className="sticky right-0 bg-card"><LeadActions lead={lead} disabled={savingId === lead.id} onEdit={setEditing} onDelete={setDeleting} /></TableCell>
          </TableRow>)}</TableBody></Table></div>
        </>}
      </CardContent>
      {!leads.error && <ListPagination id="crm" total={leads.data?.total ?? 0} offset={leads.data?.offset ?? offset} limit={limit} loading={leads.loading || filters.q !== debouncedQ || filters.tag !== debouncedTag} onPage={setOffset} onPageSize={(size) => { setLimit(size); setOffset(0); }} />}
    </Card>
    {(adding || editing) && <LeadFormDialog lead={editing} users={users} onClose={() => { setAdding(false); setEditing(null); }} onSaved={reloadAll} />}
    {importing && <CrmImportDialog onClose={() => setImporting(false)} onImported={reloadAll} />}
    {losing && <PromptModal title={`Mark ${losing.label} as lost`} label="Why was it lost?" placeholder="e.g. Chose another supplier" submitLabel="Mark as lost" onConfirm={(reason) => markLost(losing, reason)} onClose={() => setLosing(null)} />}
    {deleting && <ConfirmDialog title="Delete lead" message={`Delete ${leadName(deleting)}? Its timeline is deleted too. This cannot be undone.`} confirmLabel="Delete" danger onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
    {bulkDeleting && <ConfirmDialog title="Delete leads" message={`Delete ${selected.length} selected lead${selected.length === 1 ? "" : "s"} and their timelines? This cannot be undone.`} confirmLabel="Delete" danger onConfirm={removeSelected} onClose={() => setBulkDeleting(false)} />}
  </div>;
}

function BulkSelect({ id, label, placeholder, options, disabled, onChange }: { id: string; label: string; placeholder: string; options: { value: string; label: string }[]; disabled: boolean; onChange: (value: string) => void }) {
  // Always shows the placeholder: choosing an option applies it immediately.
  return <Field className="w-full sm:w-52">
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select items={options} value={null} disabled={disabled} onValueChange={(value) => value && onChange(value)}>
      <SelectTrigger id={id} className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent><SelectGroup>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </Field>;
}

function LeadLink({ lead }: { lead: CrmLead }) {
  return <Link to={`/crm/${lead.id}`} className="min-w-0 break-words font-semibold text-foreground underline-offset-4 hover:underline">{leadName(lead)}</Link>;
}

function LeadMeta({ lead }: { lead: CrmLead }) {
  const tags = lead.tags ?? [];
  if (!lead.priority && !tags.length) return null;
  return <div className="mt-1 flex flex-wrap gap-1">
    {lead.priority && <Badge variant={PRIORITY_BADGES[lead.priority] ?? "secondary"}>{PRIORITY_LABELS[lead.priority] ?? lead.priority} priority</Badge>}
    {tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
  </div>;
}

function FollowUp({ lead, today }: { lead: CrmLead; today: string }) {
  const state = followUpState(lead, today);
  if (!lead.follow_up_date) return <span className="text-muted-foreground">—</span>;
  if (state === "overdue") return <Badge variant="destructive">Overdue · {formatDay(lead.follow_up_date)}</Badge>;
  if (state === "today") return <Badge variant="warning">Today</Badge>;
  return <span className={state ? undefined : "text-muted-foreground"}>{formatDay(lead.follow_up_date)}</span>;
}

function LeadStage({ lead, saving, onChange }: { lead: CrmLead; saving: boolean; onChange: (lead: CrmLead, status: string) => void }) {
  return <Select items={STAGE_OPTIONS} value={lead.status} disabled={saving} onValueChange={(value) => value !== null && value !== lead.status && onChange(lead, value)}>
    <SelectTrigger className="w-full min-w-32" aria-label={`Stage for ${leadName(lead)}`}><SelectValue /></SelectTrigger>
    <SelectContent><SelectGroup>{STAGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>;
}

function LeadActions({ lead, disabled, onEdit, onDelete }: { lead: CrmLead; disabled: boolean; onEdit: (lead: CrmLead) => void; onDelete: (lead: CrmLead) => void }) {
  const name = leadName(lead);
  return <div className="flex flex-nowrap justify-end gap-2">
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onEdit(lead)} aria-label={`Edit ${name}`}><Pencil data-icon="inline-start" />Edit</Button>
    {lead.can_delete && <Button type="button" variant="destructive" className="border-destructive/40 bg-background hover:bg-background dark:bg-background dark:hover:bg-background" size="sm" disabled={disabled} onClick={() => onDelete(lead)} aria-label={`Delete ${name}`}><Trash2 data-icon="inline-start" />Delete</Button>}
  </div>;
}
