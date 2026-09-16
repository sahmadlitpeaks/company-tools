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
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  User as UserIcon,
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
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { useDocumentSearch } from "./useDocumentSearch";

type CentralChatItem = ChatMessage & {
  id: string;
  citations?: ChatCitation[];
};

const SUGGESTIONS = [
  {
    icon: Calendar,
    label: "Expiring Licences & Contracts",
    prompt: "Which licences and contracts are expiring soon? List their target dates and responsible owners.",
  },
  {
    icon: Clock,
    label: "Expiring in Next 3 Months",
    prompt: "Show me all licences, contracts, or deadlines expiring in the next 3 months.",
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
    prompt: "Who are the key deliverable owners and points of contact across all our projects?",
  },
  {
    icon: FileText,
    label: "Executive Summary of Corpus",
    prompt: "Provide an executive summary of all accessible documents, including their status and main focus.",
  },
];

export function CentralChatTab() {
  const [messages, setMessages] = useState<CentralChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { notify } = useToast();

  const docSearchResult = useDocumentSearch("", "");
  const docs: SharePointDocument[] = docSearchResult.data?.items ?? [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  async function send(textToSend?: string) {
    const content = (textToSend ?? input).trim();
    if (!content || busy) return;

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

      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: resp.reply,
          citations: resp.citations,
        },
      ]);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "Chat failed";
      let errorExplanation = readableStatus(rawMsg);
      const lower = rawMsg.toLowerCase();
      if (lower.includes("microsoft_connection_required")) {
        errorExplanation =
          "Your Microsoft 365 connection is required to verify permissions and search documents. Please click 'Connect Microsoft' or reconnect your account above.";
      } else if (lower.includes("openai_not_configured")) {
        errorExplanation =
          "The AI intelligence service is currently not configured with an API key. Please contact your system administrator.";
      } else if (lower.includes("invalid_request_origin")) {
        errorExplanation =
          "Security verification rejected the request origin. Please refresh the page and try again.";
      } else if (lower.includes("not found")) {
        errorExplanation =
          "The AI chat service endpoint was not found on the server. Please ensure the backend server has been restarted with the latest routes.";
      } else if (lower.includes("analysis_provider_error")) {
        errorExplanation =
          "The AI service provider encountered an error while generating a response. Please check API credentials and quota.";
      }
      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `⚠️ **Assistant query failed**: ${errorExplanation}`,
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

  return (
    <Card className="rounded-none border-border">
      <CardContent className="p-3.5 space-y-4">
        {/* Assistant Header Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-muted/20 border border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 text-primary shrink-0">
              <Bot className="size-6" />
            </div>
            <div>
              <div className="font-bold text-sm sm:text-base text-foreground flex items-center gap-2">
                AI Document Assistant
                <Badge variant="outline" className="text-xs py-0.5 px-2 font-mono rounded-none">
                  Cross-Document
                </Badge>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                Ask questions across all company documents you are authorized to view
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Scope Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground hidden sm:inline">Scope:</span>
              <Select
                value={selectedDocId}
                onValueChange={(val) => {
                  if (val) setSelectedDocId(val);
                }}
              >
                <SelectTrigger className="h-9 text-xs sm:text-sm rounded-none min-w-[170px] max-w-[260px]">
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
                className="h-9 px-3 text-xs rounded-none text-muted-foreground hover:text-foreground"
                title="Clear conversation"
              >
                <Trash2 data-icon="inline-start" className="size-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {!docSearchResult.loading && docs.length === 0 && (
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 text-xs sm:text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4.5 text-amber-600 shrink-0" />
            <span>
              No accessible SharePoint documents are indexed yet. Switch to the Documents tab to sync your files before querying the AI Assistant.
            </span>
          </div>
        )}

        {/* Empty State / Suggestions */}
        {messages.length === 0 && (
          <div className="space-y-4 py-8 text-center border border-dashed border-border p-5">
            <div className="space-y-2 max-w-lg mx-auto">
              <Sparkles className="size-8 mx-auto text-primary opacity-80" />
              <h3 className="text-base sm:text-lg font-bold">How can the AI Assistant help you?</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Click any suggested question below or type your own question in the box at the bottom.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto pt-2">
              {SUGGESTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    type="button"
                    disabled={busy}
                    onClick={() => void send(s.prompt)}
                    className="flex items-start gap-3 p-3.5 text-start border border-border hover:border-primary/60 hover:bg-muted/30 transition-colors group rounded-none disabled:opacity-50 shadow-2xs"
                  >
                    <Icon className="size-5 text-primary shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                    <div className="space-y-1 min-w-0">
                      <div className="font-semibold text-xs sm:text-sm text-foreground">{s.label}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2 leading-normal">
                        {s.prompt}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Messages Stream */}
        {messages.length > 0 && (
          <div
            ref={scrollRef}
            className="space-y-3.5 max-h-[520px] overflow-y-auto pr-1 border border-border/60 p-3 bg-muted/5"
          >
            {messages.map((m) => {
              const isUser = m.role === "user";
              const isCopied = copiedMsgId === m.id;

              return (
                <div
                  key={m.id}
                  className={cn(
                    "p-4 text-sm sm:text-base leading-relaxed border transition-colors",
                    isUser
                      ? "bg-primary/10 border-primary/20 ms-4 sm:ms-10 text-foreground"
                      : "bg-card border-border me-4 sm:me-10 text-foreground shadow-2xs"
                  )}
                >
                  <div className="flex items-center justify-between font-semibold text-xs text-muted-foreground mb-2 pb-1.5 border-b border-border/50">
                    <div className="flex items-center gap-2">
                      {isUser ? (
                        <UserIcon className="size-3.5 text-foreground" />
                      ) : (
                        <Bot className="size-3.5 text-primary" />
                      )}
                      <span>{isUser ? "You" : "AI Assistant"}</span>
                    </div>

                    {!isUser && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => void copyMessage(m.id, m.content)}
                        className="h-6 px-2 text-xs gap-1 rounded-none"
                        title="Copy response text"
                      >
                        {isCopied ? (
                          <>
                            <Check className="size-3 text-emerald-600" />
                            <span className="text-emerald-600 font-semibold">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2 break-words text-sm sm:text-base leading-relaxed [&_ul]:list-disc [&_ul]:ms-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:ms-5 [&_ol]:my-2 [&_li]:my-1 [&_li_ul]:my-1 [&_li_ul]:ms-5 [&_strong]:font-bold [&_strong]:text-foreground [&_a]:text-primary [&_a]:underline [&_p]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_table]:w-full [&_table]:border [&_table]:border-border [&_table]:my-3 [&_th]:border [&_th]:border-border [&_th]:p-2.5 [&_th]:bg-muted/40 [&_td]:border [&_td]:border-border [&_td]:p-2.5">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            table: ({ children }) => (
                              <div className="overflow-x-auto my-3 border border-border bg-card">
                                <table className="w-full text-xs sm:text-sm border-collapse">
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
                              <th className="p-2.5 text-start font-bold text-foreground border-e border-border last:border-e-0 whitespace-nowrap bg-muted/30">
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

                      {/* Grounded Citations / Source Cards */}
                      {m.citations && m.citations.length > 0 && (
                        <div className="pt-2.5 border-t border-border/60 space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <FileText className="size-3.5 text-primary" />
                            Verified Sources ({m.citations.length})
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {m.citations.map((c) => (
                              <div
                                key={`${c.document_id}:${c.location ?? "doc"}`}
                                className="inline-flex items-center gap-2 py-1.5 px-2.5 border border-border bg-muted/30 text-xs max-w-full"
                              >
                                <span className="font-semibold text-foreground truncate max-w-[220px]" title={c.document_name}>
                                  {c.document_name}
                                </span>
                                {c.location && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs py-0.5 px-1.5 font-mono rounded-none"
                                  >
                                    {c.location}
                                  </Badge>
                                )}
                                {c.document_url && (
                                  <a
                                    href={c.document_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:text-primary/80 shrink-0 inline-flex items-center gap-1 text-xs font-semibold"
                                    title="Open directly in SharePoint"
                                    aria-label={`Open ${c.document_name} in SharePoint`}
                                  >
                                    <span>Open</span>
                                    <ExternalLink className="size-3.5" />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {busy && (
              <div className="p-3 text-xs sm:text-sm bg-muted/20 border border-border me-6 sm:me-12 flex items-center gap-2.5 text-muted-foreground animate-pulse">
                <Spinner className="size-4" />
                <span>Luna is querying authorized SharePoint documents and synthesizing an answer…</span>
              </div>
            )}
          </div>
        )}

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex gap-2.5 pt-1.5"
        >
          <Input
            placeholder={
              selectedDocId === "all"
                ? "Ask a question about your documents (e.g., 'Which contracts are expiring soon?')..."
                : `Ask a question about this selected document...`
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            className="h-11 text-sm sm:text-base rounded-none flex-1 px-3.5"
          />
          <Button
            type="submit"
            disabled={busy || !input.trim()}
            className="h-11 rounded-none gap-2 px-5 text-sm font-semibold shrink-0"
          >
            {busy ? (
              <RefreshCw data-icon="inline-start" className="size-4 animate-spin" />
            ) : (
              <Send data-icon="inline-start" className="size-4" />
            )}
            <span>Ask</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
