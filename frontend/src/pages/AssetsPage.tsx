import { lazy, Suspense, useRef, useState } from "react";
import { BookOpen, History, Lock, Share2, Trash2 } from "lucide-react";
import { api, downloadFile } from "../api/client";
import ShareControl from "../components/ShareControl";
import PdfThumb from "../components/PdfThumb";
import VersionsModal from "../components/VersionsModal";
import type { Asset, Folder } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  AuthImage,
  Empty,
  ListSkeleton,
  PageHead,
  PromptModal,
  bytes,
  useToast,
} from "../components/ui";

const FlipbookModal = lazy(() => import("../components/FlipbookModal"));

function isPdf(name: string): boolean {
  return name.split(".").pop()?.toLowerCase() === "pdf";
}

function isImage(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
}

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc", "docx", "txt", "rtf"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["zip", "rar", "7z"].includes(ext)) return "🗜";
  return "📄";
}

export default function AssetsPage() {
  const { notify } = useToast();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<Folder[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [reading, setReading] = useState<Asset | null>(null);
  const [versioning, setVersioning] = useState<Asset | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const folderQuery = folderId ? `?parent_id=${folderId}` : "";
  const assetQuery = folderId ? `?folder_id=${folderId}` : "";
  const folders = useFetch<Folder[]>(`/api/assets/folders${folderQuery}`);
  const assets = useFetch<Asset[]>(`/api/assets${assetQuery}`);

  function open(folder: Folder) {
    setCrumbs((c) => [...c, folder]);
    setFolderId(folder.id);
    setSelected(new Set());
  }
  function goTo(index: number) {
    setSelected(new Set());
    if (index < 0) {
      setCrumbs([]);
      setFolderId(null);
    } else {
      const next = crumbs.slice(0, index + 1);
      setCrumbs(next);
      setFolderId(next[next.length - 1].id);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function bulk(action: "delete" | "share" | "unshare") {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === "delete" && !confirm(`Delete ${ids.length} file(s)?`)) return;
    try {
      await api("/api/assets/bulk", { method: "POST", body: { ids, action } });
      notify(`${action[0].toUpperCase()}${action.slice(1)} applied to ${ids.length} file(s).`);
      setSelected(new Set());
      assets.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Bulk action failed", "error");
    }
  }

  async function createFolder(name: string) {
    await api("/api/assets/folders", {
      method: "POST",
      body: { name, parent_id: folderId },
    });
    notify("Folder created.");
    folders.reload();
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    if (folderId) fd.append("folder_id", folderId);
    try {
      await api("/api/assets", { method: "POST", form: fd });
      notify(`Uploaded ${file.name}.`);
      assets.reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div>
      <PageHead
        title="Marketing Assets"
        subtitle="Organise campaign files in folders for easy team access."
        action={
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn"
              style={{ flex: "0 0 auto" }}
              onClick={() => setNewFolderOpen(true)}
            >
              + Folder
            </button>
            <button
              className="btn-primary"
              style={{ flex: "0 0 auto" }}
              onClick={() => fileRef.current?.click()}
            >
              Upload file
            </button>
            <input ref={fileRef} type="file" hidden onChange={upload} />
          </div>
        }
      />

      {/* Breadcrumb */}
      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <button
          className="!border-0 !bg-transparent !px-1.5 !py-0.5 font-medium text-brand-600 hover:underline"
          onClick={() => goTo(-1)}
        >
          🏠 Home
        </button>
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            <span className="text-ink-muted">/</span>
            <button
              className="!border-0 !bg-transparent !px-1.5 !py-0.5 font-medium text-brand-600 hover:underline"
              onClick={() => goTo(i)}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm">
          <strong>{selected.size} selected</strong>
          <span className="flex-1" />
          <button className="btn-sm inline-flex items-center gap-1.5" onClick={() => bulk("share")}>
            <Share2 size={14} /> Share
          </button>
          <button className="btn-sm inline-flex items-center gap-1.5" onClick={() => bulk("unshare")}>
            <Lock size={14} /> Make private
          </button>
          <button
            className="btn-sm btn-danger inline-flex items-center gap-1.5"
            onClick={() => bulk("delete")}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        {folders.loading || assets.loading ? (
          <div className="p-4">
            <ListSkeleton rows={6} />
          </div>
        ) : (folders.data?.length ?? 0) + (assets.data?.length ?? 0) === 0 ? (
          <Empty
            icon="📂"
            message="This folder is empty"
            hint="Create a sub-folder or upload a file to get started."
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>Name</th>
                <th>Type</th>
                <th>Client sharing</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {folders.data?.map((f) => (
                <tr key={f.id} className="cursor-pointer" onClick={() => open(f)}>
                  <td></td>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-amber-50 text-lg">
                        📁
                      </span>
                      <span className="font-semibold">{f.name}</span>
                    </div>
                  </td>
                  <td><span className="badge amber">Folder</span></td>
                  <td className="muted">—</td>
                  <td className="text-right font-medium text-brand-600">Open ›</td>
                </tr>
              ))}
              {assets.data?.map((a) => (
                <tr key={a.id} className={selected.has(a.id) ? "bg-brand-50/60" : ""}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      {isPdf(a.name) ? (
                        <PdfThumb url={`/api/assets/${a.id}/download`} size={40} />
                      ) : isImage(a.name) ? (
                        <AuthImage
                          path={`/api/assets/${a.id}/download`}
                          alt={a.name}
                          width={40}
                          height={40}
                          style={{ borderRadius: 8, objectFit: "cover", flex: "none" }}
                        />
                      ) : (
                        <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-slate-100 text-lg">
                          {fileIcon(a.name)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{a.name}</div>
                        <div className="muted text-xs">
                          {bytes(a.size_bytes)}
                          {a.version > 1 && ` · v${a.version}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge">
                      {(a.name.split(".").pop() ?? "file").toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <ShareControl
                      base={`/api/assets/${a.id}`}
                      name={a.name}
                      isPublic={a.is_public}
                      shareCode={a.share_code}
                      expiresAt={a.share_expires_at}
                      requireLead={a.share_require_lead}
                      hasPasscode={a.share_has_passcode}
                      onChange={() => assets.reload()}
                    />
                  </td>
                  <td className="text-right">
                    <div className="inline-flex items-center gap-2">
                      {isPdf(a.name) && (
                        <button
                          className="btn-sm inline-flex items-center gap-1.5"
                          onClick={() => setReading(a)}
                          title="Read as flipbook"
                        >
                          <BookOpen size={14} /> Read
                        </button>
                      )}
                      <button
                        className="btn-sm inline-flex items-center gap-1.5"
                        onClick={() => setVersioning(a)}
                        title="Version history / upload new version"
                      >
                        <History size={14} /> v{a.version}
                      </button>
                      <button
                        className="btn-sm"
                        onClick={() => downloadFile(`/api/assets/${a.id}/download`, a.name)}
                      >
                        Download
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {reading && (
        <Suspense fallback={null}>
          <FlipbookModal
            url={`/api/assets/${reading.id}/download`}
            name={reading.name}
            onClose={() => setReading(null)}
          />
        </Suspense>
      )}

      {versioning && (
        <VersionsModal
          base={`/api/assets/${versioning.id}`}
          name={versioning.name}
          currentVersion={versioning.version}
          onClose={() => setVersioning(null)}
          onReplaced={assets.reload}
        />
      )}

      {newFolderOpen && (
        <PromptModal
          title="New folder"
          label="Folder name"
          placeholder="e.g. Q2 Campaign"
          submitLabel="Create folder"
          onSubmit={createFolder}
          onClose={() => setNewFolderOpen(false)}
        />
      )}
    </div>
  );
}
