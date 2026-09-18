import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Bot,
  Calendar,
  Check,
  Copy,
  DollarSign,
  Send,
  Sparkles,
  User as UserIcon,
  Users,
} from "lucide-react";
import { api } from "@/api/client";
import { readableStatus, type ChatMessage, type ChatResponse } from "@/api/sharepoint";
import { useToast } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type ChatItem = ChatMessage & { id: string };

const SUGGESTIONS = [
  {
    icon: Calendar,
    label: "Deadlines & Expiry",
    prompt: "When does this document expire or renew? List all key deadline dates.",
  },
  {
    icon: DollarSign,
    label: "Pricing & Commercials",
    prompt: "What are the pricing, fee schedules, budget, and commercial terms?",
  },
  {
    icon: Users,
    label: "Key Contacts & Owners",
    prompt: "Who are the assigned deliverable owners, contacts, and roles?",
  },
  {
    icon: AlertTriangle,
    label: "Risks & Action Items",
    prompt: "What are the primary risks, blockers, and required next steps?",
  },
];

export function DocumentChatTab({
  documentId,
  documentName,
}: {
  documentId: string;
  documentName: string;
}) {
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { notify } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  async function send(textToSend?: string) {
    const content = (textToSend ?? input).trim();
    if (!content || busy) return;
    const userMsg: ChatItem = { id: crypto.randomUUID(), role: "user", content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);

    try {
      const resp = await api<ChatResponse>(`/api/sharepoint/documents/${documentId}/chat`, {
        method: "POST",
        body: { messages: nextMessages.map(({ role, content }) => ({ role, content })) },
      });
      setMessages([...nextMessages, { id: crypto.randomUUID(), role: "assistant", content: resp.reply }]);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : "Chat failed";
      let errorExplanation = readableStatus(rawMsg);
      const lower = rawMsg.toLowerCase();
      if (lower.includes("microsoft_connection_required")) {
        errorExplanation =
          "Your Microsoft 365 connection is required to verify permissions and search documents. Please click 'Connect Microsoft' or reconnect your account.";
      } else if (lower.includes("openai_not_configured")) {
        errorExplanation =
          "The AI intelligence service is currently not configured with an API key. Please contact your system administrator.";
      } else if (lower.includes("not found")) {
        errorExplanation =
          "This document was not found or has been removed from SharePoint. Please refresh the document list.";
      }
      setMessages([
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `⚠️ **Document assistant query failed**: ${errorExplanation}`,
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

  return (
    <div className="space-y-3.5">
      {/* Assistant Header Banner */}
      <div className="flex items-center justify-between p-2.5 bg-muted/20 border border-border text-xs">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-primary/10 text-primary">
            <Bot className="size-4" />
          </div>
          <div>
            <div className="font-bold text-sm sm:text-base text-foreground flex items-center gap-2">
              Luna AI Assistant
              <Badge variant="outline" className="text-xs py-0.5 px-1.5 font-mono rounded-none">
                Grounded
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Directly answers questions using verified document text excerpts
            </div>
          </div>
        </div>
      </div>

      {/* Empty State / Suggestions */}
      {messages.length === 0 && (
        <div className="space-y-4 py-6 text-center border border-dashed border-border p-4">
          <div className="space-y-1.5 max-w-md mx-auto">
            <Sparkles className="size-7 mx-auto text-primary opacity-80" />
            <h4 className="text-base font-bold">Chat with {documentName}</h4>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Ask anything about terms, deadlines, people, or pricing. Luna verifies each answer against document source text.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-xl mx-auto pt-2">
            {SUGGESTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.label}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(s.prompt)}
                  className="flex items-start gap-2.5 p-3 text-start border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors group rounded-none disabled:opacity-50"
                >
                  <Icon className="size-4.5 text-primary shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-semibold text-xs sm:text-sm text-foreground">{s.label}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">{s.prompt}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Messages Stream */}
      {messages.length > 0 && (
        <div ref={scrollRef} className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
          {messages.map((m) => {
            const isUser = m.role === "user";
            const isCopied = copiedMsgId === m.id;

            return (
              <div
                key={m.id}
                className={cn(
                  "p-3.5 text-sm sm:text-base leading-relaxed border transition-colors",
                  isUser
                    ? "bg-primary/10 border-primary/20 ms-6 sm:ms-10 text-foreground"
                    : "bg-card border-border me-6 sm:me-10 text-foreground"
                )}
              >
                <div className="flex items-center justify-between font-semibold text-xs text-muted-foreground mb-2 pb-1.5 border-b border-border/50">
                  <div className="flex items-center gap-1.5">
                    {isUser ? (
                      <UserIcon className="size-3.5 text-foreground" />
                    ) : (
                      <Bot className="size-3.5 text-primary" />
                    )}
                    <span>{isUser ? "You" : "Luna Assistant"}</span>
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
                  <div className="space-y-2">
                    <div className="space-y-1.5 break-words text-sm sm:text-base leading-relaxed [&_ul]:list-disc [&_ul]:ms-4 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:ms-4 [&_ol]:my-1.5 [&_li]:my-0.5 [&_li_ul]:my-0.5 [&_li_ul]:ms-4 [&_strong]:font-bold [&_strong]:text-foreground [&_a]:text-primary [&_a]:underline [&_p]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:ps-2 [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({ children }) => (
                            <div className="overflow-x-auto my-2.5 border border-border bg-card">
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
                            <th className="p-2 text-start font-bold text-foreground border-e border-border last:border-e-0 whitespace-nowrap bg-muted/30">
                              {children}
                            </th>
                          ),
                          tr: ({ children }) => (
                            <tr className="border-b border-border/60 hover:bg-muted/20 transition-colors last:border-b-0">
                              {children}
                            </tr>
                          ),
                          td: ({ children }) => (
                            <td className="p-2 border-e border-border/60 last:border-e-0 align-top text-foreground">
                              {children}
                            </td>
                          ),
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-semibold">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {busy && (
            <div className="p-3 text-xs sm:text-sm bg-muted/20 border border-border me-10 flex items-center gap-2.5 text-muted-foreground animate-pulse">
              <Spinner className="size-4" />
              <span>Luna is reviewing document excerpts and formulating an answer…</span>
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
        className="flex gap-2.5 pt-2.5 border-t border-border"
      >
        <Input
          placeholder="Ask a question about this document…"
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
          <Send data-icon="inline-start" className="size-4" />
          <span>Ask</span>
        </Button>
      </form>
    </div>
  );
}
