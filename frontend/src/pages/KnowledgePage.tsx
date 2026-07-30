import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Eye, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Article, ArticleSummary } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Empty, ErrorState, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function KnowledgePage() {
  const { notify } = useToast();
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [category, setCategory] = useState("");
  const query = `?${category ? `category=${encodeURIComponent(category)}&` : ""}${debouncedQ ? `q=${encodeURIComponent(debouncedQ)}` : ""}`;
  const articles = useFetch<ArticleSummary[]>(`/api/knowledge${query}`);
  const categories = useFetch<string[]>("/api/knowledge/categories");
  const [viewId, setViewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Article | "new" | null>(null);
  const articleItems = articles.data ?? [];
  const [params] = useSearchParams();
  useEffect(() => {
    const open = params.get("open");
    if (open) setViewId(open);
  }, [params]);

  return (
    <div>
      <PageHead
        title="Knowledge Base"
        subtitle="Company policies, how-tos and SOPs in one searchable place."
        action={
          <Button type="button" onClick={() => setEditing("new")}><Plus data-icon="inline-start" /> New article</Button>
        }
      />

      <Card className="mb-4"><CardContent><FieldGroup className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(12rem,1fr)]">
          <Field><FieldLabel htmlFor="knowledge-search">Search</FieldLabel>
            <Input id="knowledge-search" aria-label="Search articles…" placeholder="Search articles…" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field><FieldLabel htmlFor="knowledge-category">Category</FieldLabel>
            <Select items={[{ value: null, label: "All" }, ...(categories.data ?? []).map((c) => ({ value: c, label: c }))]} value={category || null} onValueChange={(value) => setCategory(value ?? "")}>
              <SelectTrigger id="knowledge-category" aria-label="Category" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value={null}>All</SelectItem>
              {(categories.data ?? []).map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
              </SelectGroup></SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        {categories.error && <ErrorState message={categories.error} onRetry={categories.reload} />}
      </CardContent></Card>

      {articles.loading ? (
        <Loading />
      ) : articles.error ? (
        <ErrorState message={articles.error} onRetry={articles.reload} />
      ) : articleItems.length === 0 ? (
        <Empty icon={<BookOpen />} message="No articles yet" hint="Write your first policy or how-to." />
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {articleItems.map((a) => (
            <Card key={a.id}>
              <CardHeader><div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto min-w-0 justify-start whitespace-normal p-0 text-left text-sm font-semibold"
                  aria-label={`Open article: ${a.title}`}
                  onClick={() => setViewId(a.id)}
                >
                  {a.pinned && <Pin className="text-primary" />}
                  <span>{a.title}</span>
                </Button>
                {!a.is_published && <Badge variant="warning">Draft</Badge>}
              </div></CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {a.category && <Badge variant="secondary">{a.category}</Badge>}
                <span className="inline-flex items-center gap-1">
                  <Eye size={12} /> {a.view_count}
                </span>
                <span>{new Date(a.updated_at).toLocaleDateString()}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {viewId && (
        <ArticleViewer
          id={viewId}
          onClose={() => setViewId(null)}
          onEdit={(art) => {
            setViewId(null);
            setEditing(art);
          }}
          onDeleted={() => {
            setViewId(null);
            articles.reload();
            notify("Article deleted.");
          }}
        />
      )}
      {editing && (
        <ArticleEditor
          article={editing === "new" ? null : editing}
          categories={categories.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            articles.reload();
            categories.reload();
          }}
        />
      )}
    </div>
  );
}

function ArticleViewer({
  id,
  onClose,
  onEdit,
  onDeleted,
}: {
  id: string;
  onClose: () => void;
  onEdit: (a: Article) => void;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const article = useFetch<Article>(`/api/knowledge/${id}`);
  const { data } = article;
  const [confirming, setConfirming] = useState(false);
  const canEdit =
    !!data &&
    (user?.is_admin || user?.role === "manager" || data.author_id === user?.id);

  async function remove() {
    await api(`/api/knowledge/${id}`, { method: "DELETE" });
    onDeleted();
  }

  return (
    <Modal title={data?.title ?? "Article"} onClose={onClose} maxWidth={680}>
      {article.loading ? (
        <Loading />
      ) : article.error ? (
        <ErrorState message={article.error} onRetry={article.reload} />
      ) : !data ? (
        <ErrorState message="Article details are unavailable." onRetry={article.reload} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {data.category && <Badge variant="secondary">{data.category}</Badge>}
            {!data.is_published && <Badge variant="warning">Draft</Badge>}
            <span>By {data.author_name ?? "—"}</span>
            <span>Updated {new Date(data.updated_at).toLocaleDateString()}</span>
          </div>
          <div className="text-sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {data.body || <span className="text-muted-foreground">No content.</span>}
          </div>
          {canEdit && (
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="destructive" onClick={() => setConfirming(true)}><Trash2 data-icon="inline-start" /> Delete</Button>
              <Button type="button" onClick={() => onEdit(data)}><Pencil data-icon="inline-start" /> Edit</Button>
            </div>
          )}
        </>
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete article"
          message="Delete this article? This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={remove}
          onClose={() => setConfirming(false)}
        />
      )}
    </Modal>
  );
}

function ArticleEditor({
  article,
  categories,
  onClose,
  onSaved,
}: {
  article: Article | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [form, setForm] = useState({
    title: article?.title ?? "",
    category: article?.category ?? "",
    body: article?.body ?? "",
    is_published: article?.is_published ?? true,
    pinned: article?.pinned ?? false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const body = { ...form, category: form.category || null };
      if (article) await api(`/api/knowledge/${article.id}`, { method: "PATCH", body });
      else await api("/api/knowledge", { method: "POST", body });
      notify(article ? "Article updated." : "Article published.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={article ? "Edit article" : "New article"} onClose={onClose} maxWidth={680}>
      <form onSubmit={submit} className="flex flex-col gap-4"><FieldGroup>
        <Field><FieldLabel htmlFor="knowledge-title">Title *</FieldLabel>
          <Input id="knowledge-title" required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field><FieldLabel htmlFor="knowledge-editor-category">Category</FieldLabel>
          <Input id="knowledge-editor-category" aria-label="e.g. HR, IT, Finance"
            list="kb-categories"
            placeholder="e.g. HR, IT, Finance"
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
          />
          <datalist id="kb-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field><FieldLabel htmlFor="knowledge-content">Content</FieldLabel>
          <Textarea id="knowledge-content" aria-label="Write the policy or how-to here…"
            rows={12}
            placeholder="Write the policy or how-to here…"
            value={form.body}
            onChange={(e) => set("body", e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-4">
          <Field orientation="horizontal"><Checkbox id="knowledge-published" checked={form.is_published} onCheckedChange={(checked) => set("is_published", Boolean(checked))} /><FieldLabel htmlFor="knowledge-published">Published</FieldLabel></Field>
          <Field orientation="horizontal"><Checkbox id="knowledge-pinned" checked={form.pinned} onCheckedChange={(checked) => set("pinned", Boolean(checked))} /><FieldLabel htmlFor="knowledge-pinned">Pinned</FieldLabel></Field>
        </div>
        </FieldGroup><div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : article ? "Save changes" : "Publish"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
