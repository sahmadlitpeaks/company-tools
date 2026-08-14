import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSurface } from "@/components/ui/table";
import { useRef, useState } from "react";
import { Camera, Globe2, Megaphone, MessageCircle, Music2, RefreshCw, Search, X, type LucideIcon } from "lucide-react";
import { api } from "../api/client";
import type { Campaign, CampaignBreakdown, CampaignKpis, CampaignMetric, CampaignOverview, SyncResult, SyncRun } from "../api/types";
import { useBrand } from "../brand/BrandContext";
import { ConfirmDialog, Empty, ErrorState, ListSkeleton, MetricStrip, MiniBars, Modal, PageHead, useToast } from "../components/ui";
import SyncStatusStrip from "../components/SyncStatusStrip";
import { useFetch } from "../hooks/useApi";

const CHANNELS = ["facebook", "instagram", "google", "tiktok", "other"];
const CHANNEL_ICON: Record<string, LucideIcon> = { facebook: MessageCircle, instagram: Camera, google: Search, tiktok: Music2, other: Globe2 };
const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary"> = { active: "success", paused: "warning", completed: "secondary" };
const money = (value: string | number) => Number(value).toLocaleString(undefined, { style: "currency", currency: "AED", maximumFractionDigits: 0 });
const num = (value: number) => value.toLocaleString();

function ChannelTable({ rows }: { rows: (CampaignKpis & { channel: string })[] }) {
  if (rows.length === 0) return <Empty message="No channel data yet." />;
  return (
    <Table>
       <TableHeader><TableRow><TableHead>Channel</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Impr.</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">CTR</TableHead><TableHead className="text-right">Conv.</TableHead><TableHead className="text-right">CPA</TableHead><TableHead className="text-right">ROAS</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => {
          const ChannelIcon = CHANNEL_ICON[row.channel] ?? Globe2;
          return <TableRow key={row.channel}>
            <TableCell className="font-semibold capitalize"><ChannelIcon className="mr-1.5 inline-block" aria-hidden="true" />{row.channel}</TableCell>
             <TableCell className="text-right tabular-nums">{money(row.spend)}</TableCell><TableCell className="text-right tabular-nums">{num(row.impressions)}</TableCell><TableCell className="text-right tabular-nums">{num(row.clicks)}</TableCell><TableCell className="text-right tabular-nums">{row.ctr}%</TableCell><TableCell className="text-right tabular-nums">{num(row.conversions)}</TableCell><TableCell className="text-right tabular-nums">{money(row.cpa)}</TableCell>
             <TableCell className="text-right tabular-nums"><Badge variant={row.roas >= 1 ? "success" : "destructive"}>{row.roas}×</Badge></TableCell>
          </TableRow>;
        })}
      </TableBody>
    </Table>
  );
}

function CampaignDetail({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { notify } = useToast();
  const breakdown = useFetch<CampaignBreakdown>(`/api/campaigns/${campaign.id}/breakdown`);
  const metrics = useFetch<CampaignMetric[]>(`/api/campaigns/${campaign.id}/metrics`);
  const importRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ channel: "facebook", date: "", spend: "", impressions: "", clicks: "", conversions: "", revenue: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const reload = () => { breakdown.reload(); metrics.reload(); };

  async function addMetric(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await api(`/api/campaigns/${campaign.id}/metrics`, { method: "POST", body: { channel: form.channel, date: form.date || null, spend: form.spend || "0", impressions: Number(form.impressions || 0), clicks: Number(form.clicks || 0), conversions: Number(form.conversions || 0), revenue: form.revenue || "0" } });
      notify("Metric added.");
      setForm({ ...form, spend: "", impressions: "", clicks: "", conversions: "", revenue: "" });
      reload();
    } catch (error) { notify(error instanceof Error ? error.message : "Failed", "error"); } finally { setIsSubmitting(false); }
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData(); body.append("file", file);
    try { const result = await api<{ created: number }>(`/api/campaigns/${campaign.id}/metrics/import`, { method: "POST", form: body }); notify(`Imported ${result.created} rows.`); reload(); }
    catch (error) { notify(error instanceof Error ? error.message : "Import failed", "error"); }
    if (importRef.current) importRef.current.value = "";
  }

  async function removeMetric(id: string) { await api(`/api/campaigns/${campaign.id}/metrics/${id}`, { method: "DELETE" }); reload(); }
  const totals = breakdown.data?.totals;

  return (
    <Modal title={campaign.name} maxWidth={900} onClose={onClose}>
      {breakdown.loading || !totals ? <ListSkeleton rows={4} /> : (
        <div className="flex flex-col gap-5">
          <MetricStrip items={[{ value: money(totals.spend), label: "Spend" }, { value: num(totals.impressions), label: "Impressions" }, { value: `${totals.ctr}%`, label: "CTR", sub: `${num(totals.clicks)} clicks` }, { value: num(totals.conversions), label: "Conversions", sub: `CPA ${money(totals.cpa)}` }, { value: `${totals.roas}×`, label: "ROAS", sub: money(totals.revenue) }]} />
          {breakdown.data!.series.length > 0 && <Card><CardHeader><CardTitle>Spend over time</CardTitle></CardHeader><CardContent><MiniBars data={breakdown.data!.series.map((item) => ({ date: item.date, count: Number(item.spend) }))} label="Daily spend" /></CardContent></Card>}
           <section><h4 className="mb-2">By channel</h4><TableSurface><ChannelTable rows={breakdown.data!.by_channel} /></TableSurface></section>
          <Card>
            <CardHeader><CardTitle>Add data</CardTitle><CardAction><Button type="button" variant="outline" size="sm" onClick={() => importRef.current?.click()}>Import CSV</Button><Input ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} /></CardAction></CardHeader>
            <CardContent className="flex flex-col gap-4"><p className="text-xs text-muted-foreground">CSV columns: channel, date, spend, impressions, clicks, conversions, revenue</p>
              <form onSubmit={addMetric} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Select items={CHANNELS.map((channel) => ({ value: channel, label: channel }))} value={form.channel} onValueChange={(value) => set("channel", value ?? "")}>
                  <SelectTrigger className="w-full" aria-label="Channel"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{CHANNELS.map((channel) => <SelectItem key={channel} value={channel}>{channel}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <Input aria-label="Date" type="date" value={form.date} onChange={(event) => set("date", event.target.value)} />
                {(["spend", "impressions", "clicks", "conversions", "revenue"] as const).map((key) => <Input key={key} aria-label={key} placeholder={key[0].toUpperCase() + key.slice(1)} value={form[key]} onChange={(event) => set(key, event.target.value)} />)}
                <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Adding…" : "Add row"}</Button>
              </form>
            </CardContent>
          </Card>
           {(metrics.data?.length ?? 0) > 0 && <section><h4 className="mb-2">Rows ({metrics.data!.length})</h4><TableSurface className="max-h-[220px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Source</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Conv.</TableHead><TableHead /></TableRow></TableHeader><TableBody>{metrics.data!.map((metric) => <TableRow key={metric.id}><TableCell className="capitalize">{metric.channel}</TableCell><TableCell><Badge variant={metric.source === "sync" ? "secondary" : "outline"}>{metric.source ?? "manual"}</Badge></TableCell><TableCell>{metric.date ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{money(metric.spend)}</TableCell><TableCell className="text-right tabular-nums">{num(metric.conversions)}</TableCell><TableCell className="text-right"><Button type="button" variant="destructive" size="icon-sm" aria-label="Remove metric" onClick={() => removeMetric(metric.id)}><X data-icon="inline-start" /></Button></TableCell></TableRow>)}</TableBody></Table></TableSurface></section>}
        </div>
      )}
    </Modal>
  );
}

export default function CampaignsPage() {
  const { notify } = useToast();
  const { brands, active } = useBrand();
  const overview = useFetch<CampaignOverview>("/api/campaigns/overview");
  const campaigns = useFetch<Campaign[]>("/api/campaigns");
  const [detail, setDetail] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [form, setForm] = useState({ name: "", objective: "", status: "active", company_id: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const syncRuns = useFetch<SyncRun[]>("/api/campaigns/sync/runs");
  const [syncing, setSyncing] = useState(false);
  const reloadAll = () => { overview.reload(); campaigns.reload(); };

  async function runSync() {
    setSyncing(true);
    try {
      const results = await api<SyncResult[]>("/api/campaigns/sync", { method: "POST" });
      const ran = results.filter((result) => !result.skipped);
      if (ran.length === 0) {
        notify("No ad accounts are connected yet. Add credentials in Settings.", "error");
      } else {
        const rows = ran.reduce((total, result) => total + result.metrics_upserted, 0);
        const failed = ran.filter((result) => !result.ok);
        notify(
          failed.length
            ? `Synced ${rows} rows. ${failed.length} provider(s) failed - see status below.`
            : `Synced ${rows} rows from ${ran.length} provider(s).`,
          failed.length ? "error" : undefined,
        );
      }
      reloadAll();
      syncRuns.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault(); if (!form.name) return; setIsSubmitting(true);
    try { await api("/api/campaigns", { method: "POST", body: { name: form.name, objective: form.objective || null, status: form.status, company_id: form.company_id || active?.id || null } }); notify("Campaign created."); setForm({ name: "", objective: "", status: "active", company_id: "" }); setCreating(false); reloadAll(); }
    catch (error) { notify(error instanceof Error ? error.message : "Failed", "error"); } finally { setIsSubmitting(false); }
  }
  async function remove(campaign: Campaign) { await api(`/api/campaigns/${campaign.id}`, { method: "DELETE" }); notify("Campaign deleted."); reloadAll(); }
  const totals = overview.data?.totals;

  return (
    <div>
      <PageHead title="Campaign Studio" subtitle="Ad performance across channels - upload spend, impressions and conversions to see what's working." action={
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={runSync} disabled={syncing}>
            <RefreshCw data-icon="inline-start" />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
          <Button type="button" onClick={() => setCreating(true)}>+ New campaign</Button>
        </div>
      } />
      {syncRuns.data && syncRuns.data.length > 0 && (
        <div className="mb-4"><SyncStatusStrip runs={syncRuns.data} /></div>
      )}
      {overview.loading || !totals ? <ListSkeleton rows={3} /> : <div className="flex flex-col gap-4"><MetricStrip items={[{ value: money(totals.spend), label: "Total spend" }, { value: num(totals.impressions), label: "Impressions" }, { value: num(totals.clicks), label: "Clicks", sub: `${totals.ctr}% CTR` }, { value: num(totals.conversions), label: "Conversions", sub: `CPA ${money(totals.cpa)}` }, { value: money(totals.revenue), label: "Revenue" }, { value: `${totals.roas}×`, label: "ROAS" }]} /><Card className="py-0"><CardHeader className="py-(--card-spacing)"><CardTitle>Performance by channel</CardTitle></CardHeader><CardContent className="p-0"><ChannelTable rows={overview.data!.by_channel} /></CardContent></Card></div>}
      <h3 className="mt-5">Campaigns</h3>
      {campaigns.loading ? <ListSkeleton rows={4} /> : campaigns.error ? <ErrorState message={campaigns.error} onRetry={campaigns.reload} /> : !campaigns.data?.length ? <Empty icon={<Megaphone />} message="No campaigns yet" hint="Create a campaign, then upload channel performance via CSV or manual entry." action={<Button type="button" onClick={() => setCreating(true)}>+ New campaign</Button>} /> : (
         <Card className="py-0"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Spend</TableHead><TableHead className="text-right">Conv.</TableHead><TableHead className="text-right">ROAS</TableHead><TableHead /></TableRow></TableHeader><TableBody>{campaigns.data.map((campaign) => <TableRow key={campaign.id}><TableCell className="max-w-[28rem] whitespace-normal"><div className="flex items-center gap-2"><div className="truncate font-semibold" title={campaign.name}>{campaign.name}</div>{campaign.provider && <Badge variant="secondary">{campaign.provider}</Badge>}</div>{campaign.objective && <div className="line-clamp-2 text-xs text-muted-foreground">{campaign.objective}</div>}</TableCell><TableCell><Badge variant={STATUS_VARIANT[campaign.status] ?? "secondary"}>{campaign.status}</Badge></TableCell><TableCell className="text-right tabular-nums">{campaign.kpis ? money(campaign.kpis.spend) : "—"}</TableCell><TableCell className="text-right tabular-nums">{campaign.kpis ? num(campaign.kpis.conversions) : "—"}</TableCell><TableCell className="text-right tabular-nums">{campaign.kpis ? `${campaign.kpis.roas}×` : "—"}</TableCell><TableCell><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setDetail(campaign)}>Open</Button><Button type="button" variant="destructive" size="sm" onClick={() => setDeleting(campaign)}>Delete</Button></div></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
      )}
      {detail && <CampaignDetail campaign={detail} onClose={() => { setDetail(null); reloadAll(); }} />}
      {creating && <Modal title="New campaign" onClose={() => setCreating(false)}><form onSubmit={create} className="flex flex-col gap-5"><FieldGroup><Field><FieldLabel htmlFor="campaign-name">Name *</FieldLabel><Input id="campaign-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={isSubmitting} /></Field><Field><FieldLabel htmlFor="campaign-objective">Objective</FieldLabel><Input id="campaign-objective" placeholder="Leads, sales, awareness…" value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="campaign-status">Status</FieldLabel><Select items={["active", "paused", "completed"].map((status) => ({ value: status, label: status }))} value={form.status} onValueChange={(value) => setForm({ ...form, status: value ?? "" })}><SelectTrigger className="w-full" id="campaign-status"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["active", "paused", "completed"].map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field><FieldLabel htmlFor="campaign-brand">Brand</FieldLabel><Select items={[{ value: null, label: active ? `${active.name} (active)` : "—" }, ...brands.map((brand) => ({ value: brand.id, label: brand.name }))]} value={form.company_id || null} onValueChange={(value) => setForm({ ...form, company_id: value ?? "" })}><SelectTrigger className="w-full" id="campaign-brand"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>{active ? `${active.name} (active)` : "—"}</SelectItem>{brands.map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></div></FieldGroup><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create"}</Button></div></form></Modal>}
      {deleting && <ConfirmDialog title="Delete campaign" message={`Delete "${deleting.name}" and all its metrics?`} confirmLabel="Delete" danger onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
    </div>
  );
}
