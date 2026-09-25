import { useEffect, useState } from "react";
import {
  Bot,
  Calendar,
  CheckSquare,
  Clock,
  Coins,
  Cpu,
  ExternalLink,
  FileText,
  FolderTree,
  Layers,
  RefreshCw,
} from "lucide-react";
import { api } from "@/api/client";
import {
  calculateEstimatedCost,
  formatBytes,
  formatDateTime,
  getStatusBadgeInfo,
  readableStatus,
  type SharePointDocument,
  type SharePointReminder,
} from "@/api/sharepoint";
import { useFetch } from "@/hooks/useApi";
import { Modal, Loading, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DocumentChatTab } from "./DocumentChatTab";
import { ExpiriesTab } from "./ExpiriesTab";
import { FindingsTab } from "./FindingsTab";
import { SourceExcerptsTab } from "./SourceExcerptsTab";

export default function DocumentDialog({
  id,
  isAdmin,
  onClose,
  onChanged,
}: {
  id: string;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useFetch<SharePointDocument>(`/api/sharepoint/documents/${id}`);
  const reminders = useFetch<SharePointReminder[]>(`/api/sharepoint/documents/${id}/reminders`);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("analysis");
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const { notify } = useToast();

  async function retry() {
    setBusy(true);
    try {
      await api(`/api/sharepoint/documents/${id}/retry`, { method: "POST" });
      notify("Retry queued.");
      onChanged();
      onClose();
    } catch (error) {
      notify(readableStatus(error instanceof Error ? error.message : "Retry failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const doc = !detail.loading && !detail.error ? detail.data : null;
  const badgeInfo = doc ? getStatusBadgeInfo(doc.status) : null;
  const costInfo = doc ? calculateEstimatedCost(doc.usage, doc.model) : null;

  const findingsCount =
    doc?.analysis?.sections.reduce((sum, s) => {
      return (
        sum +
        (s.tasks?.length || 0) +
        (s.deadlines?.length || 0) +
        (s.risks?.length || 0) +
        (s.blockers?.length || 0) +
        (s.contacts?.length || 0)
      );
    }, 0) ?? 0;

  const expiriesCount = doc?.analysis?.sections.flatMap((s) => s.expiries || []).length ?? 0;
  const commercialsCount = doc?.analysis?.sections.flatMap((s) => s.commercials || []).length ?? 0;

  function handleViewSource(segmentId: string) {
    setActiveSegmentId(segmentId);
    setActiveTab("segments");
  }

  const { reload: reloadDetail } = detail;
  const { reload: reloadReminders } = reminders;
  const docStatus = doc?.status;

  useEffect(() => {
    if (!docStatus || (docStatus !== "processing" && docStatus !== "approved" && docStatus !== "queued")) return;
    const interval = window.setInterval(() => {
      void reloadDetail();
      void reloadReminders();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [docStatus, reloadDetail, reloadReminders]);

  return (
    <Modal
      title="Document details"
      onClose={onClose}
      maxWidth={960}
    >
      {detail.loading && !detail.data && <Loading />}
      {detail.error && (
        <Alert variant="destructive">
          <AlertDescription>{readableStatus(detail.error)}. Close this document and refresh the list.</AlertDescription>
        </Alert>
      )}
      {doc && (
        <div className="space-y-4">
          {/* Header & Meta */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {badgeInfo && (
                  <Badge variant={badgeInfo.variant} className={badgeInfo.className}>
                    {badgeInfo.label}
                  </Badge>
                )}
                {doc.languages && doc.languages.length > 0 && (
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-mono">
                    {doc.languages.join(" · ")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void detail.reload();
                    void reminders.reload();
                  }}
                  disabled={detail.loading}
                  title="Refresh this document"
                  className="rounded-none"
                >
                  <RefreshCw data-icon="inline-start" className={detail.loading ? "animate-spin" : ""} />
                  Refresh
                </Button>
                {doc.url && (
                  <Button
                    nativeButton={false}
                    role="link"
                    variant="outline"
                    size="sm"
                    className="rounded-none"
                    render={<a href={doc.url} target="_blank" rel="noopener noreferrer" aria-label="Open in SharePoint" />}
                  >
                    <ExternalLink data-icon="inline-start" />
                    Open in SharePoint
                  </Button>
                )}
              </div>
            </div>

            {doc.path && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-mono">
                <FolderTree className="size-3.5 text-muted-foreground shrink-0" />
                <span className="truncate" title={doc.path}>
                  {doc.path}
                </span>
              </div>
            )}
            <h2 dir="auto" className="break-words text-lg font-semibold text-foreground">
              {doc.name}
            </h2>
          </div>

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 border border-border p-3.5 bg-muted/20 text-xs">
            <div>
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
                <FileText className="size-3.5 text-muted-foreground" /> File Size
              </span>
              <span className="font-semibold text-sm text-foreground">{formatBytes(doc.size)}</span>
            </div>
            <div>
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
                <Cpu className="size-3.5 text-muted-foreground" /> AI Model
              </span>
              <span className="font-semibold text-sm text-foreground truncate block" title={doc.model || "gpt-5.6-luna"}>
                {doc.model || "gpt-5.6-luna"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
                <Layers className="size-3.5 text-muted-foreground" /> Extracted Segments
              </span>
              <span className="font-semibold text-sm text-foreground">{doc.segments?.length ?? 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold">
                <Clock className="size-3.5 text-muted-foreground" /> Modified
              </span>
              <span className="font-semibold text-sm text-foreground truncate block" title={formatDateTime(doc.modified_at)}>
                {formatDateTime(doc.modified_at)}
              </span>
            </div>
          </div>

          {/* Keep the cost useful without exposing pricing math or token accounting. */}
          {doc.usage && (
            <div className="flex flex-col gap-2 border border-border bg-muted/20 p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <Coins className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">AI analysis</p>
                  {doc.processed_at && <p className="mt-0.5 text-xs text-muted-foreground">Processed {formatDateTime(doc.processed_at)}</p>}
                </div>
              </div>
              {costInfo && <p className="text-sm font-semibold tabular-nums sm:text-right"><span className="text-xs font-normal text-muted-foreground">Estimated cost </span>{costInfo.formatted}</p>}
            </div>
          )}

          {doc.error_code && (
            <Alert variant="destructive">
              <AlertDescription>{readableStatus(doc.error_code)}</AlertDescription>
            </Alert>
          )}

          <>
              {/* Contextual status alerts */}
              {doc.status === "processing" && (
                <Alert>
                  <AlertDescription className="animate-pulse">
                    Luna AI is currently analyzing this document and extracting tasks, deadlines, risks, and blockers…
                  </AlertDescription>
                </Alert>
              )}
              {doc.status === "failed" && isAdmin && (
                <div className="flex items-center justify-between gap-2 p-2 border border-destructive/20 bg-destructive/5 text-xs">
                  <span>You can re-run analysis for this document:</span>
                  <Button disabled={busy} onClick={() => void retry()} size="sm" className="rounded-none">
                    <RefreshCw data-icon="inline-start" />
                    Retry document
                  </Button>
                </div>
              )}

              {/* Main Content Tabs */}
              {doc.analysis ? (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                  <TabsList className="w-full justify-start h-auto min-h-12 sm:min-h-14 flex-wrap items-center gap-2 p-2 bg-muted/40 border border-border rounded-none">
                    <TabsTrigger value="analysis" className="flex items-center gap-2 rounded-none text-xs sm:text-sm h-9 sm:h-10 px-3.5 font-semibold">
                      <CheckSquare className="size-4 text-primary" />
                      Findings
                      <Badge variant="secondary" className="px-1.5 py-0.5 text-xs font-mono font-semibold rounded-none">
                        {findingsCount}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="expiries" className="flex items-center gap-2 rounded-none text-xs sm:text-sm h-9 sm:h-10 px-3.5 font-semibold">
                      <Calendar className="size-4 text-amber-500" />
                      Expiries & Pricing
                      <Badge variant="secondary" className="px-1.5 py-0.5 text-xs font-mono font-semibold rounded-none">
                        {expiriesCount + commercialsCount}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="flex items-center gap-2 rounded-none text-xs sm:text-sm h-9 sm:h-10 px-3.5 font-semibold">
                      <Bot className="size-4 text-sky-500" />
                      Luna Chat
                    </TabsTrigger>
                    <TabsTrigger value="segments" className="flex items-center gap-2 rounded-none text-xs sm:text-sm h-9 sm:h-10 px-3.5 font-semibold">
                      <Layers className="size-4 text-muted-foreground" />
                      Source Excerpts
                      <Badge variant="secondary" className="px-1.5 py-0.5 text-xs font-mono font-semibold rounded-none">
                        {doc.segments?.length ?? 0}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="analysis" className="space-y-4">
                    {doc.analysis.sections.map((section) => (
                      <FindingsTab
                        key={section.summary ? section.summary.slice(0, 60) : "section-main"}
                        section={section}
                        onViewSource={handleViewSource}
                      />
                    ))}
                    <p className="text-[11px] text-muted-foreground">
                      AI extraction can make mistakes. Verify the cited source before acting. Dates and owners are shown only when supported by the document.
                    </p>
                  </TabsContent>

                  <TabsContent value="expiries" className="space-y-4">
                    <ExpiriesTab
                      sections={doc.analysis.sections}
                      reminders={reminders.data || []}
                      onViewSource={handleViewSource}
                    />
                  </TabsContent>

                  <TabsContent value="chat">
                    <DocumentChatTab documentId={id} documentName={doc.name} />
                  </TabsContent>

                  <TabsContent value="segments" className="space-y-3">
                    <SourceExcerptsTab
                      segments={doc.segments}
                      activeSegmentId={activeSegmentId}
                      onClearActiveSegment={() => setActiveSegmentId(null)}
                    />
                  </TabsContent>
                </Tabs>
              ) : (
                <>
                  {!doc.analysis &&
                    doc.status !== "processing" && (
                      <p className="text-muted-foreground text-xs">
                        No completed analysis yet. Check the document status above.
                      </p>
                    )}
                  {!!doc.segments?.length && (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Layers className="size-3.5 text-primary" />
                        Extracted Source Excerpts ({doc.segments.length})
                      </h3>
                      <SourceExcerptsTab segments={doc.segments} />
                    </div>
                  )}
                </>
              )}
            </>
        </div>
      )}
    </Modal>
  );
}
