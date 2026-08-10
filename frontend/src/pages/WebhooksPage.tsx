import { useEffect, useState } from "react";
import { MailOpen, Plus, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { api } from "../api/client";
import type { Webhook, WebhookDelivery } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { ConfirmDialog, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export default function WebhooksPage() {
  const { notify } = useToast();
  const hooks = useFetch<Webhook[]>("/api/webhooks");
  const [creating, setCreating] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function toggle(w: Webhook) {
    await api(`/api/webhooks/${w.id}`, { method: "PATCH", body: { active: !w.active } });
    hooks.reload();
  }
  async function del(w: Webhook) {
    await api(`/api/webhooks/${w.id}`, { method: "DELETE" });
    hooks.reload();
  }
  async function test(w: Webhook) {
    setTestingId(w.id);
    try {
      const res = await api<{ success: boolean; status_code: number | null; error: string | null }>(`/api/webhooks/${w.id}/test`, { method: "POST" });
      notify(res.success ? `Delivered (HTTP ${res.status_code})` : `Failed: ${res.error ?? res.status_code}`, res.success ? "info" : "error");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div>
      <PageHead
        title="Webhooks"
        subtitle="Send platform events to external systems with a signed payload."
        action={
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" /> New webhook
          </Button>
        }
      />
      {hooks.loading ? (
        <Loading />
      ) : (hooks.data?.length ?? 0) === 0 ? (
        <Card><CardContent><Empty icon={<WebhookIcon />} message="No webhooks yet" hint="Register a URL to receive events like submission.created." /></CardContent></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {hooks.data!.map((w) => (
            <Card key={w.id}>
              <CardHeader className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <WebhookIcon />
                    <code className="truncate text-sm">{w.url}</code>
                    {!w.active && <Badge variant="secondary">paused</Badge>}
                  </div>
                  {w.description && <div className="text-sm text-muted-foreground">{w.description}</div>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(w.events.length ? w.events : ["all events"]).map((e) => (
                      <Badge key={e} variant="info">{e}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={testingId === w.id} onClick={() => test(w)}><Send data-icon="inline-start" /> {testingId === w.id ? "Testing…" : "Test"}</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setDeliveriesFor(w)}>Deliveries</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => toggle(w)}>{w.active ? "Pause" : "Resume"}</Button>
                  <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleting(w)}><Trash2 /></Button>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); hooks.reload(); }} />}
      {deliveriesFor && <DeliveriesModal webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete webhook"
          message={`Delete webhook to ${deleting.url}?`}
          confirmLabel="Delete webhook"
          danger
          onConfirm={() => del(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void api<{ events: string[] }>("/api/webhooks/events").then((r) => setAvailable(r.events)).catch(() => {});
  }, []);

  async function save() {
    if (!url.trim()) { notify("URL is required", "error"); return; }
    setIsSubmitting(true);
    try {
      const res = await api<{ secret: string }>("/api/webhooks", { method: "POST", body: { url: url.trim(), description: description || null, events } });
      setSecret(res.secret);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  if (secret) {
    return (
      <Modal title="Webhook created" onClose={() => { onDone(); }} maxWidth={520}>
        <p className="text-sm">Copy the signing secret now — it won't be shown again. Verify the
          <code> X-Webhook-Signature: sha256=&lt;hmac&gt;</code> header against the raw body.</p>
        <code className="block break-all bg-muted p-2 text-xs">{secret}</code>
        <div className="mt-3 flex justify-end">
          <Button type="button" onClick={onDone}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="New webhook" onClose={onClose} maxWidth={520}>
      <FieldGroup>
      <Field><FieldLabel htmlFor="webhook-url">Endpoint URL</FieldLabel><Input id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/company-tools" /></Field>
      <Field><FieldLabel htmlFor="webhook-description">Description</FieldLabel><Input id="webhook-description" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field><FieldLabel>Events (none selected = all)</FieldLabel>
      <ToggleGroup multiple value={events} onValueChange={setEvents} variant="outline" size="sm" className="flex-wrap justify-start">
        {available.map((e) => (
          <ToggleGroupItem key={e} value={e}>{e}</ToggleGroupItem>
        ))}
      </ToggleGroup></Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={isSubmitting} onClick={save}>{isSubmitting ? "Creating…" : "Create"}</Button>
      </div>
      </FieldGroup>
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
        <Empty icon={<MailOpen />} message="No deliveries yet" />
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Event</TableHead><TableHead className="text-right">Status</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
          <TableBody>
            {deliveries.data!.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.event}</TableCell>
                <TableCell className="text-right tabular-nums"><Badge variant={d.success ? "success" : "destructive"}>{d.success ? `HTTP ${d.status_code}` : (d.error?.slice(0, 40) ?? "failed")}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Modal>
  );
}
