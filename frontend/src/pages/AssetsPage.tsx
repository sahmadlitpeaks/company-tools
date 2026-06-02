import { useRef, useState } from "react";
import { api, downloadFile } from "../api/client";
import type { Asset, Folder } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  Empty,
  ListSkeleton,
  PageHead,
  PromptModal,
  bytes,
  useToast,
} from "../components/ui";

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
  const fileRef = useRef<HTMLInputElement>(null);

  const folderQuery = folderId ? `?parent_id=${folderId}` : "";
  const assetQuery = folderId ? `?folder_id=${folderId}` : "";
  const folders = useFetch<Folder[]>(`/api/assets/folders${folderQuery}`);
  const assets = useFetch<Asset[]>(`/api/assets${assetQuery}`);

  function open(folder: Folder) {
    setCrumbs((c) => [...c, folder]);
    setFolderId(folder.id);
  }
  function goTo(index: number) {
    if (index < 0) {
      setCrumbs([]);
      setFolderId(null);
    } else {
      const next = crumbs.slice(0, index + 1);
      setCrumbs(next);
      setFolderId(next[next.length - 1].id);
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
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={upload}
            />
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
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {folders.data?.map((f) => (
                <tr
                  key={f.id}
                  className="cursor-pointer"
                  onClick={() => open(f)}
                >
                  <td className="font-semibold">
                    <span className="mr-2">📁</span>
                    {f.name}
                  </td>
                  <td className="muted">Folder</td>
                  <td className="muted">—</td>
                  <td className="text-right text-ink-muted">Open ›</td>
                </tr>
              ))}
              {assets.data?.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">
                    <span className="mr-2">{fileIcon(a.name)}</span>
                    {a.name}
                  </td>
                  <td className="muted uppercase text-xs">
                    {a.name.split(".").pop() ?? "file"}
                  </td>
                  <td className="muted">{bytes(a.size_bytes)}</td>
                  <td className="text-right">
                    <button
                      className="btn-sm"
                      onClick={() => downloadFile(`/api/assets/${a.id}/download`, a.name)}
                    >
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
