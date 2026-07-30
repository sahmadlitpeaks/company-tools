import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, Megaphone, Pin, Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Announcement } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog, Empty, ErrorState, Loading, Modal, PageHead, useToast } from "../components/ui";

export default function AnnouncementsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const feed = useFetch<Announcement[]>("/api/announcements");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const announcements = feed.data ?? [];
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
            <Button type="button" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" /> Post announcement
            </Button>
          )
        }
      />

      {feed.loading ? (
        <Loading />
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.reload} />
      ) : announcements.length === 0 ? (
        <Empty icon={<Megaphone />} message="No announcements yet" />
      ) : (
        <div className="flex flex-col gap-3">
          {announcements.map((a) => (
            <Card
              key={a.id}
              className={a.is_read ? undefined : "border-l-3 border-l-primary"}
              onMouseEnter={() => markRead(a)}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <CardTitle className="inline-flex flex-wrap items-center gap-2">
                  {a.pinned && <Pin className="text-primary" />}
                  <Megaphone className="text-primary" />
                  {a.title}
                  {!a.is_read && <Badge>New</Badge>}
                  {!a.is_published && <Badge variant="secondary">Draft</Badge>}
                </CardTitle>
                <div className="flex shrink-0 items-center gap-2">
                  {!a.is_read && (
                    <Button type="button" variant="outline" size="sm" onClick={() => markRead(a)}>
                      Mark as read
                    </Button>
                  )}
                  {canPost && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Eye /> {a.read_count}
                    </span>
                  )}
                  {(user?.is_admin || a.author_id === user?.id) && (
                    <Button aria-label="Delete" type="button" variant="destructive" size="icon-sm" onClick={() => setDeleting(a)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm leading-relaxed">
                {a.body}
              </CardContent>
              <CardFooter className="text-xs text-muted-foreground">
                {a.author_name ?? "—"} · {new Date(a.created_at).toLocaleString()}
              </CardFooter>
            </Card>
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
        <ConfirmDialog
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/announcements", { method: "POST", body: form });
      notify("Announcement posted.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title="Post announcement" onClose={onClose} maxWidth={560}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rd-announcementspage-143-title">Title *</FieldLabel>
          <Input id="rd-announcementspage-143-title" required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="rd-announcementspage-147-message">Message</FieldLabel>
          <Textarea id="rd-announcementspage-147-message" rows={6} value={form.body} onChange={(e) => set("body", e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-5">
          <FieldLabel className="inline-flex items-center gap-2">
            <Checkbox checked={form.pinned} onCheckedChange={(checked) => set("pinned", checked)} />
            Pin to top
          </FieldLabel>
          <FieldLabel className="inline-flex items-center gap-2">
            <Checkbox checked={form.is_published} onCheckedChange={(checked) => set("is_published", checked)} />
            Publish &amp; notify everyone
          </FieldLabel>
        </div>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
