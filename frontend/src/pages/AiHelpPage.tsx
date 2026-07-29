import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useMemo, useState } from "react";
import { Bot, RefreshCw, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useFetch } from "../hooks/useApi";
import { PageHead } from "../components/ui";
import { Spinner } from "@/components/ui/spinner";

const MODEL_STORAGE_KEY = "ai-help-selected-model";

type AiStatus = {
  enabled: boolean;
  model?: string | null;
  models?: string[];
  reason?: string | null;
};

type Answer = {
  answer: string;
  supported: boolean;
  model?: string;
  citations: { id: string; title: string; href: string }[];
};

function readStoredModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredModel(value: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export default function AiHelpPage() {
  const status = useFetch<AiStatus>("/api/ai/status");
  const [q, setQ] = useState("");
  const [model, setModel] = useState(readStoredModel);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);

  const models = useMemo(() => {
    const list = [...(status.data?.models ?? [])];
    const preferred = status.data?.model?.trim();
    if (preferred && !list.includes(preferred)) list.unshift(preferred);
    // de-dupe while preserving order
    return [...new Set(list.filter(Boolean))];
  }, [status.data?.model, status.data?.models]);

  useEffect(() => {
    if (!status.data?.enabled || models.length === 0) return;
    if (model && models.includes(model)) return;
    const stored = readStoredModel();
    const next = (stored && models.includes(stored) && stored) || status.data.model || models[0];
    if (next) {
      setModel(next);
      writeStoredModel(next);
    }
  }, [status.data?.enabled, status.data?.model, models, model]);

  function chooseModel(next: string) {
    setModel(next);
    writeStoredModel(next);
  }

  async function refreshModels() {
    setRefreshingModels(true);
    try {
      await status.reload();
    } finally {
      setRefreshingModels(false);
    }
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || !model) return;
    setIsSubmitting(true);
    try {
      setAnswer(
        await api<Answer>("/api/ai/ask", {
          method: "POST",
          body: { question: q, model },
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <PageHead
        title="AI Help"
        subtitle="Uses your local model. Prefers published Knowledge Base articles when relevant."
      />
      <Card className="mx-auto max-w-3xl">
        {!status.data?.enabled ? (
          <CardContent>
            <Alert>
              <AlertTitle>AI Help is disabled</AlertTitle>
              <AlertDescription>{status.data?.reason ?? "Checking configuration…"}</AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          <>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center bg-primary/10 text-foreground">
                  <Bot />
                </span>
                <div>
                  <CardTitle>Knowledge assistant</CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {models.length > 0
                      ? `${models.length} local models · chats are not stored`
                      : "Local models · chats are not stored"}
                  </div>
                </div>
              </div>
              <div className="flex min-w-[min(100%,22rem)] flex-1 items-center gap-2 sm:max-w-md sm:flex-none">
                <label className="sr-only" htmlFor="ai-model">
                  Model
                </label>
                <Select
                  items={models.length === 0
                    ? [{ value: null, label: "No models found - refresh or check Jan" }]
                    : models.map((id) => ({ value: id, label: id }))}
                  value={model || null}
                  onValueChange={(value) => chooseModel(value ?? "")}
                  disabled={isSubmitting || models.length === 0}
                >
                  <SelectTrigger id="ai-model" aria-label="Select AI model" className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {models.length === 0 ? (
                        <SelectItem value={null}>No models found - refresh or check Jan</SelectItem>
                      ) : (
                        models.map((id) => (
                          <SelectItem key={id} value={id}>
                            {id}
                          </SelectItem>
                        ))
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Refresh model list"
                  title="Refresh models from Jan"
                  disabled={refreshingModels || isSubmitting}
                  onClick={() => void refreshModels()}
                >
                  {refreshingModels ? <Spinner /> : <RefreshCw />}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
            {status.data.reason && (
              <Alert>
                <AlertDescription>{status.data.reason}</AlertDescription>
              </Alert>
            )}
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={ask} aria-busy={isSubmitting || undefined}>
              <Input
                aria-label="Ask about a company policy or how-to…"
                maxLength={2000}
                placeholder="Ask about a company policy or how-to…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                disabled={isSubmitting || !model}
              />
              <Button
                aria-label="Send"
                type="submit"
                disabled={isSubmitting || !model}
              >
                {isSubmitting ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                {isSubmitting ? "Thinking…" : "Ask"}
              </Button>
            </form>
            {answer && (
              <div className="bg-muted p-4" role="status" aria-live="polite">
                {answer.model && (
                  <div className="mb-2 text-xs text-muted-foreground">Answered with {answer.model}</div>
                )}
                <div
                  className={
                    "ai-md text-sm leading-relaxed " +
                    "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
                    "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
                    "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
                    "[&_li]:my-1 [&_li>p]:my-0 " +
                    "[&_strong]:font-semibold " +
                    "[&_em]:italic " +
                    "[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold " +
                    "[&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold " +
                    "[&_h3]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:text-sm [&_h3]:font-semibold " +
                    "[&_code]:bg-muted-foreground/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] " +
                    "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:bg-muted-foreground/10 [&_pre]:p-3 " +
                    "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
                    "[&_a]:text-primary [&_a]:underline " +
                    "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border " +
                    "[&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
                    "[&_hr]:my-3 [&_hr]:border-border"
                  }
                >
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => {
                        if (href?.startsWith("/")) {
                          return <Link to={href}>{children}</Link>;
                        }
                        return (
                          <a href={href} target="_blank" rel="noreferrer">
                            {children}
                          </a>
                        );
                      },
                    }}
                  >
                    {answer.answer}
                  </ReactMarkdown>
                </div>
                {answer.citations.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <strong className="text-sm">Sources</strong>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {answer.citations.map((c) => (
                        <Badge key={c.id} render={<Link to={c.href} />}>{c.title}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
