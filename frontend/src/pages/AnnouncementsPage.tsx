import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, Megaphone, Pin, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Announcement } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { ConfirmModal, Empty, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function AnnouncementsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const feed = useFetch<Announcement[]>("/api/announcements");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const canPost = user?.is_admin || user?.role === "manager";
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("new") && canPost) {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams, canPost]);

  async function markRead(a: Announcement) {
    if (a.is_read) return;
    await api(`/api/announcements/${a.id}/read`, { method: "POST" });
    feed.reload();
  }
  async function remove(a: Announcement) {
    await api(`/api/announcements/${a.id}`, { method: "DELETE" });
    notify("Deleted.");
    feed.reload();
  }

  return (
    <div>
      <PageHead
        title="Announcements"
        subtitle="Company-wide news and notices."
        action={
          canPost && (
            <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setAdding(true)}>
              <Plus size={15} /> Post announcement
            </button>
          )
        }
      />

      {feed.loading ? (
        <Loading />
      ) : (feed.data?.length ?? 0) === 0 ? (
        <Empty icon="📣" message="No announcements yet" />
      ) : (
        <div className="flex flex-col gap-3">
          {feed.data!.map((a) => (
            <div
              key={a.id}
              className="card"
              onMouseEnter={() => markRead(a)}
              style={{
                borderLeft: a.is_read ? undefined : "3px solid var(--accent)",
              }}
            >
              <div className="spread">
                <h3 className="m-0 inline-flex items-center gap-2">
                  {a.pinned && <Pin size={15} className="text-brand-600" />}
                  <Megaphone size={16} className="text-brand-600" />
                  {a.title}
                  {!a.is_read && <span className="badge amber">New</span>}
                  {!a.is_published && <span className="badge">Draft</span>}
                </h3>
                <div className="row" style={{ flex: "0 0 auto", gap: 8 }}>
                  {canPost && (
                    <span className="muted inline-flex items-center gap-1 text-xs">
                      <Eye size={12} /> {a.read_count}
                    </span>
                  )}
                  {(user?.is_admin || a.author_id === user?.id) && (
                    <button className="btn-sm btn-danger" style={{ flex: "0 0 auto" }} onClick={() => setDeleting(a)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 text-sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {a.body}
              </div>
              <div className="muted mt-2 text-xs">
                {a.author_name ?? "—"} · {new Date(a.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AnnouncementModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            feed.reload();
            setAdding(false);
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete announcement"
          message={`Delete "${deleting.title}"? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function AnnouncementModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useToast();
  const [form, setForm] = useState({ title: "", body: "", pinned: false, is_published: true });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/announcements", { method: "POST", body: form });
      notify("Announcement posted.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");
      setBusy(false);
    }
  }

  return (
    <Modal title="Post announcement" onClose={onClose} maxWidth={560}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Title *</label>
          <input required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="field">
          <label>Message</label>
          <textarea rows={6} value={form.body} onChange={(e) => set("body", e.target.value)} />
        </div>
        <div className="row" style={{ gap: 18 }}>
          <label className="inline-flex items-center gap-2 text-sm font-medium" style={{ flex: "0 0 auto" }}>
            <input type="checkbox" checked={form.pinned} onChange={(e) => set("pinned", e.target.checked)} />
            Pin to top
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-medium" style={{ flex: "0 0 auto" }}>
            <input type="checkbox" checked={form.is_published} onChange={(e) => set("is_published", e.target.checked)} />
            Publish &amp; notify everyone
          </label>
        </div>
        <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
