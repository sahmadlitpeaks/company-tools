import { useRef, useState } from "react";
import { api } from "../api/client";
import type {
  Campaign,
  CampaignBreakdown,
  CampaignKpis,
  CampaignMetric,
  CampaignOverview,
} from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  ConfirmModal,
  Empty,
  ErrorState,
  ListSkeleton,
  MetricStrip,
  MiniBars,
  Modal,
  PageHead,
  useToast,
} from "../components/ui";
import { useBrand } from "../brand/BrandContext";

const CHANNELS = ["facebook", "instagram", "google", "tiktok", "other"];
const CHANNEL_ICON: Record<string, string> = {
  facebook: "📘",
  instagram: "📸",
  google: "🔍",
  tiktok: "🎵",
  other: "🌐",
};
const STATUS_BADGE: Record<string, string> = {
  active: "green",
  paused: "amber",
  completed: "",
};

const money = (v: string | number) =>
  Number(v).toLocaleString(undefined, { style: "currency", currency: "AED", maximumFractionDigits: 0 });
const num = (v: number) => v.toLocaleString();

function ChannelTable({ rows }: { rows: (CampaignKpis & { channel: string })[] }) {
  if (rows.length === 0) return <Empty message="No channel data yet." />;
  return (
    <table>
      <thead>
        <tr>
          <th>Channel</th>
          <th>Spend</th>
          <th>Impr.</th>
          <th>Clicks</th>
          <th>CTR</th>
          <th>Conv.</th>
          <th>CPA</th>
          <th>ROAS</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.channel}>
            <td className="font-semibold capitalize">
              <span className="mr-1.5">{CHANNEL_ICON[r.channel] ?? "🌐"}</span>
              {r.channel}
            </td>
            <td>{money(r.spend)}</td>
            <td>{num(r.impressions)}</td>
            <td>{num(r.clicks)}</td>
            <td>{r.ctr}%</td>
            <td>{num(r.conversions)}</td>
            <td>{money(r.cpa)}</td>
            <td>
              <span className={`badge ${r.roas >= 1 ? "green" : "red"}`}>{r.roas}×</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CampaignDetail({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { notify } = useToast();
  const bd = useFetch<CampaignBreakdown>(`/api/campaigns/${campaign.id}/breakdown`);
  const metrics = useFetch<CampaignMetric[]>(`/api/campaigns/${campaign.id}/metrics`);
  const importRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    channel: "facebook",
    date: "",
    spend: "",
    impressions: "",
    clicks: "",
    conversions: "",
    revenue: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function reload() {
    bd.reload();
    metrics.reload();
  }

  async function addMetric(e: React.FormEvent) {
    e.preventDefault();
    await api(`/api/campaigns/${campaign.id}/metrics`, {
      method: "POST",
      body: {
        channel: form.channel,
        date: form.date || null,
        spend: form.spend || "0",
        impressions: Number(form.impressions || 0),
        clicks: Number(form.clicks || 0),
        conversions: Number(form.conversions || 0),
        revenue: form.revenue || "0",
      },
    });
    notify("Metric added.");
    setForm({ ...form, spend: "", impressions: "", clicks: "", conversions: "", revenue: "" });
    reload();
  }

  async function importCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api<{ created: number }>(`/api/campaigns/${campaign.id}/metrics/import`, {
        method: "POST",
        form: fd,
      });
      notify(`Imported ${r.created} rows.`);
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Import failed", "error");
    }
    if (importRef.current) importRef.current.value = "";
  }

  async function removeMetric(id: string) {
    await api(`/api/campaigns/${campaign.id}/metrics/${id}`, { method: "DELETE" });
    reload();
  }

  const k = bd.data?.totals;
  return (
    <Modal title={campaign.name} maxWidth={900} onClose={onClose}>
      {bd.loading || !k ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <MetricStrip
            items={[
              { value: money(k.spend), label: "Spend" },
              { value: num(k.impressions), label: "Impressions" },
              { value: `${k.ctr}%`, label: "CTR", sub: `${num(k.clicks)} clicks` },
              { value: num(k.conversions), label: "Conversions", sub: `CPA ${money(k.cpa)}` },
              { value: `${k.roas}×`, label: "ROAS", sub: money(k.revenue) },
            ]}
          />

          {bd.data!.series.length > 0 && (
            <div className="card mt-4">
              <h4 className="mt-0">Spend over time</h4>
              <MiniBars
                data={bd.data!.series.map((s) => ({ date: s.date, count: Number(s.spend) }))}
                label="Daily spend"
              />
            </div>
          )}

          <h4 className="mt-4">By channel</h4>
          <ChannelTable rows={bd.data!.by_channel} />

          <div className="card mt-4 bg-slate-50">
            <div className="spread mb-2">
              <h4 className="m-0">Add data</h4>
              <button className="btn-sm" onClick={() => importRef.current?.click()}>
                Import CSV
              </button>
              <input ref={importRef} type="file" accept=".csv" hidden onChange={importCsv} />
            </div>
            <div className="muted mb-2 text-xs">
              CSV columns: channel, date, spend, impressions, clicks, conversions, revenue
            </div>
            <form onSubmit={addMetric} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select value={form.channel} onChange={(e) => set("channel", e.target.value)}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
              <input placeholder="Spend" value={form.spend} onChange={(e) => set("spend", e.target.value)} />
              <input placeholder="Impressions" value={form.impressions} onChange={(e) => set("impressions", e.target.value)} />
              <input placeholder="Clicks" value={form.clicks} onChange={(e) => set("clicks", e.target.value)} />
              <input placeholder="Conversions" value={form.conversions} onChange={(e) => set("conversions", e.target.value)} />
              <input placeholder="Revenue" value={form.revenue} onChange={(e) => set("revenue", e.target.value)} />
              <button className="btn-primary">Add row</button>
            </form>
          </div>

          {metrics.data && metrics.data.length > 0 && (
            <>
              <h4 className="mt-4">Rows ({metrics.data.length})</h4>
              <div className="max-h-[220px] overflow-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Channel</th><th>Date</th><th>Spend</th><th>Conv.</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.data.map((m) => (
                      <tr key={m.id}>
                        <td className="capitalize">{m.channel}</td>
                        <td>{m.date ?? "—"}</td>
                        <td>{money(m.spend)}</td>
                        <td>{num(m.conversions)}</td>
                        <td className="text-right">
                          <button className="btn-sm btn-danger" onClick={() => removeMetric(m.id)}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
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

  function reloadAll() {
    overview.reload();
    campaigns.reload();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    await api("/api/campaigns", {
      method: "POST",
      body: {
        name: form.name,
        objective: form.objective || null,
        status: form.status,
        company_id: form.company_id || active?.id || null,
      },
    });
    notify("Campaign created.");
    setForm({ name: "", objective: "", status: "active", company_id: "" });
    setCreating(false);
    reloadAll();
  }

  async function remove(c: Campaign) {
    await api(`/api/campaigns/${c.id}`, { method: "DELETE" });
    notify("Campaign deleted.");
    reloadAll();
  }

  const t = overview.data?.totals;

  return (
    <div>
      <PageHead
        title="Campaign Studio"
        subtitle="Ad performance across channels — upload spend, impressions & conversions to see what's working."
        action={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New campaign
          </button>
        }
      />

      {overview.loading || !t ? (
        <ListSkeleton rows={3} />
      ) : (
        <>
          <MetricStrip
            items={[
              { value: money(t.spend), label: "Total spend" },
              { value: num(t.impressions), label: "Impressions" },
              { value: num(t.clicks), label: "Clicks", sub: `${t.ctr}% CTR` },
              { value: num(t.conversions), label: "Conversions", sub: `CPA ${money(t.cpa)}` },
              { value: money(t.revenue), label: "Revenue" },
              { value: `${t.roas}×`, label: "ROAS" },
            ]}
          />

          <div className="card mt-4">
            <h3 className="mt-0">Performance by channel</h3>
            <ChannelTable rows={overview.data!.by_channel} />
          </div>
        </>
      )}

      <h3 className="mt-5">Campaigns</h3>
      {campaigns.loading ? (
        <ListSkeleton rows={4} />
      ) : campaigns.error ? (
        <ErrorState message={campaigns.error} onRetry={campaigns.reload} />
      ) : !campaigns.data || campaigns.data.length === 0 ? (
        <Empty
          icon="📣"
          message="No campaigns yet"
          hint="Create a campaign, then upload channel performance via CSV or manual entry."
          action={<button className="btn-primary" onClick={() => setCreating(true)}>+ New campaign</button>}
        />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Spend</th>
                <th>Conv.</th>
                <th>ROAS</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="font-semibold">{c.name}</div>
                    {c.objective && <div className="muted text-xs">{c.objective}</div>}
                  </td>
                  <td><span className={`badge ${STATUS_BADGE[c.status] ?? ""}`}>{c.status}</span></td>
                  <td>{c.kpis ? money(c.kpis.spend) : "—"}</td>
                  <td>{c.kpis ? num(c.kpis.conversions) : "—"}</td>
                  <td>{c.kpis ? `${c.kpis.roas}×` : "—"}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setDetail(c)}>
                        Open
                      </button>
                      <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => setDeleting(c)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <CampaignDetail
          campaign={detail}
          onClose={() => {
            setDetail(null);
            reloadAll();
          }}
        />
      )}
      {creating && (
        <Modal title="New campaign" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <div className="field">
              <label>Name *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Objective</label>
              <input
                placeholder="Leads, sales, awareness…"
                value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
              />
            </div>
            <div className="row">
              <div className="field">
                <label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="completed">completed</option>
                </select>
              </div>
              <div className="field">
                <label>Brand</label>
                <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })}>
                  <option value="">{active ? `${active.name} (active)` : "—"}</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn-primary" style={{ flex: "0 0 auto" }}>Create</button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <ConfirmModal
          title="Delete campaign"
          message={`Delete "${deleting.name}" and all its metrics?`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
