import { useEffect, useState } from "react";
import {
  Bot,
  Calendar,
  ChevronDown,
  FolderOpen,
  LayoutGrid,
  LayoutList,
  Link2,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Unplug,
  X,
  Zap,
} from "lucide-react";
import { api } from "@/api/client";
import {
  type SharePointStatus,
  formatBytes,
  getStatusBadgeInfo,
  readableStatus,
} from "@/api/sharepoint";
import { useAuth } from "@/auth/AuthContext";
import { useFetch } from "@/hooks/useApi";
import { Empty, Loading, PageHead, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CentralChatTab } from "./sharepoint/CentralChatTab";
import { TasksAndRemindersTab } from "./sharepoint/TasksAndRemindersTab";
import DocumentDialog from "./sharepoint/DocumentDialog";
import PrivacyDialog from "./sharepoint/PrivacyDialog";
import { useDocumentSearch } from "./sharepoint/useDocumentSearch";

function Documents({
  canReview,
  isAdmin,
  generation,
  syncStatus,
  onChanged,
}: {
  canReview: boolean;
  isAdmin: boolean;
  generation?: number;
  syncStatus?: string;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState({ q: "", cursor: "" });
  const [selected, setSelected] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return "cards";
    }
    return "table";
  });
  const result = useDocumentSearch(page.q, page.cursor);
  const docs = result.data?.items ?? [];
  const { reload: reloadDocs } = result;

  useEffect(() => {
    if (generation !== undefined || syncStatus) {
      void reloadDocs();
    }
  }, [generation, syncStatus, reloadDocs]);

  return (
    <Card className="rounded-none border-border min-w-0 max-w-full overflow-hidden">
      <CardHeader className="p-3.5 pb-2 border-b border-border/70 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <FolderOpen className="size-4 text-primary" />
              SharePoint Documents
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {result.data?.items ? `Indexed ${docs.length} accessible documents` : "Loading accessible files…"}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setPage({ q: search.trim(), cursor: "" });
              }}
              className="flex items-center gap-2 w-full sm:w-auto"
            >
              <div className="w-full sm:w-80">
                <InputGroup>
                  <InputGroupAddon align="inline-start">
                    <Search className="size-4 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="sharepoint-search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    maxLength={200}
                    placeholder="Search file, path, or text…"
                    className="text-sm h-10"
                  />
                  {search && (
                    <InputGroupButton
                      onClick={() => {
                        setSearch("");
                        setPage({ q: "", cursor: "" });
                      }}
                      title="Clear search"
                    >
                      <X className="size-3.5" />
                    </InputGroupButton>
                  )}
                </InputGroup>
              </div>

              <Button type="submit" size="default" disabled={result.loading} className="rounded-none text-sm font-semibold h-10 px-4">
                Search
              </Button>

              <Button
                variant="outline"
                size="default"
                aria-label="Refresh documents"
                onClick={() => void result.reload()}
                disabled={result.loading}
                className="rounded-none h-10 px-3"
                title="Refresh document list"
              >
                <RefreshCw data-icon="inline-start" className={result.loading ? "animate-spin size-4" : "size-4"} />
              </Button>
            </form>

            {/* View Mode Switcher */}
            <div className="flex items-center border border-border shrink-0">
              <Button
                type="button"
                variant={viewMode === "table" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("table")}
                className="h-10 px-3 text-xs font-semibold rounded-none gap-1.5"
                title="Table View (Horizontally Scrollable)"
              >
                <LayoutList className="size-3.5" />
                Table
              </Button>
              <Button
                type="button"
                variant={viewMode === "cards" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("cards")}
                className="h-10 px-3 text-xs font-semibold rounded-none gap-1.5"
                title="Card View"
              >
                <LayoutGrid className="size-3.5" />
                Cards
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-3.5">
        {result.loading && !result.data && <Loading />}
        {result.error && (
          <Alert variant="destructive">
            <AlertDescription>{readableStatus(result.error)}. Reconnect Microsoft if your session has expired.</AlertDescription>
          </Alert>
        )}
        {!result.loading && !result.error && docs.length === 0 && (
          <Empty
            icon={<FolderOpen />}
            message="No accessible documents found"
            hint="Click 'Sync Now' above to discover files in your configured SharePoint folder."
          />
        )}

        {docs.length > 0 && (
          <>
            {/* Card View */}
            {viewMode === "cards" && (
              <div className="space-y-3">
                {docs.map((doc) => {
                  const badge = getStatusBadgeInfo(doc.status);
                  return (
                    <Card key={doc.id} className="rounded-none border-border">
                      <CardContent className="space-y-3 pt-4">
                        <h3 dir="auto" className="break-words font-semibold text-base text-foreground">{doc.name}</h3>
                        {doc.path && (
                          <p className="text-xs text-muted-foreground font-mono break-all">{doc.path}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant={badge.variant} className={cn(badge.className, "rounded-none text-xs font-semibold py-1 px-2")}>
                            {badge.label}
                          </Badge>
                          {doc.requires_attention && (
                            <Badge variant="secondary" className="border-amber-500/30 text-amber-800 dark:text-amber-300 rounded-none text-xs font-semibold py-1 px-2">
                              Needs attention
                            </Badge>
                          )}
                          {!!doc.size && <span className="text-muted-foreground text-xs font-medium">{formatBytes(doc.size)}</span>}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setSelected(doc.id)} className="rounded-none h-9 text-xs font-semibold">
                          View document
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Horizontally Scrollable Table View */}
            {viewMode === "table" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span>
                    Showing <strong>{docs.length}</strong> documents
                  </span>
                  <span className="font-mono text-xs text-muted-foreground font-medium">
                    ↔ Scroll horizontally to view all columns
                  </span>
                </div>
                <div className="w-full max-w-full border border-border overflow-x-auto">
                  <Table className="w-full min-w-[800px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[280px] max-w-[450px] py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase">
                          Document & Folder Path
                        </TableHead>
                        <TableHead className="min-w-[160px] whitespace-nowrap py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase">
                          Status
                        </TableHead>
                        <TableHead className="min-w-[100px] whitespace-nowrap py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase">
                          Size
                        </TableHead>
                        <TableHead className="min-w-[110px] whitespace-nowrap py-3 px-3.5 text-xs font-bold text-foreground/80 uppercase">
                          Languages
                        </TableHead>
                        <TableHead className="min-w-[140px] whitespace-nowrap text-end py-3 px-3.5">
                          <span className="sr-only">Action</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {docs.map((doc) => {
                        const badge = getStatusBadgeInfo(doc.status);
                        return (
                          <TableRow key={doc.id}>
                            <TableCell className="min-w-[280px] max-w-[450px] align-middle py-3.5 px-3.5">
                              <span dir="auto" className="block break-words whitespace-normal font-semibold text-sm sm:text-base text-foreground">
                                {doc.name}
                              </span>
                              {doc.path && (
                                <span className="block text-xs text-muted-foreground font-mono break-words whitespace-normal mt-1">
                                  {doc.path}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="min-w-[160px] whitespace-nowrap align-middle py-3.5 px-3.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant={badge.variant} className={cn(badge.className, "rounded-none text-xs font-semibold py-1 px-2")}>
                                  {badge.label}
                                </Badge>
                                {doc.requires_attention && (
                                  <Badge variant="secondary" className="border-amber-500/30 text-amber-800 dark:text-amber-300 rounded-none text-xs font-semibold py-1 px-2">
                                    Needs attention
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="min-w-[100px] whitespace-nowrap align-middle py-3.5 px-3.5 text-xs font-medium text-muted-foreground">
                              {formatBytes(doc.size)}
                            </TableCell>
                            <TableCell className="min-w-[110px] whitespace-nowrap align-middle py-3.5 px-3.5 text-xs text-muted-foreground font-mono uppercase font-semibold">
                              {doc.languages.join(", ") || "—"}
                            </TableCell>
                            <TableCell className="min-w-[140px] whitespace-nowrap align-middle py-3.5 px-3.5 text-end">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelected(doc.id)}
                                aria-label={`View ${doc.name}`}
                                className="rounded-none h-8 text-xs font-semibold px-3"
                              >
                                View document
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </>
        )}

        {!result.loading && !result.error && (page.cursor || result.data?.next_cursor) && (
          <div className="flex gap-2 pt-2">
            {page.cursor && (
              <Button variant="outline" size="sm" onClick={() => setPage({ ...page, cursor: "" })} className="rounded-none">
                First page
              </Button>
            )}
            {result.data?.next_cursor && (
              <Button variant="outline" size="sm" onClick={() => setPage({ ...page, cursor: result.data?.next_cursor || "" })} className="rounded-none">
                Next page
              </Button>
            )}
          </div>
        )}

        {selected && (
          <DocumentDialog
            key={selected}
            id={selected}
            canReview={canReview}
            isAdmin={isAdmin}
            onClose={() => setSelected(null)}
            onChanged={() => {
              void result.reload();
              onChanged();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}



function ConnectedSource({
  status,
  isAdmin,
  reload,
}: {
  status: SharePointStatus;
  isAdmin: boolean;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const { notify } = useToast();

  async function action(path: string, message: string, method: "POST" | "DELETE" = "POST") {
    setBusy(true);
    try {
      await api(`/api/sharepoint/${path}`, { method });
      notify(message);
      setGeneration((value) => value + 1);
      await reload();
    } catch (error) {
      notify(readableStatus(error instanceof Error ? error.message : "Request failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutoPolicy() {
    setBusy(true);
    const nextPolicy = status.policy === "auto" ? "review" : "auto";
    try {
      await api("/api/sharepoint/rules", {
        method: "PUT",
        body: { policy: nextPolicy, terms: [] },
      });
      notify(
        `Compliance mode switched to ${
          nextPolicy === "auto" ? "Automatic (Instant AI)" : "Manual Review"
        }.`
      );
      setGeneration((v) => v + 1);
      await reload();
    } catch (err) {
      notify(readableStatus(err instanceof Error ? err.message : "Failed to switch policy"), "error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!status.active_run) return;
    const timer = window.setInterval(() => {
      void reload();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [status.active_run, reload]);

  return (
    <div className="space-y-4 min-w-0 max-w-full">
      {/* Streamlined Executive Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge
            variant={status.connected ? "outline" : "secondary"}
            className={
              status.connected
                ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400 gap-1.5 py-0.5 rounded-none"
                : "rounded-none"
            }
          >
            <span
              className={cn(
                "size-2 rounded-full",
                status.connected ? "bg-emerald-500" : "bg-muted-foreground"
              )}
            />
            {status.connected ? "SharePoint Connected" : "Disconnected"}
          </Badge>

          <Badge variant="outline" className="gap-1 py-0.5 rounded-none text-xs">
            <Zap
              className={cn(
                "size-3",
                status.policy === "auto" ? "text-amber-500" : "text-muted-foreground"
              )}
            />
            {status.policy === "auto" ? "Auto-AI Enabled" : "Manual Review Mode"}
          </Badge>

          {status.run && (
            <span className="text-muted-foreground font-mono text-[11px] hidden sm:inline">
              Last sync: {readableStatus(status.run.status)} ({status.run.processed} indexed)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Primary Action Button: Sync Now */}
          {status.connected && (
            <Button
              size="sm"
              disabled={busy || status.active_run}
              onClick={() => void action("sync", "Document sync queued.")}
              className="rounded-none gap-1.5 text-xs font-medium h-8"
            >
              <RefreshCw
                data-icon="inline-start"
                className={status.active_run ? "animate-spin" : ""}
              />
              {status.active_run ? "Syncing…" : "Sync Now"}
            </Button>
          )}

          {status.configured && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPrivacyOpen(true)}
              className="rounded-none gap-1.5 text-xs h-8"
            >
              <ShieldCheck data-icon="inline-start" className="size-3.5" />
              Privacy policy
            </Button>
          )}

          {/* Unified Options Dropdown Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  className="rounded-none gap-1 text-xs h-8"
                >
                  <Settings2 data-icon="inline-start" className="size-3.5" />
                  Source Options
                  <ChevronDown className="size-3 text-muted-foreground" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-56 rounded-none">
              <DropdownMenuItem
                onClick={() => void toggleAutoPolicy()}
                className="gap-2 cursor-pointer text-xs"
              >
                <Zap className="size-3.5 text-amber-500" />
                <span>
                  {status.policy === "auto"
                    ? "Switch to Manual Review"
                    : "Enable Auto-AI Processing"}
                </span>
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => setPrivacyOpen(true)}
                className="gap-2 cursor-pointer text-xs"
              >
                <ShieldCheck className="size-3.5 text-primary" />
                <span>Privacy & Redaction Rules</span>
              </DropdownMenuItem>

              {isAdmin && (
                <DropdownMenuItem
                  onClick={() =>
                    void action("test-connection", "SharePoint read access verified.")
                  }
                  className="gap-2 cursor-pointer text-xs"
                >
                  <FolderOpen className="size-3.5 text-muted-foreground" />
                  <span>Test SharePoint Access</span>
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                render={
                  <a
                    href="/api/sharepoint/connect"
                    className="flex items-center gap-2 cursor-pointer text-xs w-full text-foreground"
                  >
                    <Link2 className="size-3.5 text-muted-foreground" />
                    <span>{status.connected ? "Reconnect Microsoft" : "Connect Microsoft"}</span>
                  </a>
                }
              />

              {status.connected && (
                <DropdownMenuItem
                  onClick={() =>
                    void action("connection", "Microsoft access disconnected.", "DELETE")
                  }
                  className="gap-2 cursor-pointer text-xs text-destructive focus:text-destructive"
                >
                  <Unplug className="size-3.5 text-destructive" />
                  <span>Disconnect SharePoint</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Main Tabs: 4 Pillars layout */}
      {status.connected ? (
        <Tabs defaultValue="documents" className="space-y-4 min-w-0 max-w-full">
          <TabsList className="w-full justify-start h-auto flex-wrap gap-2 p-1.5 bg-muted/60 border border-border rounded-none">
            <TabsTrigger
              value="documents"
              className="flex items-center gap-2 rounded-none text-xs sm:text-sm px-4 py-2.5 font-medium text-foreground/80 hover:text-foreground border border-transparent data-active:border-border data-active:bg-background dark:data-active:bg-card data-active:text-foreground data-active:font-bold transition-colors shadow-xs"
            >
              <FolderOpen className="size-4 text-primary" /> Documents Library
            </TabsTrigger>
            <TabsTrigger
              value="chat"
              className="flex items-center gap-2 rounded-none text-xs sm:text-sm px-4 py-2.5 font-medium text-foreground/80 hover:text-foreground border border-transparent data-active:border-border data-active:bg-background dark:data-active:bg-card data-active:text-foreground data-active:font-bold transition-colors shadow-xs"
            >
              <Bot className="size-4 text-primary" /> AI Document Assistant
            </TabsTrigger>
            <TabsTrigger
              value="reminders"
              className="flex items-center gap-2 rounded-none text-xs sm:text-sm px-4 py-2.5 font-medium text-foreground/80 hover:text-foreground border border-transparent data-active:border-border data-active:bg-background dark:data-active:bg-card data-active:text-foreground data-active:font-bold transition-colors shadow-xs"
            >
              <Calendar className="size-4 text-sky-500" /> Tasks & Reminders
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="min-w-0 max-w-full">
            {!busy && (
              <Documents
                canReview={status.can_review}
                isAdmin={isAdmin}
                generation={generation}
                syncStatus={status.run?.status}
                onChanged={() => void reload()}
              />
            )}
          </TabsContent>

          <TabsContent value="chat" className="min-w-0 max-w-full">
            <CentralChatTab />
          </TabsContent>

          <TabsContent value="reminders" className="min-w-0 max-w-full">
            <TasksAndRemindersTab isAdmin={isAdmin} />
          </TabsContent>
        </Tabs>
      ) : (
        <Card className="rounded-none border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Link2 className="size-4 text-primary" />
              Connect Microsoft 365
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sign in with your work Microsoft account to allow Company Tools to index and extract intelligence from your accessible SharePoint documents.
            </p>
            <Button
              nativeButton={false}
              role="link"
              render={<a href="/api/sharepoint/connect" aria-label="Connect Microsoft" />}
              className="rounded-none"
            >
              <Link2 data-icon="inline-start" />
              Connect Microsoft
            </Button>
          </CardContent>
        </Card>
      )}

      {privacyOpen && (
        <PrivacyDialog
          onClose={() => setPrivacyOpen(false)}
          onSaved={() => {
            setPrivacyOpen(false);
            setGeneration((value) => value + 1);
            void reload();
          }}
        />
      )}
    </div>
  );
}

export default function SharePointPage() {
  const status = useFetch<SharePointStatus>("/api/sharepoint/status");
  const { user } = useAuth();
  const value = !status.loading && !status.error ? status.data : null;

  return (
    <div className="space-y-5">
      <PageHead
        title="SharePoint Intelligence"
        subtitle="Automated document analysis, deadline expirations, commercial pricing, and Luna Q&A."
      />
      {status.loading && <Loading />}
      {status.error && (
        <Alert variant="destructive">
          <AlertDescription>{readableStatus(status.error)}</AlertDescription>
        </Alert>
      )}
      {value && (!value.enabled || !value.configured) && (
        <Card className="rounded-none border-border">
          <CardHeader>
            <CardTitle>SharePoint setup required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              An administrator needs to configure the test SharePoint source and enable this module.
            </p>
            {value.missing.length > 0 && (
              <ul className="list-inside list-disc break-all text-xs">
                {value.missing.map((key) => (
                  <li key={key}>{key}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
      {value?.enabled && value.configured && (
        <ConnectedSource status={value} isAdmin={Boolean(user?.is_admin)} reload={status.reload} />
      )}
    </div>
  );
}
