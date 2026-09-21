import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Link2,
} from "lucide-react";
import { api } from "@/api/client";
import {
  type SharePointDocument,
  type SharePointReminder,
  type SharePointStatus,
  readableStatus,
} from "@/api/sharepoint";
import { useAuth } from "@/auth/AuthContext";
import { useFetch } from "@/hooks/useApi";
import { Loading, PageHead, useToast } from "@/components/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentsHomeTab } from "./sharepoint/DocumentsHomeTab";
import { MyDocumentsTab } from "./sharepoint/MyDocumentsTab";
import { CentralChatTab } from "./sharepoint/CentralChatTab";
import { AlertsRemindersTab } from "./sharepoint/AlertsRemindersTab";
import { AdminSourcesTab } from "./sharepoint/AdminSourcesTab";
import DocumentDialog from "./sharepoint/DocumentDialog";
import PrivacyDialog from "./sharepoint/PrivacyDialog";
import { useDocumentSearch } from "./sharepoint/useDocumentSearch";

function ConnectedSource({
  status,
  isAdmin,
  reload,
  tab: propTab,
}: {
  status: SharePointStatus;
  isAdmin: boolean;
  reload: () => Promise<unknown>;
  tab?: "home" | "documents" | "assistant" | "alerts" | "admin";
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab = useMemo(() => {
    if (rawTab) {
      if (rawTab === "admin" && isAdmin) return "admin";
      if (rawTab === "chat" || rawTab === "assistant") return "assistant";
      if (rawTab === "reminders" || rawTab === "alerts") return "alerts";
      if (rawTab === "documents") return "documents";
      return "home";
    }
    if (propTab) return propTab;
    const path = location.pathname;
    if (path.endsWith("/documents")) return "documents";
    if (path.endsWith("/assistant")) return "assistant";
    if (path.endsWith("/alerts")) return "alerts";
    if (path.endsWith("/admin") && isAdmin) return "admin";
    return "home";
  }, [rawTab, propTab, location.pathname, isAdmin]);

  // Synchronize legacy ?tab= query parameter to corresponding clean path
  useEffect(() => {
    if (rawTab) {
      const remainingParams = new URLSearchParams(searchParams);
      remainingParams.delete("tab");
      const qs = remainingParams.toString() ? `?${remainingParams.toString()}` : "";
      if (rawTab === "documents" && location.pathname !== "/sharepoint/documents") {
        navigate(`/sharepoint/documents${qs}`, { replace: true });
      } else if ((rawTab === "chat" || rawTab === "assistant") && location.pathname !== "/sharepoint/assistant") {
        navigate(`/sharepoint/assistant${qs}`, { replace: true });
      } else if ((rawTab === "reminders" || rawTab === "alerts") && location.pathname !== "/sharepoint/alerts") {
        navigate(`/sharepoint/alerts${qs}`, { replace: true });
      } else if (rawTab === "admin" && isAdmin && location.pathname !== "/sharepoint/admin") {
        navigate(`/sharepoint/admin${qs}`, { replace: true });
      }
    }
  }, [rawTab, searchParams, location.pathname, isAdmin, navigate]);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState({ q: "", cursor: "" });
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("All types");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [assistantQuery, setAssistantQuery] = useState<string | undefined>();
  const [assistantDocId, setAssistantDocId] = useState<string | undefined>();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  const locationState = location.state as { query?: string; docId?: string } | null;
  const currentAssistantQuery =
    searchParams.get("q") || locationState?.query || assistantQuery;
  const currentAssistantDocId =
    searchParams.get("docId") || locationState?.docId || assistantDocId;

  const searchResult = useDocumentSearch(page.q, page.cursor);
  const docs = searchResult.data?.items ?? [];
  const { reload: reloadDocs } = searchResult;

  const remindersFetch = useFetch<SharePointReminder[]>("/api/sharepoint/reminders");
  const remindersData = remindersFetch.data;
  const reminders = useMemo(
    () => (Array.isArray(remindersData) ? remindersData : []),
    [remindersData]
  );
  const { reload: reloadReminders } = remindersFetch;



  const handleNavigateTab = (
    tab: "home" | "documents" | "assistant" | "alerts" | "admin",
    query?: string,
    docId?: string
  ) => {
    const targetPath = tab === "home" ? "/sharepoint" : `/sharepoint/${tab}`;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (docId) params.set("docId", docId);
    const qs = params.toString() ? `?${params.toString()}` : "";

    if (query !== undefined) setAssistantQuery(query);
    if (docId !== undefined) setAssistantDocId(docId);
    navigate(`${targetPath}${qs}`, { state: { query, docId } });
  };

  const handleAskAboutDoc = (doc: SharePointDocument) => {
    handleNavigateTab(
      "assistant",
      `What are the key terms, deadlines, and responsibilities in ${doc.name}?`,
      doc.id
    );
  };

  const handlePrevPage = () => {
    if (cursorHistory.length > 0) {
      const prevCursor = cursorHistory[cursorHistory.length - 1];
      setCursorHistory((prev) => prev.slice(0, -1));
      setPage((prev) => ({ ...prev, cursor: prevCursor }));
    }
  };

  const handleNextPage = () => {
    if (searchResult.data?.next_cursor) {
      setCursorHistory((prev) => [...prev, page.cursor]);
      setPage((prev) => ({ ...prev, cursor: searchResult.data?.next_cursor || "" }));
    }
  };

  const handleSearchSubmit = () => {
    setCursorHistory([]);
    setPage({ q: search.trim(), cursor: "" });
  };

  async function handleCompleteReminder(reminderId: string) {
    try {
      await api(`/api/sharepoint/reminders/${reminderId}/complete`, { method: "POST" });
      notify("Reminder marked as completed!");
      window.dispatchEvent(new CustomEvent("sharepoint-reminders-updated"));
      void reloadReminders();
    } catch (err) {
      notify(readableStatus(err instanceof Error ? err.message : "Completion failed"), "error");
    }
  }

  async function handleDismissReminder(reminderId: string) {
    try {
      await api(`/api/sharepoint/reminders/${reminderId}/dismiss`, { method: "POST" });
      notify("Reminder dismissed!");
      window.dispatchEvent(new CustomEvent("sharepoint-reminders-updated"));
      void reloadReminders();
    } catch (err) {
      notify(readableStatus(err instanceof Error ? err.message : "Dismissal failed"), "error");
    }
  }

  async function handleSnoozeReminder(reminderId: string, days: number) {
    try {
      const existing = reminders.find((r) => r.id === reminderId);
      const baseDate = existing ? new Date(existing.target_date) : new Date();
      baseDate.setDate(baseDate.getDate() + days);
      const nextTarget = baseDate.toISOString().split("T")[0];

      await api(`/api/sharepoint/reminders/${reminderId}`, {
        method: "PATCH",
        body: { target_date: nextTarget },
      });
      notify(`Reminder snoozed for ${days} days!`);
      window.dispatchEvent(new CustomEvent("sharepoint-reminders-updated"));
      void reloadReminders();
    } catch (err) {
      notify(readableStatus(err instanceof Error ? err.message : "Snooze failed"), "error");
    }
  }

  async function action(subpath: string, message: string, method: "POST" | "DELETE" = "POST") {
    setBusy(true);
    try {
      await api(`/api/sharepoint/${subpath}`, { method });
      notify(message);
      await reload();
      void reloadDocs();
      void reloadReminders();
    } catch (error) {
      notify(readableStatus(error instanceof Error ? error.message : "action_failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutoPolicy() {
    setBusy(true);
    try {
      const current = await api<{ policy: string; terms: unknown[] }>("/api/sharepoint/rules");
      const nextPolicy = current.policy === "auto" ? "review" : "auto";
      await api("/api/sharepoint/rules", {
        method: "PUT",
        body: { policy: nextPolicy, terms: current.terms },
      });
      notify(
        nextPolicy === "auto"
          ? "Switched to Auto-AI Processing policy."
          : "Switched to Manual Review policy."
      );
      await reload();
      void reloadDocs();
      void reloadReminders();
    } catch (err) {
      notify(readableStatus(err instanceof Error ? err.message : "toggle_failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!status.active_run) return;
    const timer = window.setInterval(() => {
      void reload();
      void reloadDocs();
      void reloadReminders();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [status.active_run, reload, reloadDocs, reloadReminders]);

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {status.connected ? (
        <div className="min-w-0 max-w-full">
          {activeTab === "home" && (
            <DocumentsHomeTab
              documents={docs}
              reminders={reminders}
              status={status}
              isLoadingDocs={searchResult.loading}
              isLoadingReminders={remindersFetch.loading}
              onNavigateTab={handleNavigateTab}
              onOpenDoc={(id) => setSelectedDocId(id)}
              onCompleteReminder={handleCompleteReminder}
              onSnoozeReminder={handleSnoozeReminder}
            />
          )}

          {activeTab === "documents" && (
            <MyDocumentsTab
              documents={docs}
              totalCount={searchResult.data?.items?.length}
              nextCursor={searchResult.data?.next_cursor}
              isLoading={searchResult.loading}
              error={searchResult.error}
              search={search}
              onSearchChange={setSearch}
              onSearchSubmit={handleSearchSubmit}
              categoryFilter={categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
              onPrevPage={handlePrevPage}
              onNextPage={handleNextPage}
              hasPrevPage={cursorHistory.length > 0}
              hasNextPage={Boolean(searchResult.data?.next_cursor)}
              onOpenDoc={(id) => setSelectedDocId(id)}
              onAskAboutDoc={handleAskAboutDoc}
              onRefresh={() => void reloadDocs()}
            />
          )}

          {activeTab === "assistant" && (
            <CentralChatTab
              initialQuery={currentAssistantQuery}
              initialDocId={currentAssistantDocId}
              onOpenDoc={(id) => setSelectedDocId(id)}
              onNavigateTab={handleNavigateTab}
            />
          )}

          {activeTab === "alerts" && (
            <AlertsRemindersTab
              reminders={reminders}
              isLoading={remindersFetch.loading}
              isAdmin={isAdmin}
              onComplete={handleCompleteReminder}
              onDismiss={handleDismissReminder}
              onSnooze={handleSnoozeReminder}
              onOpenDoc={(id) => setSelectedDocId(id)}
              onRefresh={() => void reloadReminders()}
            />
          )}

          {activeTab === "admin" && isAdmin && (
            <AdminSourcesTab
              status={status}
              documents={docs}
              onTestAccess={() =>
                action("test-connection", "SharePoint read access verified.")
              }
              onSyncNow={() => action("sync", "Document sync queued.")}
              onToggleAutoPolicy={toggleAutoPolicy}
              onOpenPrivacy={() => setPrivacyOpen(true)}
              onOpenReviewQueue={() => {
                setCategoryFilter("All types");
                handleNavigateTab("documents");
              }}
              isBusy={busy}
            />
          )}
        </div>
      ) : (
        <Card className="rounded-none border-border shadow-xs">
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

      {selectedDocId && (
        <DocumentDialog
          id={selectedDocId}
          canReview={status.can_review}
          isAdmin={isAdmin}
          onClose={() => setSelectedDocId(null)}
          onChanged={() => {
            void reload();
            void reloadDocs();
            void reloadReminders();
          }}
        />
      )}

      {privacyOpen && (
        <PrivacyDialog
          onClose={() => setPrivacyOpen(false)}
          onSaved={() => {
            setPrivacyOpen(false);
            void reload();
            void reloadDocs();
            void reloadReminders();
          }}
        />
      )}
    </div>
  );
}

export default function SharePointPage({
  tab,
}: {
  tab?: "home" | "documents" | "assistant" | "alerts" | "admin";
}) {
  const status = useFetch<SharePointStatus>("/api/sharepoint/status");
  const { user } = useAuth();
  const value = !status.error ? (status.data ?? null) : null;

  return (
    <div className="space-y-5">
      {(!value || !value.enabled || !value.configured) && (
        <PageHead
          title="SharePoint Intelligence"
          subtitle="Automated document analysis, deadline expirations, commercial pricing, and Luna Q&A."
        />
      )}
      {status.loading && !status.data && <Loading />}
      {status.error && (
        <Alert variant="destructive">
          <AlertDescription>{readableStatus(status.error)}</AlertDescription>
        </Alert>
      )}
      {value && (!value.enabled || !value.configured) && (
        <Card className="rounded-none border-border shadow-xs">
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
        <ConnectedSource
          status={value}
          isAdmin={Boolean(user?.is_admin)}
          reload={status.reload}
          tab={tab}
        />
      )}
    </div>
  );
}
