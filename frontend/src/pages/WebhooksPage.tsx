import { useEffect, useState } from "react";
import { Plus, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { api } from "../api/client";
import type { Webhook, WebhookDelivery } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function WebhooksPage() {
  const { notify } = useToast();
  const hooks = useFetch<Webhook[]>("/api/webhooks");
  const [creating, setCreating] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null);

  async function toggle(w: Webhook) {
    await api(`/api/webhooks/${w.id}`, { method: "PATCH", body: { active: !w.active } });
    hooks.reload();
  }
  async function del(w: Webhook) {
    if (!confirm(`Delete webhook to ${w.url}?`)) return;
    await api(`/api/webhooks/${w.id}`, { method: "DELETE" });
    hooks.reload();
  }
  async function test(w: Webhook) {
    try {
      const res = await api<{ success: boolean; status_code: number | null; error: string | null }>(`/api/webhooks/${w.id}/test`, { method: "POST" });
      notify(res.success ? `Delivered (HTTP ${res.status_code})` : `Failed: ${res.error ?? res.status_code}`, res.success ? "info" : "error");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <div>
      <PageHead
        title="Webhooks"
        subtitle="Send platform events to external systems with a signed payload."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setCreating(true)}>
            <Plus size={15} /> New webhook
          </button>
        }
      />
      {hooks.loading ? (
        <Loading />
      ) : (hooks.data?.length ?? 0) === 0 ? (
        <div className="card"><Empty icon="🪝" message="No webhooks yet" hint="Register a URL to receive events like submission.created." /></div>
      ) : (
        <div className="space-y-3">
          {hooks.data!.map((w) => (
            <div key={w.id} className="card">
              <div className="spread">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <WebhookIcon size={16} className="text-brand-600" />
                    <code className="truncate text-sm">{w.url}</code>
                    {!w.active && <span className="badge">paused</span>}
                  </div>
                  {w.description && <div className="muted text-sm">{w.description}</div>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(w.events.length ? w.events : ["all events"]).map((e) => (
                      <span key={e} className="badge violet">{e}</span>
                    ))}
                  </div>
                </div>
                <div className="row" style={{ gap: 6, flex: "0 0 auto" }}>
                  <button className="btn-sm inline-flex items-center gap-1" style={{ flex: "0 0 auto" }} onClick={() => test(w)}><Send size={13} /> Test</button>
                  <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => setDeliveriesFor(w)}>Deliveries</button>
                  <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => toggle(w)}>{w.active ? "Pause" : "Resume"}</button>
                  <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => del(w)}><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); hooks.reload(); }} />}
      {deliveriesFor && <DeliveriesModal webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />}
    </div>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [events, setEvents] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ events: string[] }>("/api/webhooks/events").then((r) => setAvailable(r.events)).catch(() => {});
  }, []);

  function toggleEvent(e: string) {
    setEvents((arr) => (arr.includes(e) ? arr.filter((x) => x !== e) : [...arr, e]));
  }
  async function save() {
    if (!url.trim()) { notify("URL is required", "error"); return; }
    setBusy(true);
    try {
      const res = await api<{ secret: string }>("/api/webhooks", { method: "POST", body: { url: url.trim(), description: description || null, events } });
      setSecret(res.secret);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  if (secret) {
    return (
      <Modal title="Webhook created" onClose={() => { onDone(); }} maxWidth={520}>
        <p className="text-sm">Copy the signing secret now — it won't be shown again. Verify the
          <code> X-Webhook-Signature: sha256=&lt;hmac&gt;</code> header against the raw body.</p>
        <code className="block rounded-lg p-2 text-xs" style={{ background: "var(--surface-2)", wordBreak: "break-all" }}>{secret}</code>
        <div className="row mt-3" style={{ justifyContent: "flex-end" }}>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} onClick={onDone}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New webhook" onClose={onClose} maxWidth={520}>
      <div className="field"><label>Endpoint URL</label><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/company-tools" /></div>
      <div className="field"><label>Description</label><input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <label className="muted text-xs">Events (none selected = all)</label>
      <div className="mt-1 flex flex-wrap gap-1">
        {available.map((e) => (
          <button type="button" key={e} className={events.includes(e) ? "btn-sm btn-primary" : "btn-sm"} style={{ flex: "0 0 auto" }} onClick={() => toggleEvent(e)}>{e}</button>
        ))}
      </div>
      <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>Cancel</button>
        <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy} onClick={save}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </Modal>
  );
}

function DeliveriesModal({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const deliveries = useFetch<WebhookDelivery[]>(`/api/webhooks/${webhook.id}/deliveries`);
  return (
    <Modal title="Recent deliveries" onClose={onClose} maxWidth={560}>
      {deliveries.loading ? (
        <Loading />
      ) : (deliveries.data?.length ?? 0) === 0 ? (
        <Empty icon="📭" message="No deliveries yet" />
      ) : (
        <table className="table">
          <thead><tr><th>Event</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {deliveries.data!.map((d) => (
              <tr key={d.id}>
                <td>{d.event}</td>
                <td><span className={`badge ${d.success ? "green" : "red"}`}>{d.success ? `HTTP ${d.status_code}` : (d.error?.slice(0, 40) ?? "failed")}</span></td>
                <td className="muted text-xs">{new Date(d.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
