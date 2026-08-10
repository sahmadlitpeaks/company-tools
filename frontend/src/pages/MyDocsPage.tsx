import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Pin,
  PinOff,
  StickyNote,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { WorkspaceItem } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, bytes, useToast } from "../components/ui";

const ICON = { note: StickyNote, link: LinkIcon, file: FileText } as const;

export default function MyDocsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q);
  const [kind, setKind] = useState("");
  const query = `?${kind ? `kind=${kind}&` : ""}${debouncedQ ? `q=${encodeURIComponent(debouncedQ)}` : ""}`;
  const items = useFetch<WorkspaceItem[]>(`/api/workspace${query}`);
  const [adding, setAdding] = useState<"note" | "link" | null>(null);
  const [viewing, setViewing] = useState<WorkspaceItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [params] = useSearchParams();
  useEffect(() => {
    const openId = params.get("open");
    const item = items.data?.find((candidate) => candidate.id === openId);
    if (item) open(item);
  // `open` is stable and intentionally omitted to avoid reopening after actions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data, params]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", file.name);
    try {
      await api("/api/workspace/upload", { method: "POST", form: fd });
      notify("File saved.");
      items.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (fileRef.current) fileRef.current.value = "";
  }
  async function togglePin(it: WorkspaceItem) {
    await api(`/api/workspace/${it.id}`, { method: "PATCH", body: { pinned: !it.pinned } });
    items.reload();
  }
  async function remove(it: WorkspaceItem) {
    await api(`/api/workspace/${it.id}`, { method: "DELETE" });
    items.reload();
  }
  function open(it: WorkspaceItem) {
    if (it.kind === "link" && it.url) window.open(it.url, "_blank", "noopener,noreferrer");
    else if (it.kind === "file") downloadFile(`/api/workspace/${it.id}/download`, it.title);
    else setViewing(it);
  }

  return (
    <div>
      <PageHead
        title="My Docs"
        subtitle="Quick-access notes, links (paste your OneDrive links here) and files — pinned and searchable, so nothing gets lost."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setAdding("note")}><StickyNote data-icon="inline-start" /> Note</Button>
            <Button type="button" variant="outline" onClick={() => setAdding("link")}><LinkIcon data-icon="inline-start" /> Link</Button>
            <Button type="button" onClick={() => fileRef.current?.click()}><Upload data-icon="inline-start" /> Upload</Button>
            <Input aria-label="Upload" ref={fileRef} type="file" hidden onChange={upload} />
          </div>
        }
      />

      <Card className="mb-4"><CardContent><FieldGroup className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(12rem,1fr)]"><Field><FieldLabel htmlFor="docs-search">Search</FieldLabel><Input id="docs-search" aria-label="Search title, notes, tags…" placeholder="Search title, notes, tags…" value={q} onChange={(e) => setQ(e.target.value)} /></Field><Field><FieldLabel htmlFor="docs-type">Type</FieldLabel><Select items={[{ value: null, label: "All" }, { value: "note", label: "Notes" }, { value: "link", label: "Links" }, { value: "file", label: "Files" }]} value={kind || null} onValueChange={(value) => setKind(value ?? "")}><SelectTrigger id="docs-type" aria-label="Type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={null}>All</SelectItem><SelectItem value="note">Notes</SelectItem><SelectItem value="link">Links</SelectItem><SelectItem value="file">Files</SelectItem></SelectGroup></SelectContent></Select></Field></FieldGroup></CardContent></Card>

      {items.loading ? (
        <Loading />
      ) : (items.data?.length ?? 0) === 0 ? (
        <Empty icon={<Pin />} message="Nothing saved yet" hint="Pin an important link or note for quick access." />
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {items.data!.map((it) => {
            const Icon = ICON[it.kind as keyof typeof ICON] ?? FileText;
            const mine = it.owner_id === user?.id;
            return (
              <Card key={it.id}>
                <CardHeader><div className="flex items-center justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Icon className="flex-none text-primary" />
                    <Button aria-label="Open" type="button" variant="link" className="h-auto truncate p-0 text-left" onClick={() => open(it)}>{it.title}</Button>
                  </span>
                  {it.pinned && <Pin className="flex-none text-primary" />}
                </div></CardHeader><CardContent className="flex flex-1 flex-col gap-2">
                {it.kind === "note" && it.body && (
                  <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">{it.body}</p>
                )}
                {it.kind === "link" && it.url && (
                  <span className="truncate text-xs text-muted-foreground">{it.url}</span>
                )}
                {it.kind === "file" && (
                  <span className="text-xs text-muted-foreground">{bytes(it.size_bytes)}</span>
                )}
                {it.tags && (
                  <div className="flex flex-wrap gap-1">
                    {it.tags.split(",").map((t) => (
                      <Badge key={t} variant="secondary">{t.trim()}</Badge>
                    ))}
                  </div>
                )}
                </CardContent><CardFooter className="justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {it.shared && <Users size={11} />}
                    {!mine ? it.owner_name : it.shared ? "Shared" : ""}
                  </span>
                  <span className="flex flex-none items-center gap-1">
                    <Button type="button" size="icon-sm" variant="outline" title="Open" aria-label="Open" onClick={() => open(it)}>{it.kind === "file" ? <Download /> : <ExternalLink />}</Button>
                    {mine && (
                      <>
                        <Button type="button" size="icon-sm" variant="outline" title={it.pinned ? "Unpin" : "Pin"} aria-label={it.pinned ? "Unpin" : "Pin"} onClick={() => togglePin(it)}>{it.pinned ? <PinOff /> : <Pin />}</Button>
                        <Button type="button" size="icon-sm" variant="destructive" title="Delete" aria-label="Delete" onClick={() => remove(it)}><Trash2 /></Button>
                      </>
                    )}
                  </span>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {adding && (
        <DocModal
          kind={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            items.reload();
            setAdding(null);
          }}
        />
      )}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} maxWidth={560}>
          <div className="text-sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {viewing.body || <span className="text-muted-foreground">No content.</span>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function DocModal({
  kind,
  onClose,
  onSaved,
}: {
  kind: "note" | "link";
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [form, setForm] = useState({ title: "", body: "", url: "", tags: "", pinned: false, shared: false });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api("/api/workspace", {
        method: "POST",
        body: {
          kind,
          title: form.title,
          body: kind === "note" ? form.body || null : null,
          url: kind === "link" ? form.url || null : null,
          tags: form.tags || null,
          pinned: form.pinned,
          shared: form.shared,
        },
      });
      notify("Saved.");
      onSaved();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed", "error");

    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={kind === "note" ? "New note" : "Save a link"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4"><FieldGroup>
        <Field><FieldLabel htmlFor="docs-title">Title *</FieldLabel><Input id="docs-title" required value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
        {kind === "link" ? (
          <Field><FieldLabel htmlFor="docs-url">URL *</FieldLabel><Input id="docs-url" aria-label="https://onedrive.com/…" required placeholder="https://onedrive.com/…" value={form.url} onChange={(e) => set("url", e.target.value)} /></Field>
        ) : (
          <Field><FieldLabel htmlFor="docs-note">Note</FieldLabel><Textarea id="docs-note" rows={6} value={form.body} onChange={(e) => set("body", e.target.value)} /></Field>
        )}
        <Field><FieldLabel htmlFor="docs-tags">Tags (comma-separated)</FieldLabel><Input id="docs-tags" aria-label="finance, q2, urgent" placeholder="finance, q2, urgent" value={form.tags} onChange={(e) => set("tags", e.target.value)} /></Field>
        <div className="flex flex-wrap gap-4">
          <Field orientation="horizontal"><Checkbox id="docs-pinned" checked={form.pinned} onCheckedChange={(checked) => set("pinned", Boolean(checked))} /><FieldLabel htmlFor="docs-pinned">Pin</FieldLabel></Field>
          <Field orientation="horizontal"><Checkbox id="docs-shared" checked={form.shared} onCheckedChange={(checked) => set("shared", Boolean(checked))} /><FieldLabel htmlFor="docs-shared">Share with team</FieldLabel></Field>
        </div>
        </FieldGroup><div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
