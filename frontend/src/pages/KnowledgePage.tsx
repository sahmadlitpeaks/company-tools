import { useState } from "react";
import { Eye, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Article, ArticleSummary } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { ConfirmModal, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function KnowledgePage() {
  const { notify } = useToast();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const query = `?${category ? `category=${encodeURIComponent(category)}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`;
  const articles = useFetch<ArticleSummary[]>(`/api/knowledge${query}`);
  const categories = useFetch<string[]>("/api/knowledge/categories");
  const [viewId, setViewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Article | "new" | null>(null);

  return (
    <div>
      <PageHead
        title="Knowledge Base"
        subtitle="Company policies, how-tos and SOPs in one searchable place."
        action={
          <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEditing("new")}>
            <Plus size={15} /> New article
          </button>
        }
      />

      <div className="card mb-4">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 3 }}>
            <label>Search</label>
            <input placeholder="Search articles…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All</option>
              {(categories.data ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {articles.loading ? (
        <Loading />
      ) : (articles.data?.length ?? 0) === 0 ? (
        <Empty icon="📚" message="No articles yet" hint="Write your first policy or how-to." />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
          {articles.data!.map((a) => (
            <button
              key={a.id}
              className="card !block text-left"
              onClick={() => setViewId(a.id)}
              style={{ cursor: "pointer" }}
            >
              <div className="spread">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  {a.pinned && <Pin size={13} className="text-brand-600" />}
                  {a.title}
                </span>
                {!a.is_published && <span className="badge amber">Draft</span>}
              </div>
              <div className="muted mt-2 flex items-center gap-3 text-xs">
                {a.category && <span className="badge">{a.category}</span>}
                <span className="inline-flex items-center gap-1">
                  <Eye size={12} /> {a.view_count}
                </span>
                <span>{new Date(a.updated_at).toLocaleDateString()}</span>
              </div>
            </button>
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
  const { data } = useFetch<Article>(`/api/knowledge/${id}`);
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
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="muted mb-3 flex items-center gap-3 text-xs">
            {data.category && <span className="badge">{data.category}</span>}
            {!data.is_published && <span className="badge amber">Draft</span>}
            <span>By {data.author_name ?? "—"}</span>
            <span>Updated {new Date(data.updated_at).toLocaleDateString()}</span>
          </div>
          <div className="text-sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {data.body || <span className="muted">No content.</span>}
          </div>
          {canEdit && (
            <div className="row mt-4" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-danger inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setConfirming(true)}>
                <Trash2 size={14} /> Delete
              </button>
              <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => onEdit(data)}>
                <Pencil size={14} /> Edit
              </button>
            </div>
          )}
        </>
      )}
      {confirming && (
        <ConfirmModal
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
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...form, category: form.category || null };
      if (article) await api(`/api/knowledge/${article.id}`, { method: "PATCH", body });
      else await api("/api/knowledge", { method: "POST", body });
      notify(article ? "Article updated." : "Article published.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title={article ? "Edit article" : "New article"} onClose={onClose} maxWidth={680}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Title *</label>
          <input required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="field">
          <label>Category</label>
          <input
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
        </div>
        <div className="field">
          <label>Content</label>
          <textarea
            rows={12}
            placeholder="Write the policy or how-to here…"
            value={form.body}
            onChange={(e) => set("body", e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 18 }}>
          <label className="inline-flex items-center gap-2 text-sm font-medium" style={{ flex: "0 0 auto" }}>
            <input type="checkbox" checked={form.is_published} onChange={(e) => set("is_published", e.target.checked)} />
            Published
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-medium" style={{ flex: "0 0 auto" }}>
            <input type="checkbox" checked={form.pinned} onChange={(e) => set("pinned", e.target.checked)} />
            Pinned
          </label>
        </div>
        <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : article ? "Save changes" : "Publish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
