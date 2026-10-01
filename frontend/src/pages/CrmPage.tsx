import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DateRangeFields, FilterSelect, ListPagination } from "@/components/ListControls";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useMemo, useRef, useState } from "react";
import { Download, Magnet, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { CrmLead, CrmSummary, RecordPage, User } from "../api/types";
import { useBrand } from "../brand/BrandContext";
import { ConfirmDialog, Empty, ErrorState, ListSkeleton, MetricStrip, Modal, PageHead, useToast } from "../components/ui";
import { useFetch } from "../hooks/useApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const STATUSES = ["new", "contacted", "qualified", "won", "lost"];
const SOURCE_LABELS: Record<string, string> = { web: "website", card: "card", landing: "landing", manual: "manual", import: "import" };
const STATUS_BADGES: Record<string, "info" | "warning" | "success" | "secondary" | "destructive"> = { new: "info", contacted: "warning", qualified: "success", won: "success", lost: "secondary" };

function money(value?: string | null): string {
  if (!value) return "—";
  const number = Number(value);
  return Number.isNaN(number) ? String(value) : number.toLocaleString(undefined, { style: "currency", currency: "AED" });
}

function LeadModal({ lead, users, onClose, onSaved }: { lead: CrmLead | null; users: User[]; onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const { brands } = useBrand();
  const [form, setForm] = useState({ name: lead?.name ?? "", email: lead?.email ?? "", phone: lead?.phone ?? "", company: lead?.company ?? "", status: lead?.status ?? "new", owner_id: lead?.owner_id ?? "", value: lead?.value ?? "", company_id: lead?.company_id ?? "", notes: lead?.notes ?? "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault(); setIsSubmitting(true);
    const body = { name: form.name || null, email: form.email || null, phone: form.phone || null, company: form.company || null, status: form.status, owner_id: form.owner_id || null, value: form.value || null, company_id: form.company_id || null, notes: form.notes || null };
    try { if (lead) await api(`/api/crm/leads/${lead.id}`, { method: "PATCH", body }); else await api("/api/crm/leads", { method: "POST", body }); notify(lead ? "Lead updated." : "Lead added."); onSaved(); onClose(); }
    catch (error) { notify(error instanceof Error ? error.message : "Failed", "error"); } finally { setIsSubmitting(false); }
  }

  return (
    <Modal title={lead ? "Edit lead" : "Add lead"} onClose={onClose}>
      {lead && <div className="mb-4 flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">{SOURCE_LABELS[lead.source] ?? lead.source}{lead.source_detail ? ` · ${lead.source_detail}` : ""} · Added {new Date(lead.created_at).toLocaleDateString()}</p>
        {lead.page_url && /^https?:\/\//i.test(lead.page_url) && <a className="text-foreground underline" href={lead.page_url} target="_blank" rel="noreferrer">View source page</a>}
        {Boolean(lead.fields?.length) && <dl className="grid gap-2 border p-3">{lead.fields?.map((field) => <div key={field.key}><dt className="text-xs text-muted-foreground">{field.label}</dt><dd className="break-words whitespace-pre-wrap">{field.value}</dd></div>)}</dl>}
      </div>}
      <form onSubmit={save} className="flex flex-col gap-5">
        <FieldGroup>
          {[["name", "Name"], ["company", "Company"], ["email", "Email"], ["phone", "Phone"]].reduce<React.ReactNode[]>((rows, _, index, all) => { if (index % 2 === 0) rows.push(<div className="grid gap-4 sm:grid-cols-2" key={all[index][0]}>{all.slice(index, index + 2).map(([key, label]) => <Field key={key}><FieldLabel htmlFor={`crm-${key}`}>{label}</FieldLabel><Input id={`crm-${key}`} value={form[key as keyof typeof form]} onChange={(event) => set(key, event.target.value)} /></Field>)}</div>); return rows; }, [])}
          <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="crm-status">Status</FieldLabel><Select items={STATUSES.map((status) => ({ value: status, label: status }))} value={form.status} onValueChange={(value) => set("status", value ?? "")}><SelectTrigger className="w-full" id="crm-status"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="crm-value">Deal value</FieldLabel><Input id="crm-value" type="number" step="0.01" value={form.value} onChange={(event) => set("value", event.target.value)} /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="crm-owner">Owner</FieldLabel><Select items={[{ value: null, label: "Unassigned" }, ...users.map((user) => ({ value: user.id, label: user.display_name ?? user.email ?? "Unnamed owner" }))]} value={form.owner_id || null} onValueChange={(value) => set("owner_id", value ?? "")}><SelectTrigger className="w-full" id="crm-owner"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Unassigned</SelectItem>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.display_name ?? user.email}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="crm-brand">Brand</FieldLabel><Select items={[{ value: null, label: "—" }, ...brands.map((brand) => ({ value: brand.id, label: brand.name }))]} value={form.company_id || null} onValueChange={(value) => set("company_id", value ?? "")}><SelectTrigger className="w-full" id="crm-brand"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>—</SelectItem>{brands.map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></div>
          <Field><FieldLabel htmlFor="crm-notes">Notes</FieldLabel><Textarea id="crm-notes" rows={3} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
        </FieldGroup>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : lead ? "Save" : "Add lead"}</Button></div>
      </form>
    </Modal>
  );
}

export default function CrmPage() {
  const { notify } = useToast();
  const { brands } = useBrand();
  const [filters, setFilters] = useState({ status: "", source: "", owner: "", company_id: "", q: "", after: "", before: "", sort: "newest" });
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(25);
  const debouncedQ = useDebouncedValue(filters.q);
  const filter = (key: keyof typeof filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setOffset(0); };
  const clearFilters = () => { setFilters({ status: "", source: "", owner: "", company_id: "", q: "", after: "", before: "", sort: "newest" }); setOffset(0); };
  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sort: filters.sort });
    for (const key of ["status", "source", "company_id", "after", "before"] as const) if (filters[key]) params.set(key, filters[key]);
    if (filters.owner === "unassigned") params.set("unassigned", "true");
    else if (filters.owner) params.set("owner_id", filters.owner);
    if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
    return params.toString();
  }, [filters, debouncedQ, offset, limit]);
  const leads = useFetch<RecordPage<CrmLead>>(`/api/crm/leads/page?${query}`);
  const summary = useFetch<CrmSummary>("/api/crm/summary");
  const directory = useFetch<User[]>("/api/users");
  const sources = useMemo(() => {
    const seen = new Set(Object.keys(summary.data?.by_source ?? {}));
    if (filters.source) seen.add(filters.source);
    return [...seen].sort();
  }, [summary.data, filters.source]);
  const importRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<CrmLead | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<CrmLead | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const reloadAll = () => { void leads.reload(); void summary.reload(); };
  const hasFilters = Boolean(filters.status || filters.source || filters.owner || filters.company_id || filters.q || filters.after || filters.before || filters.sort !== "newest");
  const rows = leads.data?.items ?? [];

  async function changeStatus(lead: CrmLead, next: string) {
    setSavingId(lead.id);
    try { await api(`/api/crm/leads/${lead.id}`, { method: "PATCH", body: { status: next } }); notify(`Saved — ${lead.name ?? "lead"} is now ${next}.`); }
    catch (error) { notify(error instanceof Error ? error.message : "Couldn't save status", "error"); }
    finally { setSavingId(null); reloadAll(); }
  }
  async function syncExisting() {
    setSyncing(true);
    try { const result = await api<{ created: number }>("/api/crm/sync-existing", { method: "POST" }); notify(result.created ? `Imported ${result.created} existing leads.` : "Already up to date."); reloadAll(); }
    catch (error) { notify(error instanceof Error ? error.message : "Sync failed", "error"); }
    finally { setSyncing(false); }
  }
  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const body = new FormData(); body.append("file", file); setImporting(true);
    try { const result = await api<{ created: number }>("/api/crm/import", { method: "POST", form: body }); notify(`Imported ${result.created} leads.`); reloadAll(); }
    catch (error) { notify(error instanceof Error ? error.message : "Import failed", "error"); }
    finally { setImporting(false); if (importRef.current) importRef.current.value = ""; }
  }
  async function remove(lead: CrmLead) { await api(`/api/crm/leads/${lead.id}`, { method: "DELETE" }); notify("Lead deleted."); reloadAll(); }

  return <div className="flex min-w-0 flex-col gap-4">
    <PageHead title="Leads (CRM)" subtitle="Find the right leads, assign an owner, and move each opportunity forward." action={<div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={syncing} onClick={syncExisting}><RefreshCw data-icon="inline-start" />{syncing ? "Syncing…" : "Sync existing"}</Button>
      <Button type="button" variant="outline" disabled={importing} onClick={() => importRef.current?.click()}><Download data-icon="inline-start" />{importing ? "Importing…" : "Import CSV"}</Button>
      <Button type="button" onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Add lead</Button>
      <input ref={importRef} type="file" accept=".csv" hidden aria-label="Import leads CSV file" onChange={importCsv} />
    </div>} />
    <section aria-label="All leads overview" className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Overview of all leads</p>
      {summary.error ? <ErrorState message={summary.error} onRetry={summary.reload} /> : <MetricStrip items={[{ value: summary.data?.total ?? "—", label: "Total leads" }, { value: summary.data?.by_status?.new ?? "—", label: "New" }, { value: summary.data ? money(summary.data.open_value) : "—", label: "Open pipeline" }, { value: summary.data ? money(summary.data.won_value) : "—", label: "Won value" }]} />}
    </section>
    <Card>
      <CardHeader><CardTitle>Lead filters</CardTitle><CardDescription>Combine filters to narrow your list. Dates use UTC calendar days.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleGroup aria-label="Pipeline stage" variant="outline" spacing={0} className="max-w-full flex-wrap justify-start" value={[filters.status || "all"]} onValueChange={(value) => value[0] && filter("status", value[0] === "all" ? "" : value[0])}>
          <ToggleGroupItem value="all">All stages{summary.data ? ` (${summary.data.total})` : ""}</ToggleGroupItem>
          {STATUSES.map((stage) => <ToggleGroupItem key={stage} value={stage}>{stage.charAt(0).toUpperCase() + stage.slice(1)}{summary.data ? ` (${summary.data.by_status[stage] ?? 0})` : ""}</ToggleGroupItem>)}
        </ToggleGroup>
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field className="sm:col-span-2"><FieldLabel htmlFor="crm-search">Search leads</FieldLabel><Input id="crm-search" placeholder="Name, email, phone, company or notes…" maxLength={300} value={filters.q} onChange={(event) => filter("q", event.target.value)} /></Field>
          <FilterSelect id="crm-source" label="Source" value={filters.source} options={[{ value: "", label: "All sources" }, ...sources.map((value) => ({ value, label: SOURCE_LABELS[value] ?? value }))]} onChange={(value) => filter("source", value)} />
          <FilterSelect id="crm-filter-owner" label="Owner" value={filters.owner} options={[{ value: "", label: "All owners" }, { value: "unassigned", label: "Unassigned" }, ...(directory.data ?? []).map((user) => ({ value: user.id, label: user.display_name ?? user.email ?? "Unnamed owner" }))]} onChange={(value) => filter("owner", value)} />
          <FilterSelect id="crm-filter-brand" label="Brand" value={filters.company_id} options={[{ value: "", label: "All brands" }, ...brands.map((brand) => ({ value: brand.id, label: brand.name }))]} onChange={(value) => filter("company_id", value)} />
          <div className="sm:col-span-2"><DateRangeFields id="crm" after={filters.after} before={filters.before} onChange={filter} /></div>
          <FilterSelect id="crm-sort" label="Sort" value={filters.sort} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "value_high", label: "Highest value" }, { value: "value_low", label: "Lowest value" }]} onChange={(value) => filter("sort", value)} />
        </FieldGroup>
        {directory.error && <p role="status" className="text-sm text-destructive">Owner names could not load. <Button variant="outline" size="sm" onClick={directory.reload}>Retry owners</Button></p>}
        <div className="flex items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{leads.data ? `${leads.data.total} matching leads` : "Lead list"}</p>{hasFilters && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}</div>
      </CardContent>
    </Card>
    <Card className="py-0">
      <CardContent className="p-0">
        {leads.loading ? <ListSkeleton rows={6} /> : leads.error ? <ErrorState message={leads.error} onRetry={leads.reload} /> : !rows.length ? <Empty icon={<Magnet />} message={hasFilters ? "No matching leads" : "No leads yet"} hint={hasFilters ? "Try changing or clearing your filters." : "Add a lead or import existing contacts to start your pipeline."} action={hasFilters ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : <Button onClick={() => setAdding(true)}><Plus data-icon="inline-start" />Add lead</Button>} /> : <>
          <div className="grid gap-3 p-4 lg:hidden">{rows.map((lead) => <Card key={lead.id} className="py-3"><CardContent className="flex min-w-0 flex-col gap-3 px-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words font-semibold">{lead.name ?? lead.email ?? "Unnamed lead"}</p><Badge variant={STATUS_BADGES[lead.status] ?? "secondary"}>{lead.status}</Badge></div>
            {lead.company && <p className="break-words text-sm">{lead.company}</p>}
            <p className="break-all text-xs text-muted-foreground">{[lead.email, lead.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Source</dt><dd className="break-words">{SOURCE_LABELS[lead.source] ?? lead.source}{lead.source_detail && ` · ${lead.source_detail}`}</dd></div><div><dt className="text-xs text-muted-foreground">Owner</dt><dd className="break-words">{lead.owner_name ?? "Unassigned"}</dd></div><div><dt className="text-xs text-muted-foreground">Value</dt><dd>{money(lead.value)}</dd></div><div><dt className="text-xs text-muted-foreground">Added</dt><dd>{new Date(lead.created_at).toLocaleDateString()}</dd></div></dl>
            <LeadStatus lead={lead} saving={savingId !== null} onChange={changeStatus} />
            <LeadActions lead={lead} disabled={savingId === lead.id} onEdit={setEditing} onDelete={setDeleting} />
          </CardContent></Card>)}</div>
          <div className="hidden lg:block"><Table className="min-w-[900px]"><TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Source</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead>Added</TableHead><TableHead className="sticky right-0 z-10 bg-table-header text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map((lead) => <TableRow key={lead.id}>
            <TableCell className="max-w-72 whitespace-normal"><p className="break-words font-semibold">{lead.name ?? lead.email ?? "Unnamed lead"}</p><p className="break-words text-xs text-muted-foreground">{[lead.company, lead.email, lead.phone].filter(Boolean).join(" · ")}</p></TableCell>
            <TableCell className="max-w-48 whitespace-normal"><Badge variant="secondary">{SOURCE_LABELS[lead.source] ?? lead.source}</Badge>{lead.source_detail && <p className="break-words text-xs text-muted-foreground">{lead.source_detail}</p>}</TableCell>
            <TableCell className="max-w-36 whitespace-normal">{lead.owner_name ?? "Unassigned"}</TableCell><TableCell className="text-right tabular-nums">{money(lead.value)}</TableCell>
            <TableCell><LeadStatus lead={lead} saving={savingId !== null} onChange={changeStatus} /></TableCell><TableCell className="text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</TableCell>
            <TableCell className="sticky right-0 bg-card"><LeadActions lead={lead} disabled={savingId === lead.id} onEdit={setEditing} onDelete={setDeleting} /></TableCell>
          </TableRow>)}</TableBody></Table></div>
        </>}
      </CardContent>
      {!leads.error && <ListPagination id="crm" total={leads.data?.total ?? 0} offset={leads.data?.offset ?? offset} limit={limit} loading={leads.loading || filters.q !== debouncedQ} onPage={setOffset} onPageSize={(size) => { setLimit(size); setOffset(0); }} />}
    </Card>
    {(adding || editing) && <LeadModal lead={editing} users={directory.data ?? []} onClose={() => { setAdding(false); setEditing(null); }} onSaved={reloadAll} />}
    {deleting && <ConfirmDialog title="Delete lead" message={`Delete ${deleting.name ?? "this lead"}? This cannot be undone.`} confirmLabel="Delete" danger onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
  </div>;
}

function LeadStatus({ lead, saving, onChange }: { lead: CrmLead; saving: boolean; onChange: (lead: CrmLead, status: string) => void }) {
  return <Select items={STATUSES.map((value) => ({ value, label: value }))} value={lead.status} disabled={saving} onValueChange={(value) => value !== null && value !== lead.status && onChange(lead, value)}>
    <SelectTrigger className="w-full min-w-28" aria-label={`Status for ${lead.name ?? lead.email ?? "lead"}`}><SelectValue /></SelectTrigger>
    <SelectContent><SelectGroup>{STATUSES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>;
}

function LeadActions({ lead, disabled, onEdit, onDelete }: { lead: CrmLead; disabled: boolean; onEdit: (lead: CrmLead) => void; onDelete: (lead: CrmLead) => void }) {
  const name = lead.name ?? lead.email ?? "lead";
  return <div className="flex flex-nowrap justify-end gap-2">
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onEdit(lead)} aria-label={`Edit ${name}`}><Pencil data-icon="inline-start" />Edit</Button>
    <Button type="button" variant="destructive" className="border-destructive/40 bg-background hover:bg-background dark:bg-background dark:hover:bg-background" size="sm" disabled={disabled} onClick={() => onDelete(lead)} aria-label={`Delete ${name}`}><Trash2 data-icon="inline-start" />Delete</Button>
  </div>;
}
