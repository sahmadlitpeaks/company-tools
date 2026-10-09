import { useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { api } from "@/api/client";
import type { SharePointSource, SharePointSourceInput } from "@/api/sharepoint";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

function SourceLabel({ htmlFor, children, help, lookup, docs }: {
  htmlFor: string; children: string; help: string; lookup?: string; docs?: string;
}) {
  return <div className="flex min-w-0 flex-1 items-center gap-1">
    <FieldLabel htmlFor={htmlFor}>{children}</FieldLabel>
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`About ${children}`} />}>
        <Info data-icon="inline-start" />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-[calc(100vw-2rem)]">
        <PopoverTitle>{children}</PopoverTitle>
        <PopoverDescription>{help}</PopoverDescription>
        {lookup && <code className="break-all bg-muted p-2 text-xs">{lookup}</code>}
        {docs && <a href={docs} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Microsoft setup guide (opens in a new tab)</a>}
      </PopoverContent>
    </Popover>
  </div>;
}

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
          <Field><SourceLabel htmlFor="source-name" help="Choose a name your team will recognize, such as Finance documents. It appears in source filters and Teams upload alerts.">Source name</SourceLabel><Input id="source-name" required maxLength={128} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="e.g. Finance documents" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2"><SourceLabel htmlFor="source-site" help="Ask your Microsoft administrator for this ID. In Microsoft Graph Explorer, look up your site's hostname and path, then copy the response's id. Replace the example below with your site." lookup="GET /sites/contoso.sharepoint.com:/sites/Finance" docs="https://learn.microsoft.com/en-us/graph/api/site-getbypath?view=graph-rest-1.0">SharePoint site ID</SourceLabel><Input id="source-site" required readOnly={Boolean(source)} value={form.site_id} onChange={(event) => set("site_id", event.target.value)} placeholder="contoso.sharepoint.com,site-guid,web-guid" /><FieldDescription>Use Microsoft Graph IDs, not SharePoint URLs. Your administrator supplies the IDs and grants the app read access.</FieldDescription></Field>
            <Field><SourceLabel htmlFor="source-library" help="This is the library's Microsoft Graph drive ID. Your administrator can list the site's libraries in Graph Explorer, find the library by name, and copy its id. Replace {site-id} with the site ID above." lookup="GET /sites/{site-id}/drives" docs="https://learn.microsoft.com/en-us/graph/api/drive-list?view=graph-rest-1.0">Document library ID</SourceLabel><Input id="source-library" required readOnly={Boolean(source)} value={form.drive_id} onChange={(event) => set("drive_id", event.target.value)} placeholder="e.g. b!AbCdEf…" /></Field>
            <Field><SourceLabel htmlFor="source-folder" help="Enter root for the whole library, or a folder's Microsoft Graph item ID. Your administrator can look up a folder in Graph Explorer and copy its id. Replace {drive-id} and Finance with your library ID and folder path." lookup="GET /drives/{drive-id}/root:/Finance" docs="https://learn.microsoft.com/en-us/graph/api/driveitem-get?view=graph-rest-1.0">Folder ID</SourceLabel><Input id="source-folder" required readOnly={Boolean(source)} value={form.folder_id} onChange={(event) => set("folder_id", event.target.value)} placeholder="root or e.g. 01ABCDEF…" /><FieldDescription>Use root to monitor the whole library.</FieldDescription></Field>
          </div>
          {source && <FieldDescription>Add another source to monitor a different location. Existing documents keep their source.</FieldDescription>}
          <Field orientation="horizontal"><SourceLabel htmlFor="source-enabled" help="When enabled, this source can sync and send upload alerts. Turn it off to pause both; already indexed documents remain available.">Enable sync</SourceLabel><Switch id="source-enabled" checked={form.enabled} onCheckedChange={(checked) => set("enabled", checked)} /></Field>
          <Field orientation="horizontal"><SourceLabel htmlFor="source-notifications" help="Optional: post a filename, source name and SharePoint link to Teams when a new file is discovered after the first sync. Existing files stay silent. Channel members can see the filename and source name.">Notify Teams on new upload</SourceLabel><Switch id="source-notifications" checked={form.teams_notify_uploads} onCheckedChange={(checked) => set("teams_notify_uploads", checked)} /></Field>
          <FieldDescription>The first sync establishes a baseline. Later uploads send a filename, source name and SharePoint link, without waiting for analysis. Channel members will see the filename and source name.</FieldDescription>
          {form.teams_notify_uploads && <>
            <Field><SourceLabel htmlFor="source-channel" help="Enter the team and channel name as a reminder, for example Finance / Documents. This is only a label; the webhook URL below controls where messages are sent.">Teams destination channel</SourceLabel><Input id="source-channel" required maxLength={128} value={form.teams_channel_name} onChange={(event) => set("teams_channel_name", event.target.value)} placeholder="e.g. Finance / Documents" /></Field>
            <Field><SourceLabel htmlFor="source-webhook" help="In Teams, open Workflows and choose Send webhook alerts to a channel. Select the destination team and channel, save, then copy the webhook URL from the workflow details. Keep the URL private. When editing, leave this blank to keep the saved URL." docs="https://support.microsoft.com/en-gb/workflows/send-messages-in-teams-using-incoming-webhooks">Teams workflow webhook URL</SourceLabel><Input id="source-webhook" type="password" autoComplete="new-password" required={!source?.teams_webhook_configured} value={webhook} onChange={(event) => setWebhook(event.target.value)} placeholder={source?.teams_webhook_configured ? "Saved securely — leave blank to keep" : "https://…logic.azure.com/workflows/…"} /><FieldDescription>Create a “Send webhook alerts to a channel” workflow in the destination channel. Paste its full HTTPS URL; Microsoft may also use a Power Platform address. The URL is stored securely and never shown again.</FieldDescription></Field>
          </>}
          {error && <FieldError role="alert">{error}</FieldError>}
        </FieldGroup>
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : source ? "Save source" : "Add source"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
