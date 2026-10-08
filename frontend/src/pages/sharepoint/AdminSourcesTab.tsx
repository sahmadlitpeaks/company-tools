import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Database, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/api/client";
import type { SharePointSource, SharePointStatus } from "@/api/sharepoint";
import { useFetch } from "@/hooks/useApi";
import { PageHead, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceDialog, sourceError, sourceInput } from "./SourceDialog";

export function AdminSourcesTab({ status, onChanged }: { status: SharePointStatus; onChanged: () => void }) {
  const fetched = useFetch<SharePointSource[]>("/api/sharepoint/sources", true);
  const sources = Array.isArray(fetched.data) ? fetched.data : [];
  const [editing, setEditing] = useState<SharePointSource | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { notify } = useToast();
  const { refresh } = fetched;
  useEffect(() => {
    if (editing) return;
    const reload = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(reload, 10000);
    window.addEventListener("focus", reload);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", reload); };
  }, [refresh, editing]);
  async function action(source: SharePointSource, action: "test-connection" | "sync" | "pause") {
    setBusy(source.id);
    try {
      await api(`/api/sharepoint/sources/${source.id}${action === "pause" ? "" : `/${action}`}`, {
        method: action === "pause" ? "PUT" : "POST",
        ...(action === "pause" ? { body: { ...sourceInput(source), enabled: !source.enabled } } : {}),
      });
      notify(action === "test-connection" ? "SharePoint read access verified." : action === "sync" ? "Document sync queued." : source.enabled ? "Source paused." : "Source resumed.");
      await fetched.reload();
      onChanged();
    } catch (cause) {
      notify(sourceError(cause), "error");
    } finally {
      setBusy(null);
    }
  }
  return <div className="space-y-4">
    <PageHead headingLevel={1} title="Document sources" subtitle="Monitor SharePoint locations and choose which uploads notify Teams." action={<Button onClick={() => setEditing("new")}><Plus data-icon="inline-start" />Add source</Button>} />
    <p className="text-sm text-muted-foreground">Automatic sync: {status.polling_enabled ? `every ${Math.ceil(status.sync_interval_seconds / 60)} min` : "off"}. Pausing a source stops its sync and upload notifications; existing document access is still checked.</p>
    {fetched.error ? <Alert variant="destructive"><AlertDescription>{sourceError(new Error(fetched.error))} <Button variant="link" onClick={() => void fetched.reload()}>Try again</Button></AlertDescription></Alert> : fetched.loading && !fetched.data ? <Skeleton className="h-48" /> : !sources.length ? <Empty><EmptyHeader><EmptyTitle>No document sources</EmptyTitle><EmptyDescription>Add a SharePoint site, library and folder to begin monitoring uploads.</EmptyDescription></EmptyHeader></Empty> :
      <div className="grid gap-4 xl:grid-cols-2">{sources.map((source) => <Card key={source.id}>
        <CardHeader><div className="flex flex-wrap items-start justify-between gap-2"><CardTitle className="flex min-w-0 items-start gap-2 break-words"><Database className="size-4 shrink-0" aria-hidden="true" />{source.name}</CardTitle><Badge variant={source.enabled ? "success" : "secondary"}>{source.enabled ? "Enabled" : "Paused"}</Badge></div><CardDescription className="break-all">Folder: {source.folder_id}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2"><div><p className="text-muted-foreground">Last sync</p><strong>{source.last_sync ? new Date(source.last_sync).toLocaleString() : "Not yet synced"}</strong></div><div><p className="text-muted-foreground">Teams uploads</p><strong className="break-words">{source.teams_notify_uploads ? source.teams_channel_name : "Off"}</strong></div></div>
          {source.run && <p className="text-sm">Latest run: <strong>{source.run.status}</strong> · {source.run.discovered} discovered · {source.run.processed} processed · {source.run.failed} failed{source.run.error_code ? ` · ${source.run.error_code.replace(/_/g, " ")}` : ""}</p>}
          {source.teams_notify_uploads && <div className="space-y-1 text-sm"><p>{source.baseline_completed ? "New uploads notify Teams." : "First sync will establish a baseline without sending notifications."}</p><p>{source.deliveries.sent ?? 0} sent · {source.deliveries.pending ?? 0} pending · {source.deliveries.failed ?? 0} retrying · {source.deliveries.skipped ?? 0} skipped</p>{source.last_delivery_error && <p className="break-words text-destructive" role="status">{sourceError(new Error(source.last_delivery_error))}</p>}</div>}
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(busy) || source.active_run} onClick={() => setEditing(source)}>Edit</Button><Button variant="outline" disabled={Boolean(busy)} onClick={() => void action(source, "test-connection")}><ShieldCheck data-icon="inline-start" />Test read access</Button><Button disabled={Boolean(busy) || source.active_run || !source.enabled} onClick={() => void action(source, "sync")}><RefreshCw data-icon="inline-start" />{source.active_run ? "Sync running" : "Sync now"}</Button><Button variant="outline" disabled={Boolean(busy) || source.active_run} onClick={() => void action(source, "pause")}>{source.enabled ? "Pause" : "Resume"}</Button></div>
        </CardContent>
      </Card>)}</div>}
    <Button variant="outline" nativeButton={false} render={<Link to="/sharepoint/compliance" />}>Open compliance dashboard</Button>
    {editing && <SourceDialog source={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void fetched.reload(); onChanged(); notify("Document source saved."); }} />}
  </div>;
}
