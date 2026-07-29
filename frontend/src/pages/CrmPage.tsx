import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useMemo, useRef, useState } from "react";
import { Magnet } from "lucide-react";
import { api } from "../api/client";
import type { CrmLead, CrmSummary, User } from "../api/types";
import { useBrand } from "../brand/BrandContext";
import { ConfirmDialog, Empty, ErrorState, ListSkeleton, MetricStrip, Modal, PageHead, useToast } from "../components/ui";
import { useFetch } from "../hooks/useApi";

const STATUSES = ["new", "contacted", "qualified", "won", "lost"];

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
      <form onSubmit={save} className="flex flex-col gap-5">
        <FieldGroup>
          {[["name", "Name"], ["company", "Company"], ["email", "Email"], ["phone", "Phone"]].reduce<React.ReactNode[]>((rows, _, index, all) => { if (index % 2 === 0) rows.push(<div className="grid gap-4 sm:grid-cols-2" key={all[index][0]}>{all.slice(index, index + 2).map(([key, label]) => <Field key={key}><FieldLabel htmlFor={`crm-${key}`}>{label}</FieldLabel><Input id={`crm-${key}`} value={form[key as keyof typeof form]} onChange={(event) => set(key, event.target.value)} /></Field>)}</div>); return rows; }, [])}
          <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="crm-status">Status</FieldLabel><Select items={STATUSES.map((status) => ({ value: status, label: status }))} value={form.status} onValueChange={(value) => set("status", value ?? "")}><SelectTrigger className="w-full" id="crm-status"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="crm-value">Deal value</FieldLabel><Input id="crm-value" type="number" step="0.01" value={form.value} onChange={(event) => set("value", event.target.value)} /></Field></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="crm-owner">Owner</FieldLabel><Select items={[{ value: null, label: "Unassigned" }, ...users.map((user) => ({ value: user.id, label: user.display_name ?? user.email }))]} value={form.owner_id || null} onValueChange={(value) => set("owner_id", value ?? "")}><SelectTrigger className="w-full" id="crm-owner"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>Unassigned</SelectItem>{users.map((user) => <SelectItem key={user.id} value={user.id}>{user.display_name ?? user.email}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="crm-brand">Brand</FieldLabel><Select items={[{ value: null, label: "—" }, ...brands.map((brand) => ({ value: brand.id, label: brand.name }))]} value={form.company_id || null} onValueChange={(value) => set("company_id", value ?? "")}><SelectTrigger className="w-full" id="crm-brand"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>—</SelectItem>{brands.map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></div>
          <Field><FieldLabel htmlFor="crm-notes">Notes</FieldLabel><Textarea id="crm-notes" rows={3} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
        </FieldGroup>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving…" : lead ? "Save" : "Add lead"}</Button></div>
      </form>
    </Modal>
  );
}

export default function CrmPage() {
  const { notify } = useToast();
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const query = useMemo(() => { const params = new URLSearchParams(); if (status) params.set("status", status); if (source) params.set("source", source); if (q) params.set("q", q); const value = params.toString(); return value ? `?${value}` : ""; }, [status, source, q]);
  const leads = useFetch<CrmLead[]>(`/api/crm/leads${query}`);
  const summary = useFetch<CrmSummary>("/api/crm/summary");
  const directory = useFetch<User[]>("/api/users");
  const importRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<CrmLead | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<CrmLead | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const reloadAll = () => { leads.reload(); summary.reload(); };

  async function changeStatus(lead: CrmLead, next: string) { setSavingId(lead.id); try { await api(`/api/crm/leads/${lead.id}`, { method: "PATCH", body: { status: next } }); notify(`Saved - ${lead.name ?? "lead"} is now ${next}.`); } catch (error) { notify(error instanceof Error ? error.message : "Couldn't save status", "error"); } finally { setSavingId(null); reloadAll(); } }
  async function syncExisting() { const result = await api<{ created: number }>("/api/crm/sync-existing", { method: "POST" }); notify(result.created ? `Imported ${result.created} existing leads.` : "Already up to date."); reloadAll(); }
  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const body = new FormData(); body.append("file", file); try { const result = await api<{ created: number }>("/api/crm/import", { method: "POST", form: body }); notify(`Imported ${result.created} leads.`); reloadAll(); } catch (error) { notify(error instanceof Error ? error.message : "Import failed", "error"); } if (importRef.current) importRef.current.value = ""; }
  async function remove(lead: CrmLead) { await api(`/api/crm/leads/${lead.id}`, { method: "DELETE" }); notify("Lead deleted."); reloadAll(); }

  return (
    <div>
      <PageHead title="Leads (CRM)" subtitle="Every lead from cards, landing pages, imports and manual entry in one pipeline." action={<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={syncExisting}>Sync existing</Button><Button type="button" variant="outline" onClick={() => importRef.current?.click()}>Import CSV</Button><Button type="button" onClick={() => setAdding(true)}>+ Add lead</Button><Input ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} /></div>} />
      <div className="mb-5"><MetricStrip items={[{ value: summary.data?.total ?? "—", label: "Total leads" }, { value: summary.data?.by_status?.new ?? 0, label: "New" }, { value: summary.data ? money(summary.data.open_value) : "—", label: "Open pipeline" }, { value: summary.data ? money(summary.data.won_value) : "—", label: "Won value" }]} /></div>
      <Card className="mb-4"><CardContent className="grid items-end gap-4 sm:grid-cols-5"><Field className="sm:col-span-3"><FieldLabel htmlFor="crm-search">Search</FieldLabel><Input id="crm-search" placeholder="Name, email, company…" value={q} onChange={(event) => setQ(event.target.value)} /></Field><Field><FieldLabel htmlFor="crm-filter-status">Status</FieldLabel><Select items={[{ value: null, label: "All" }, ...STATUSES.map((value) => ({ value, label: value }))]} value={status || null} onValueChange={(value) => setStatus(value ?? "")}><SelectTrigger className="w-full" id="crm-filter-status"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>All</SelectItem>{STATUSES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="crm-source">Source</FieldLabel><Select items={[{ value: null, label: "All" }, ...["card", "landing", "manual", "import"].map((value) => ({ value, label: value }))]} value={source || null} onValueChange={(value) => setSource(value ?? "")}><SelectTrigger className="w-full" id="crm-source"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>All</SelectItem>{["card", "landing", "manual", "import"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></CardContent></Card>
       {leads.loading ? <ListSkeleton rows={6} /> : leads.error ? <ErrorState message={leads.error} onRetry={leads.reload} /> : !leads.data?.length ? <Empty icon={<Magnet />} message="No leads yet" hint="Leads from cards and landing forms arrive here automatically - or add/import them." action={<Button type="button" onClick={() => setAdding(true)}>+ Add lead</Button>} /> : (
         <Card className="py-0"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Source</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{leads.data.map((lead) => <TableRow key={lead.id}><TableCell className="max-w-[28rem] whitespace-normal"><div className="truncate font-semibold" title={lead.name ?? "—"}>{lead.name ?? "—"}</div><div className="truncate text-xs text-muted-foreground">{[lead.company, lead.email, lead.phone].filter(Boolean).join(" · ")}</div></TableCell><TableCell><Badge variant="secondary">{lead.source}</Badge>{lead.source_detail && <div className="text-xs text-muted-foreground">{lead.source_detail}</div>}</TableCell><TableCell>{lead.owner_name ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{money(lead.value)}</TableCell><TableCell><div className="flex items-center gap-2"><Select items={STATUSES.map((value) => ({ value, label: value }))} value={lead.status} disabled={savingId === lead.id} onValueChange={(value) => value !== null && changeStatus(lead, value)}><SelectTrigger aria-label={`Status for ${lead.name ?? "lead"}`}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{STATUSES.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent></Select>{savingId === lead.id && <span className="text-xs text-muted-foreground">Saving…</span>}</div></TableCell><TableCell><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setEditing(lead)}>Edit</Button><Button type="button" variant="destructive" size="sm" onClick={() => setDeleting(lead)}>Delete</Button></div></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      )}
      {(adding || editing) && <LeadModal lead={editing} users={directory.data ?? []} onClose={() => { setAdding(false); setEditing(null); }} onSaved={reloadAll} />}
      {deleting && <ConfirmDialog title="Delete lead" message={`Delete ${deleting.name ?? "this lead"}?`} confirmLabel="Delete" danger onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
    </div>
  );
}
