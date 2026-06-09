import { useRef, useState } from "react";
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
import { useAuth } from "../auth/AuthContext";
import { Empty, Loading, Modal, PageHead, bytes, useToast } from "../components/ui";

const ICON = { note: StickyNote, link: LinkIcon, file: FileText } as const;

export default function MyDocsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const query = `?${kind ? `kind=${kind}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`;
  const items = useFetch<WorkspaceItem[]>(`/api/workspace${query}`);
  const [adding, setAdding] = useState<"note" | "link" | null>(null);
  const [viewing, setViewing] = useState<WorkspaceItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (it.kind === "link" && it.url) window.open(it.url, "_blank");
    else if (it.kind === "file") downloadFile(`/api/workspace/${it.id}/download`, it.title);
    else setViewing(it);
  }

  return (
    <div>
      <PageHead
        title="My Docs"
        subtitle="Quick-access notes, links (paste your OneDrive links here) and files — pinned and searchable, so nothing gets lost."
        action={
          <div className="row" style={{ gap: 8, flex: "0 0 auto" }}>
            <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setAdding("note")}>
              <StickyNote size={14} /> Note
            </button>
            <button className="btn inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => setAdding("link")}>
              <LinkIcon size={14} /> Link
            </button>
            <button className="btn-primary inline-flex items-center gap-1.5" style={{ flex: "0 0 auto" }} onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Upload
            </button>
            <input ref={fileRef} type="file" hidden onChange={upload} />
          </div>
        }
      />

      <div className="card mb-4">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 3 }}>
            <label>Search</label>
            <input placeholder="Search title, notes, tags…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All</option>
              <option value="note">Notes</option>
              <option value="link">Links</option>
              <option value="file">Files</option>
            </select>
          </div>
        </div>
      </div>

      {items.loading ? (
        <Loading />
      ) : (items.data?.length ?? 0) === 0 ? (
        <Empty icon="📌" message="Nothing saved yet" hint="Pin an important link or note for quick access." />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
          {items.data!.map((it) => {
            const Icon = ICON[it.kind as keyof typeof ICON] ?? FileText;
            const mine = it.owner_id === user?.id;
            return (
              <div key={it.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="spread">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Icon size={16} className="flex-none text-brand-600" />
                    <button className="!border-0 !bg-transparent !p-0 truncate text-left font-semibold" onClick={() => open(it)}>
                      {it.title}
                    </button>
                  </span>
                  {it.pinned && <Pin size={13} className="flex-none text-brand-600" />}
                </div>
                {it.kind === "note" && it.body && (
                  <p className="muted line-clamp-3 text-sm" style={{ whiteSpace: "pre-wrap" }}>{it.body}</p>
                )}
                {it.kind === "link" && it.url && (
                  <span className="muted truncate text-xs">{it.url}</span>
                )}
                {it.kind === "file" && (
                  <span className="muted text-xs">{bytes(it.size_bytes)}</span>
                )}
                {it.tags && (
                  <div className="flex flex-wrap gap-1">
                    {it.tags.split(",").map((t) => (
                      <span key={t} className="badge">{t.trim()}</span>
                    ))}
                  </div>
                )}
                <div className="spread mt-auto pt-1">
                  <span className="muted inline-flex items-center gap-1 text-xs">
                    {it.shared && <Users size={11} />}
                    {!mine ? it.owner_name : it.shared ? "Shared" : ""}
                  </span>
                  <span className="flex flex-none items-center gap-1">
                    <button className="btn-sm" title="Open" onClick={() => open(it)}>
                      {it.kind === "file" ? <Download size={13} /> : <ExternalLink size={13} />}
                    </button>
                    {mine && (
                      <>
                        <button className="btn-sm" title={it.pinned ? "Unpin" : "Pin"} onClick={() => togglePin(it)}>
                          {it.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                        </button>
                        <button className="btn-sm btn-danger" title="Delete" onClick={() => remove(it)}>
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </span>
                </div>
              </div>
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
            {viewing.body || <span className="muted">No content.</span>}
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
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <Modal title={kind === "note" ? "New note" : "Save a link"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Title *</label>
          <input required value={form.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        {kind === "link" ? (
          <div className="field">
            <label>URL *</label>
            <input required placeholder="https://onedrive.com/…" value={form.url} onChange={(e) => set("url", e.target.value)} />
          </div>
        ) : (
          <div className="field">
            <label>Note</label>
            <textarea rows={6} value={form.body} onChange={(e) => set("body", e.target.value)} />
          </div>
        )}
        <div className="field">
          <label>Tags (comma-separated)</label>
          <input placeholder="finance, q2, urgent" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
        </div>
        <div className="row" style={{ gap: 18 }}>
          <label className="inline-flex items-center gap-2 text-sm font-medium" style={{ flex: "0 0 auto" }}>
            <input type="checkbox" checked={form.pinned} onChange={(e) => set("pinned", e.target.checked)} /> Pin
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-medium" style={{ flex: "0 0 auto" }}>
            <input type="checkbox" checked={form.shared} onChange={(e) => set("shared", e.target.checked)} /> Share with team
          </label>
        </div>
        <div className="row mt-3" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: "0 0 auto" }} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
