import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Bot,
  Calendar,
  Check,
  Clock,
  Copy,
  DollarSign,
  ExternalLink,
  FileText,
  Send,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "@/api/client";
import {
  type ChatCitation,
  type ChatMessage,
  type ChatResponse,
  type SharePointDocument,
  readableStatus,
} from "@/api/sharepoint";
import { useToast } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentSearch } from "./useDocumentSearch";

export type CentralChatItem = ChatMessage & {
  id: string;
  citations?: ChatCitation[];
  followUps?: string[];
};

export interface CentralChatTabProps {
  initialQuery?: string;
  initialDocId?: string;
  onOpenDoc?: (docId: string) => void;
  onNavigateTab?: (tab: "home" | "documents" | "assistant" | "alerts") => void;
}

const SUGGESTIONS = [
  {
    icon: Calendar,
    label: "Expiring Licences & Contracts",
    prompt: "Which licences are expiring in the next 3 months?",
  },
  {
    icon: DollarSign,
    label: "Active Contracts & Pricing",
    prompt: "Which contracts are currently active, and what are their commercial fee terms and total values?",
  },
  {
    icon: AlertTriangle,
    label: "Cross-Document Risks",
    prompt: "What are the highest priority risks and blockers identified across all accessible documents?",
  },
  {
    icon: Users,
    label: "Key Deliverable Owners",
    prompt: "Who is responsible for each expiring licence or contract?",
  },
  {
    icon: Clock,
    label: "Pending Deadlines",
    prompt: "Show me all upcoming deadlines across the documents I can access.",
  },
  {
    icon: FileText,
    label: "Corpus Overview",
    prompt: "Provide an executive summary of all accessible documents and their current status.",
  },
];

export function CentralChatTab({
  initialQuery,
  initialDocId,
  onOpenDoc,
  onNavigateTab,
}: CentralChatTabProps) {
  const [messages, setMessages] = useState<CentralChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string>(initialDocId || "all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastHandledQuery = useRef<string | null>(null);
  const activeRequestId = useRef<number>(0);
  const { notify } = useToast();

  const docSearchResult = useDocumentSearch("", "");
  const docs: SharePointDocument[] = docSearchResult.data?.items ?? [];

  function getErrorExplanation(rawMsg: string): string {
    const lower = rawMsg.toLowerCase();
    if (lower.includes("microsoft_connection_required")) {
      return "Your Microsoft 365 connection is required to verify permissions and search documents. Please click 'Connect Microsoft' or reconnect your account above.";
    }
    if (lower.includes("openai_not_configured")) {
      return "The AI intelligence service is currently not configured with an API key. Please contact your system administrator.";
    }
    if (lower.includes("invalid_request_origin")) {
      return "Security verification rejected the request origin. Please refresh the page and try again.";
    }
    if (lower.includes("not found")) {
      return "The AI chat service endpoint was not found on the server. Please ensure the backend server has been restarted with the latest routes.";
    }
    if (lower.includes("analysis_provider_error")) {
      return "The AI service provider encountered an error while generating a response. Please check API credentials and quota.";
    }
    return readableStatus(rawMsg);
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  useEffect(() => {
    if (initialDocId) {
      setSelectedDocId(initialDocId);
    }
  }, [initialDocId]);

  useEffect(() => {
    if (!initialQuery || lastHandledQuery.current === initialQuery) return;
    lastHandledQuery.current = initialQuery;
    const content = initialQuery.trim();
    if (!content) return;

    setInput(content);

    const userMsg: CentralChatItem = { id: crypto.randomUUID(), role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);

    const currentReqId = ++activeRequestId.current;
    const docIdsPayload = initialDocId && initialDocId !== "all" ? [initialDocId] : undefined;
    void api<ChatResponse>("/api/sharepoint/chat", {
      method: "POST",
      body: {
        messages: [{ role: "user", content }],
        document_ids: docIdsPayload,
      },
    })
      .then((resp) => {
        if (currentReqId !== activeRequestId.current) return;
        setInput("");
        const isExpiryQuery =
          content.toLowerCase().includes("expir") || content.toLowerCase().includes("licence");
        const followUps = isExpiryQuery
          ? ["Create reminders for these", "Who is responsible for each?"]
          : ["Show relevant contracts", "Summarize main risks"];
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: resp.reply,
            citations: resp.citations,
            followUps,
          },
        ]);
      })
      .catch((err) => {
        if (currentReqId !== activeRequestId.current) return;
        const rawMsg = err instanceof Error ? err.message : "Chat failed";
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `⚠️ **Assistant query failed**: ${getErrorExplanation(rawMsg)}`,
          },
        ]);
        notify(readableStatus(rawMsg), "error");
      })
      .finally(() => {
        setBusy(false);
      });
  }, [initialQuery, initialDocId, notify]);

  async function send(textToSend?: string) {
    const content = (textToSend ?? input).trim();
    if (!content || busy) return;

    const currentReqId = ++activeRequestId.current;
    const userMsg: CentralChatItem = { id: crypto.randomUUID(), role: "user", content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);

    try {
      const docIdsPayload = selectedDocId !== "all" ? [selectedDocId] : undefined;
      const resp = await api<ChatResponse>("/api/sharepoint/chat", {
        method: "POST",
        body: {
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          document_ids: docIdsPayload,
        },
      });

      if (currentReqId !== activeRequestId.current) return;

      const isExpiryQuery = content.toLowerCase().includes("expir") || content.toLowerCase().includes("licence");
      const followUps = isExpiryQuery
        ? ["Create reminders for these", "Who is responsible for each?"]
        : ["Show relevant contracts", "Summarize main risks"];

      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: resp.reply,
          citations: resp.citations,
          followUps,
        },
      ]);
    } catch (err) {
      if (currentReqId !== activeRequestId.current) return;
      const rawMsg = err instanceof Error ? err.message : "Chat failed";
      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `⚠️ **Assistant query failed**: ${getErrorExplanation(rawMsg)}`,
        },
      ]);
      notify(readableStatus(rawMsg), "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyMessage(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      // Clipboard write failed
    }
  }

  function clearChat() {
    setMessages([]);
  }

  function handleFollowUpClick(actionText: string) {
    if (actionText === "Create reminders for these" && onNavigateTab) {
      onNavigateTab("alerts");
      return;
    }
    void send(actionText);
  }

  return (
    <div className="space-y-4">
      {/* Header matching Proposed — Assistant */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Assistant</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Answering only from the {docs.length > 0 ? docs.length : "18"} documents you have access to.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Scope Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground hidden sm:inline">Scope:</span>
            <Select
              value={selectedDocId}
              onValueChange={(val) => {
                if (val) setSelectedDocId(val);
              }}
            >
              <SelectTrigger className="h-8.5 text-xs rounded-none min-w-[170px] max-w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none">
                <SelectGroup>
                  <SelectItem value="all">
                    All Accessible Files ({docs.length > 0 ? docs.length : "…"})
                  </SelectItem>
                  {docs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearChat}
              disabled={busy}
              className="h-8.5 px-2.5 text-xs rounded-none text-muted-foreground hover:text-foreground"
              title="Clear conversation"
            >
              <Trash2 data-icon="inline-start" className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {!docSearchResult.loading && docs.length === 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 text-xs sm:text-sm text-amber-800 dark:text-amber-300 rounded-none">
          <AlertTriangle className="size-4.5 text-amber-600 shrink-0" />
          <span>
            No accessible SharePoint documents are indexed yet. Switch to the Documents tab to verify Microsoft access.
          </span>
        </div>
      )}

      {/* Chat Container Card */}
      <Card className="rounded-none border-border bg-card shadow-xs">
        <CardContent className="p-4 sm:p-6 flex flex-col gap-5 min-h-[460px]">
          {/* Suggestions if chat is empty */}
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center py-8 text-center border border-dashed border-border p-6 my-auto">
              <div className="space-y-2 max-w-md mx-auto">
                <Sparkles className="size-8 mx-auto text-primary opacity-80" />
                <h2 className="text-base sm:text-lg font-bold text-foreground">Ask about your documents</h2>
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Get precise answers with exact page and section citations from contracts, licences, pricing sheets, and policies.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-w-3xl w-full mx-auto pt-5">
                {SUGGESTIONS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.label}
                      type="button"
                      disabled={busy}
                      onClick={() => void send(s.prompt)}
                      className="flex items-start gap-2.5 p-3 text-start border border-border hover:border-primary/60 hover:bg-muted/30 transition-colors group rounded-none disabled:opacity-50 text-xs bg-background"
                    >
                      <Icon className="size-4 text-primary shrink-0 mt-0.5" />
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-semibold text-foreground">{s.label}</div>
                        <div className="text-muted-foreground line-clamp-2">{s.prompt}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Message Stream */}
          {messages.length > 0 && (
            <div
              ref={scrollRef}
              className="flex-1 space-y-4 max-h-[520px] overflow-y-auto pr-1"
            >
              {messages.map((m) => {
                const isUser = m.role === "user";
                const isCopied = copiedMsgId === m.id;

                return (
                  <div key={m.id} className="flex flex-col gap-2">
                    {isUser ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] sm:max-w-xl bg-primary text-primary-foreground p-3 sm:p-3.5 text-sm sm:text-base leading-relaxed rounded-none shadow-xs">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3 items-start max-w-full">
                        <div className="size-8 shrink-0 bg-primary/10 border border-primary/20 flex items-center justify-center text-primary rounded-none">
                          <Bot className="size-4.5" />
                        </div>
                        <div className="min-w-0 flex-grow bg-card border border-border p-4 sm:p-5 rounded-none shadow-xs space-y-3">
                          <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/50 pb-2">
                            <span className="font-semibold text-foreground">Assistant</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => void copyMessage(m.id, m.content)}
                              className="h-6 px-2 text-xs gap-1 rounded-none text-muted-foreground hover:text-foreground"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="size-3 text-emerald-600" />
                                  <span className="text-emerald-600 font-medium">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="size-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </Button>
                          </div>

                          <div className="space-y-2.5 break-words text-sm sm:text-base leading-relaxed [&_ul]:list-disc [&_ul]:ms-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ms-5 [&_ol]:my-2 [&_li]:my-1 [&_strong]:font-bold [&_strong]:text-foreground [&_a]:text-primary [&_a]:underline [&_p]:my-1.5 [&_table]:w-full [&_table]:border [&_table]:border-border [&_table]:my-3 [&_th]:border [&_th]:border-border [&_th]:p-2.5 [&_th]:bg-muted/40 [&_td]:border [&_td]:border-border [&_td]:p-2.5">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                table: ({ children }) => (
                                  <div className="overflow-x-auto my-3 border border-border bg-card">
                                    <table className="w-full min-w-max text-xs sm:text-sm border-collapse">
                                      {children}
                                    </table>
                                  </div>
                                ),
                                thead: ({ children }) => (
                                  <thead className="bg-muted/60 border-b border-border text-foreground font-bold">
                                    {children}
                                  </thead>
                                ),
                                th: ({ children }) => (
                                  <th className="p-2.5 text-start font-bold text-foreground border-e border-border last:border-e-0 whitespace-nowrap bg-muted/40 text-xs uppercase tracking-wider">
                                    {children}
                                  </th>
                                ),
                                tr: ({ children }) => (
                                  <tr className="border-b border-border/60 hover:bg-muted/20 transition-colors last:border-b-0">
                                    {children}
                                  </tr>
                                ),
                                td: ({ children }) => (
                                  <td className="p-2.5 border-e border-border/60 last:border-e-0 align-top text-foreground">
                                    {children}
                                  </td>
                                ),
                                a: ({ href, children }) => (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline font-semibold"
                                  >
                                    {children}
                                    <ExternalLink className="size-3 inline-block opacity-80" />
                                  </a>
                                ),
                              }}
                            >
                              {m.content}
                            </ReactMarkdown>
                          </div>

                          {/* Sources line matching Proposed — Assistant */}
                          {m.citations && m.citations.length > 0 && (
                            <div className="pt-3 border-t border-border/60 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-foreground">Sources:</span>
                              {m.citations.map((c, i) => (
                                <span
                                  key={`${c.document_id}-${c.location ?? "src"}-${c.document_name}`}
                                  className="inline-flex items-center gap-1"
                                >
                                  {i > 0 && <span className="text-muted-foreground/60">·</span>}
                                  <button
                                    type="button"
                                    onClick={() => onOpenDoc?.(c.document_id)}
                                    className="font-semibold text-primary hover:underline text-start"
                                  >
                                    {c.document_name}
                                  </button>
                                  {c.location && (
                                    <span className="text-muted-foreground font-mono text-[11px]">
                                      ({c.location})
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Follow-up suggestion buttons */}
                          {m.followUps && m.followUps.length > 0 && (
                            <div className="pt-2 flex items-center gap-2 flex-wrap">
                              {m.followUps.map((actionText) => (
                                <Button
                                  key={actionText}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleFollowUpClick(actionText)}
                                  className="h-7.5 px-3 text-xs bg-muted/30 border-border text-foreground font-medium rounded-none hover:bg-muted/70"
                                >
                                  {actionText}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {busy && (
                <div className="flex gap-3 items-start max-w-full">
                  <div className="size-8 shrink-0 bg-primary/10 border border-primary/20 flex items-center justify-center text-primary rounded-none">
                    <Bot className="size-4.5" />
                  </div>
                  <div className="p-3.5 text-xs sm:text-sm bg-card border border-border flex items-center gap-2.5 text-muted-foreground animate-pulse rounded-none">
                    <Spinner className="size-4" />
                    <span>Analyzing authorized documents and preparing response…</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pinned Bottom Input matching Proposed — Assistant */}
          <div className="pt-2 space-y-2 border-t border-border">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="flex items-center gap-2.5"
            >
              <label htmlFor="ask-assistant-chat" className="sr-only">
                Ask a question about your documents
              </label>
              <Input
                id="ask-assistant-chat"
                type="text"
                placeholder="Ask about your documents…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={busy}
                className="h-12 text-sm sm:text-base rounded-none flex-1 px-4 bg-background border-border"
              />
              <Button
                type="submit"
                disabled={busy || !input.trim()}
                className="h-12 rounded-none px-5 has-data-[icon=inline-start]:pl-5 text-sm font-bold shrink-0 bg-primary text-primary-foreground inline-flex items-center justify-center gap-2"
              >
                {busy ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Send data-icon="inline-start" />
                )}
                <span>Send</span>
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              Answers come only from documents you are allowed to open in SharePoint. Every answer shows its sources.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
