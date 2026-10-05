import { Link } from "react-router-dom";
import { Database, RefreshCw, ShieldCheck } from "lucide-react";
import type { SharePointDocument, SharePointStatus } from "@/api/sharepoint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface AdminSourcesTabProps {
  status: SharePointStatus;
  documents: SharePointDocument[];
  onTestAccess: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  isBusy?: boolean;
}

export function AdminSourcesTab({ status, documents, onTestAccess, onSyncNow, isBusy = false }: AdminSourcesTabProps) {
  const failed = documents.filter((doc) => doc.status === "failed").length;
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-4" />SharePoint source</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-muted-foreground">Microsoft connection</p><Badge variant={status.connected ? "success" : "warning"}>{status.connected ? "Connected" : "Not connected"}</Badge></div><div><p className="text-muted-foreground">Automatic sync</p><strong>{status.polling_enabled ? `Every ${Math.ceil(status.sync_interval_seconds / 60)} min` : "Paused"}</strong></div><div><p className="text-muted-foreground">Last sync</p><strong>{status.last_sync ? new Date(status.last_sync).toLocaleString() : "Not yet synced"}</strong></div></div>
      {status.run && <p className="text-sm">Latest run: <strong>{status.run.status}</strong> · {status.run.discovered} discovered · {status.run.processed} processed · {status.run.failed} failed</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={isBusy} onClick={() => void onTestAccess()}><ShieldCheck data-icon="inline-start" />Test read access</Button><Button disabled={isBusy || status.active_run} onClick={() => void onSyncNow()}><RefreshCw data-icon="inline-start" />{status.active_run ? "Sync running" : "Sync now"}</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Processing health</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-muted-foreground">Visible documents</p><strong>{documents.length}</strong></div><div><p className="text-muted-foreground">Failed processing</p><strong>{failed}</strong></div><div><p className="text-muted-foreground">AI model</p><strong>{status.openai_configured ? "Configured" : "Not configured"}</strong></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Compliance workflow</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p className="text-muted-foreground">New and updated documents are fetched and analyzed automatically. Confident facts create owned tasks. Uncertain facts wait for a reviewer.</p><Button variant="outline" nativeButton={false} render={<Link to="/sharepoint/compliance" />}>Open compliance dashboard</Button></CardContent></Card>
  </div>;
}

export default AdminSourcesTab;
