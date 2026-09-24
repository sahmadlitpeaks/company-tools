import { useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CircleDashed,
  FolderOpen,
  Link2,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type { SharePointDocument, SharePointStatus } from "@/api/sharepoint";
import { readableStatus } from "@/api/sharepoint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface AdminSourcesTabProps {
  status: SharePointStatus;
  documents: SharePointDocument[];
  onTestAccess: () => Promise<void>;
  onSyncNow: () => Promise<void>;
  onToggleAutoPolicy: () => Promise<void>;
  onOpenPrivacy: () => void;
  onOpenReviewQueue: () => void;
  isBusy?: boolean;
}

export function AdminSourcesTab({
  status,
  documents,
  onTestAccess,
  onSyncNow,
  onToggleAutoPolicy,
  onOpenPrivacy,
  onOpenReviewQueue,
  isBusy = false,
}: AdminSourcesTabProps) {
  const [testingAccess, setTestingAccess] = useState(false);

  // Statistics for privacy & health
  const awaitingReviewCount = documents.filter(
    (d) => d.status === "awaiting_approval" || d.requires_attention
  ).length;

  const failedCount = documents.filter(
    (d) => d.status === "failed" || Boolean(d.error_code)
  ).length;

  const indexedCount = status.run?.processed ?? documents.length;

  const handleTest = async () => {
    setTestingAccess(true);
    try {
      await onTestAccess();
    } finally {
      setTestingAccess(false);
    }
  };

  const isSyncing = Boolean(status.active_run);
  const runDiscovered = status.run?.discovered ?? documents.length;
  const runProcessed = status.run?.processed ?? 0;
  const runPercent = Math.min(
    100,
    Math.round((runProcessed / Math.max(runDiscovered, 1)) * 100)
  );

  // 4-stage granular pipeline tracking
  const pipelineStages = [
    {
      id: "discovery",
      name: "1. Graph Discovery",
      description: "Connect to Microsoft Graph & list drive files",
      state: isSyncing
        ? runDiscovered === 0
          ? ("in-progress" as const)
          : ("completed" as const)
        : status.connected
        ? ("completed" as const)
        : ("pending" as const),
      detail: isSyncing
        ? runDiscovered === 0
          ? "Connecting to Graph API & listing files…"
          : `${runDiscovered} ${runDiscovered === 1 ? "file" : "files"} discovered`
        : status.connected
        ? `${runDiscovered} ${runDiscovered === 1 ? "file" : "files"} discovered in SharePoint`
        : "Awaiting initial connection",
    },
    {
      id: "redaction",
      name: "2. Content & Redaction",
      description: "Extract text & mask confidential entities",
      state: isSyncing
        ? runDiscovered === 0
          ? ("pending" as const)
          : runProcessed < Math.ceil(runDiscovered * 0.5)
          ? ("in-progress" as const)
          : ("completed" as const)
        : status.run
        ? failedCount > 0 && indexedCount === 0
          ? ("failed" as const)
          : ("completed" as const)
        : ("pending" as const),
      detail: isSyncing
        ? runDiscovered === 0
          ? "Waiting for file discovery…"
          : runProcessed < Math.ceil(runDiscovered * 0.5)
          ? "Parsing text & masking confidential terms…"
          : "Sensitive entities masked safely"
        : status.run
        ? "Privacy & confidential term rules applied"
        : "Rules configured & ready",
    },
    {
      id: "indexing",
      name: "3. AI Intelligence & Indexing",
      description: "Generate structured analysis & vector chunks",
      state: isSyncing
        ? runProcessed < Math.ceil(runDiscovered * 0.5)
          ? ("pending" as const)
          : runProcessed < runDiscovered
          ? ("in-progress" as const)
          : ("completed" as const)
        : status.run
        ? status.run.status === "failed"
          ? ("failed" as const)
          : ("completed" as const)
        : ("pending" as const),
      detail: isSyncing
        ? runProcessed < Math.ceil(runDiscovered * 0.5)
          ? "Waiting for document redaction…"
          : `Extracting intelligence (${runProcessed}/${runDiscovered})…`
        : status.run
        ? `${indexedCount} documents indexed with citations`
        : "Extracts obligations, expiries & risks",
    },
    {
      id: "reminders",
      name: "4. Alerts & Reminders",
      description: "Schedule proactive deadline notifications",
      state: isSyncing
        ? runProcessed < runDiscovered
          ? ("pending" as const)
          : ("in-progress" as const)
        : status.run
        ? ("completed" as const)
        : ("pending" as const),
      detail: isSyncing
        ? runProcessed < runDiscovered
          ? "Scheduled upon indexing completion"
          : "Registering reminder dates & alerts…"
        : status.run
        ? "Reminders active & calendar synced"
        : "Monitors upcoming contract expiries",
    },
  ];

  return (
    <div className="flex flex-col gap-6 min-w-0 max-w-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Document sources
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Administrators only. Everything technical lives here, out of the way of everyday users.
        </p>
      </div>

      {/* Main Connection & Auto-Sync Section */}
      <div className="bg-card border border-border rounded-none shadow-xs overflow-hidden">
        {/* Connection Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border-b border-border/70">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={cn(
                "size-2.5 rounded-full shrink-0",
                status.connected ? "bg-emerald-500" : "bg-destructive"
              )}
            />
            <div className="min-w-0">
              <div className="text-sm font-bold text-foreground truncate">
                Group SharePoint — Shared Documents
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {status.connected
                  ? "Connected · read-only access · checked regularly"
                  : "Disconnected · credentials required"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy || testingAccess || !status.connected}
              onClick={() => void handleTest()}
              className="rounded-none h-8 px-3 text-xs font-semibold"
            >
              {testingAccess ? (
                <Spinner data-icon="inline-start" className="size-3" />
              ) : (
                <FolderOpen data-icon="inline-start" className="size-3.5 text-muted-foreground" />
              )}
              Test access
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <a
                  href="/api/sharepoint/connect"
                  className="flex items-center gap-1.5"
                >
                  <Link2 data-icon="inline-start" className="size-3.5 text-muted-foreground" />
                  <span>Reconnect</span>
                </a>
              }
              className="rounded-none h-8 px-3 text-xs font-semibold"
            />
          </div>
        </div>

        {/* Automatic Sync Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground">
              Automatic sync
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {status.polling_enabled
                ? `Checks SharePoint for new and changed files about every ${Math.ceil(status.sync_interval_seconds / 60)} minute${status.sync_interval_seconds > 60 ? "s" : ""}.`
                : "Automatic checks are paused on this server. An administrator must enable SharePoint polling."}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => void onToggleAutoPolicy()}
              disabled={isBusy}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer",
                status.policy === "auto"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "relative inline-block w-8 h-4.5 rounded-full transition-colors",
                  status.policy === "auto" ? "bg-emerald-600" : "bg-muted border border-border"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-3.5 rounded-full bg-white transition-transform",
                    status.policy === "auto" ? "right-0.5" : "left-0.5"
                  )}
                />
              </span>
              <span>{status.policy === "auto" ? "Auto-AI On" : "Manual Review"}</span>
            </button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy || status.active_run || !status.connected}
              onClick={() => void onSyncNow()}
              className="rounded-none h-8 px-3 text-xs font-semibold"
            >
              <RefreshCw
                data-icon="inline-start"
                className={status.active_run ? "size-3 animate-spin" : "size-3"}
              />
              {status.active_run ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        </div>

        {/* Active Sync Progress Banner */}
        {status.active_run && (
          <div className="p-4 border-t border-border bg-primary/5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Spinner className="size-3.5 text-primary" />
                <span className="font-semibold text-foreground">
                  Sync in progress: Processing documents…
                </span>
              </div>
              <span className="font-mono text-muted-foreground font-medium">
                {runPercent}% ({runProcessed}/{runDiscovered})
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={runPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="SharePoint sync progress"
              className="w-full h-1.5 bg-muted overflow-hidden"
            >
              <div
                className="h-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(8, runPercent))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 4-Stage Granular Sync Pipeline */}
      <Card className="rounded-none border-border bg-card shadow-xs">
        <CardHeader className="p-4 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold text-foreground">
                Sync pipeline &amp; processing stages
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Granular multi-stage execution pipeline for continuous ingestion, redaction, and AI indexing.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">Pipeline status:</span>
              <Badge
                variant={status.active_run ? "default" : "secondary"}
                className="rounded-none text-xs font-semibold px-2 py-0.5"
              >
                {status.active_run
                  ? "Running"
                  : status.run
                  ? readableStatus(status.run.status)
                  : "Idle"}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {pipelineStages.map((stage) => (
              <div
                key={stage.id}
                className={cn(
                  "p-3 border rounded-none flex flex-col justify-between gap-2.5 transition-colors",
                  stage.state === "in-progress" && "border-primary/60 bg-primary/5",
                  stage.state === "completed" && "border-border bg-card",
                  stage.state === "pending" && "border-border/60 bg-muted/20 opacity-75",
                  stage.state === "failed" && "border-destructive/60 bg-destructive/5"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {stage.state === "completed" && (
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                    {stage.state === "in-progress" && (
                      <Spinner className="size-4 text-primary shrink-0" />
                    )}
                    {stage.state === "pending" && (
                      <CircleDashed className="size-4 text-muted-foreground/60 shrink-0" />
                    )}
                    {stage.state === "failed" && (
                      <AlertTriangle className="size-4 text-destructive shrink-0" />
                    )}
                    <span className="text-xs font-bold text-foreground truncate">
                      {stage.name}
                    </span>
                  </div>
                  <Badge
                    variant={
                      stage.state === "completed"
                        ? "secondary"
                        : stage.state === "in-progress"
                        ? "default"
                        : stage.state === "failed"
                        ? "destructive"
                        : "outline"
                    }
                    className="text-[10px] px-1.5 py-0 h-4 uppercase tracking-wider rounded-none font-semibold shrink-0"
                  >
                    {stage.state === "in-progress" ? "Active" : stage.state}
                  </Badge>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {stage.description}
                  </p>
                  <p className="text-xs font-semibold text-foreground mt-1.5 leading-snug">
                    {stage.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Two-Column Grid: Privacy & Redaction + Processing Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Privacy & Redaction Card */}
        <Card className="rounded-none border-border bg-card shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold text-foreground flex items-center justify-between">
              <span>Privacy &amp; redaction</span>
              <ShieldCheck className="size-4 text-primary shrink-0" />
            </CardTitle>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              Names, contacts and confidential terms are hidden before anything is sent to the AI provider.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-2.5">
            <div className="divide-y divide-border/60 text-xs">
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Mode</span>
                <span className="font-semibold text-foreground">
                  {status.policy === "auto" ? "Auto-AI Processing" : "Manual review"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Confidential terms</span>
                <span className="font-semibold text-foreground">Configured</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Waiting for review</span>
                <span
                  className={cn(
                    "font-bold",
                    awaitingReviewCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"
                  )}
                >
                  {awaitingReviewCount} {awaitingReviewCount === 1 ? "document" : "documents"}
                </span>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={onOpenPrivacy}
                className="rounded-none h-8 px-3 text-xs font-semibold"
              >
                Privacy policy
              </Button>
              {awaitingReviewCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onOpenReviewQueue}
                  className="rounded-none h-8 px-3 text-xs font-semibold"
                >
                  Open review queue
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Processing Health Card */}
        <Card className="rounded-none border-border bg-card shadow-xs">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-bold text-foreground flex items-center justify-between">
              <span>Processing health</span>
              <Zap className="size-4 text-amber-500 shrink-0" />
            </CardTitle>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              What synced, what failed, and why — the detail users should never have to see.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-1 space-y-2.5">
            <div className="divide-y divide-border/60 text-xs">
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Documents indexed</span>
                <span className="font-bold text-foreground">{indexedCount}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Failed to read</span>
                <span
                  className={cn(
                    "font-bold",
                    failedCount > 0 ? "text-destructive" : "text-foreground"
                  )}
                >
                  {failedCount}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">AI provider status</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {status.openai_configured ? "Connected" : "OpenAI key missing"}
                </span>
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => void onSyncNow()}
                className="rounded-none h-8 px-3 text-xs font-semibold"
              >
                {status.run ? `Status: ${readableStatus(status.run.status)}` : "View sync health"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reminder Delivery Configuration Summary */}
      <Card className="rounded-none border-border bg-card shadow-xs">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-bold text-foreground flex items-center justify-between">
            <span>Reminder delivery</span>
            <Bell className="size-4 text-sky-500 shrink-0" />
          </CardTitle>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            When people are emailed about expiring licences and contracts, and who receives them.
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-1">
          <div className="divide-y divide-border/60 text-xs">
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">Schedule</span>
              <span className="font-bold text-foreground">30 days, 7 days, and on the day</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">Channels</span>
              <span className="font-bold text-foreground">Email · Microsoft Teams</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">Recipients</span>
              <span className="font-bold text-foreground">
                Only people with SharePoint access to the file
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminSourcesTab;
