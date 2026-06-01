import { useRef, useState } from "react";
import { api, apiUrl } from "../api/client";
import type { Asset, Folder } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { Empty, Loading, PageHead, bytes, useToast } from "../components/ui";

export default function AssetsPage() {
  const { notify } = useToast();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<Folder[]>([]);
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

  async function newFolder() {
    const name = prompt("Folder name");
    if (!name) return;
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
            <button className="btn" style={{ flex: "0 0 auto" }} onClick={newFolder}>
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 6, justifyContent: "flex-start" }}>
          <a onClick={() => goTo(-1)} style={{ cursor: "pointer", flex: "0 0 auto" }}>
            Home
          </a>
          {crumbs.map((c, i) => (
            <span key={c.id} style={{ flex: "0 0 auto" }}>
              {" / "}
              <a onClick={() => goTo(i)} style={{ cursor: "pointer" }}>
                {c.name}
              </a>
            </span>
          ))}
        </div>
      </div>

      <div className="grid cols-4">
        {folders.data?.map((f) => (
          <div
            key={f.id}
            className="card"
            style={{ cursor: "pointer" }}
            onClick={() => open(f)}
          >
            <div style={{ fontSize: 30 }}>📁</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>{f.name}</div>
          </div>
        ))}
        {assets.data?.map((a) => (
          <div key={a.id} className="card">
            <div style={{ fontSize: 30 }}>📄</div>
            <div style={{ fontWeight: 600, marginTop: 6, wordBreak: "break-word" }}>
              {a.name}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {bytes(a.size_bytes)}
            </div>
            <a
              className="btn btn-sm"
              style={{ marginTop: 10, display: "inline-block" }}
              href={apiUrl(`/api/assets/${a.id}/download`)}
            >
              Download
            </a>
          </div>
        ))}
      </div>

      {folders.loading || assets.loading ? (
        <Loading />
      ) : (folders.data?.length ?? 0) + (assets.data?.length ?? 0) === 0 ? (
        <Empty message="This folder is empty. Create a sub-folder or upload a file." />
      ) : null}
    </div>
  );
}
