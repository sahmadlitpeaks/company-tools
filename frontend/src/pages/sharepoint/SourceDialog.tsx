import { useState, type FormEvent } from "react";
import { api } from "@/api/client";
import type { SharePointSource, SharePointSourceInput } from "@/api/sharepoint";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const sourceErrors: Record<string, string> = {
  source_already_exists: "This site, library and folder are already connected.",
  source_scope_locked: "This source already has documents. Add a new source for a different location.",
  source_sync_running: "A sync is running. Wait for it to finish before editing this source.",
  invalid_source_scope: "The library or folder does not belong to the selected site.",
  document_access_denied: "Microsoft denied read access. Ask your administrator to grant this app access to the selected site.",
  source_paused: "Resume this source before syncing.",
  teams_destination_required: "Enter a Teams workflow webhook URL to enable notifications.",
  teams_channel_name_required: "Enter the destination channel name.",
  invalid_teams_webhook: "Use an HTTPS webhook URL supplied by Microsoft Teams Workflows.",
  teams_upload_delivery_failed: "Teams could not accept the upload alert. Check the workflow URL and channel; delivery will retry.",
  invalid_upload_link: "The SharePoint upload link could not be verified.",
};
export function sourceError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Could not update the source.";
  return sourceErrors[message] ?? message.replace(/_/g, " ");
}

export function sourceInput(source: SharePointSource): SharePointSourceInput {
  return {
    name: source.name, site_id: source.site_id, drive_id: source.drive_id, folder_id: source.folder_id,
    enabled: source.enabled, teams_notify_uploads: source.teams_notify_uploads, teams_channel_name: source.teams_channel_name,
  };
}

export function SourceDialog({ source, onClose, onSaved }: {
  source: SharePointSource | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<SharePointSourceInput>(() => source ? sourceInput(source) : {
    name: "", site_id: "", drive_id: "", folder_id: "", enabled: true, teams_notify_uploads: false, teams_channel_name: "",
  });
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function set<K extends keyof SharePointSourceInput>(key: K, value: SharePointSourceInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(source ? `/api/sharepoint/sources/${source.id}` : "/api/sharepoint/sources", {
        method: source ? "PUT" : "POST",
        body: { ...form, ...(webhook.trim() ? { teams_webhook_url: webhook.trim() } : {}) },
      });
      onSaved();
    } catch (cause) {
      setError(sourceError(cause));
    } finally {
      setBusy(false);
    }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{source ? "Edit document source" : "Add document source"}</DialogTitle>
        <DialogDescription>Connect a SharePoint location and optionally notify a Teams channel about new uploads.</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void save(event)} className="space-y-5">
        <FieldGroup>
          <Field><FieldLabel htmlFor="source-name">Source name</FieldLabel><Input id="source-name" required maxLength={128} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Finance documents" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2"><FieldLabel htmlFor="source-site">SharePoint site ID</FieldLabel><Input id="source-site" required readOnly={Boolean(source)} value={form.site_id} onChange={(event) => set("site_id", event.target.value)} /><FieldDescription>Your Microsoft administrator supplies these IDs and grants the app read access.</FieldDescription></Field>
            <Field><FieldLabel htmlFor="source-library">Document library ID</FieldLabel><Input id="source-library" required readOnly={Boolean(source)} value={form.drive_id} onChange={(event) => set("drive_id", event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="source-folder">Folder ID</FieldLabel><Input id="source-folder" required readOnly={Boolean(source)} value={form.folder_id} onChange={(event) => set("folder_id", event.target.value)} /><FieldDescription>Use root to monitor the whole library.</FieldDescription></Field>
          </div>
          {source && <FieldDescription>Add another source to monitor a different location. Existing documents keep their source.</FieldDescription>}
          <Field orientation="horizontal"><FieldLabel htmlFor="source-enabled">Enable sync</FieldLabel><Switch id="source-enabled" checked={form.enabled} onCheckedChange={(checked) => set("enabled", checked)} /></Field>
          <Field orientation="horizontal"><FieldLabel htmlFor="source-notifications">Notify Teams on new upload</FieldLabel><Switch id="source-notifications" checked={form.teams_notify_uploads} onCheckedChange={(checked) => set("teams_notify_uploads", checked)} /></Field>
          <FieldDescription>The first sync establishes a baseline. Later uploads send a filename, source name and SharePoint link, without waiting for analysis. Channel members will see the filename and source name.</FieldDescription>
          {form.teams_notify_uploads && <>
            <Field><FieldLabel htmlFor="source-channel">Teams destination channel</FieldLabel><Input id="source-channel" required maxLength={128} value={form.teams_channel_name} onChange={(event) => set("teams_channel_name", event.target.value)} placeholder="Finance / Documents" /></Field>
            <Field><FieldLabel htmlFor="source-webhook">Teams workflow webhook URL</FieldLabel><Input id="source-webhook" type="password" autoComplete="new-password" required={!source?.teams_webhook_configured} value={webhook} onChange={(event) => setWebhook(event.target.value)} placeholder={source?.teams_webhook_configured ? "Saved securely — leave blank to keep" : "Paste the Teams workflow URL"} /><FieldDescription>Create a “Send webhook alerts to a channel” workflow in the destination channel. The URL is stored securely and never shown again.</FieldDescription></Field>
          </>}
          {error && <FieldError role="alert">{error}</FieldError>}
        </FieldGroup>
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : source ? "Save source" : "Add source"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
