import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lazy, Suspense, useRef, useState } from "react";
import {
  Archive,
  Eye,
  File,
  FileText,
  Folder as FolderIcon,
  History,
  Home,
  Image,
  Lock,
  Share2,
  Sheet,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { api, apiUrl, downloadFile } from "../api/client";
import ShareControl from "../components/ShareControl";
import PdfThumb from "../components/PdfThumb";
import VersionsModal from "../components/VersionsModal";
import type { Asset, Folder } from "../api/types";
import { useFetch } from "../hooks/useApi";
import {
  AuthImage,
  ConfirmDialog,
  Empty,
  ListSkeleton,
  Modal,
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

function isVideo(name: string): boolean {
  return ["mp4", "webm", "mov"].includes(name.split(".").pop()?.toLowerCase() ?? "");
}

function isAudio(name: string): boolean {
  return ["mp3", "wav", "m4a", "ogg"].includes(name.split(".").pop()?.toLowerCase() ?? "");
}

function AssetPreviewModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { notify } = useToast();
  const path = `/api/assets/${asset.id}/preview`;
  return (
    <Modal title={`View — ${asset.name}`} maxWidth={960} onClose={onClose}>
      <div className="grid min-h-80 place-items-center border bg-muted/30 p-3">
        {isImage(asset.name) ? (
          <AuthImage path={path} alt={asset.name} width={900} height={600} style={{ maxWidth: "100%", maxHeight: "65vh", objectFit: "contain" }} />
        ) : isVideo(asset.name) ? (
          <video controls className="max-h-[65vh] max-w-full" src={apiUrl(path)} />
        ) : isAudio(asset.name) ? (
          <audio controls className="w-full max-w-xl" src={apiUrl(path)} />
        ) : (
          <iframe title={`Preview of ${asset.name}`} src={apiUrl(path)} sandbox="" className="h-[65vh] w-full border-0 bg-background" />
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" onClick={() => downloadFile(`/api/assets/${asset.id}/download`, asset.name).catch(() => notify("Download failed", "error"))}>
          Download
        </Button>
      </div>
    </Modal>
  );
}

function fileIcon(name: string): LucideIcon {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return Image;
  if (["pdf", "doc", "docx", "txt", "rtf"].includes(ext)) return FileText;
  if (["xls", "xlsx", "csv"].includes(ext)) return Sheet;
  if (["zip", "rar", "7z"].includes(ext)) return Archive;
  return File;
}

export default function AssetsPage() {
  const { notify } = useToast();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<Folder[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [viewing, setViewing] = useState<Asset | null>(null);
  const [versioning, setVersioning] = useState<Asset | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);
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
    try {
      await api("/api/assets/bulk", { method: "POST", body: { ids, action } });
      notify(`${action[0].toUpperCase()}${action.slice(1)} applied to ${ids.length} file(s).`);
      setSelected(new Set());
      assets.reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Bulk action failed", "error");
    }
  }

  async function deleteFolder(f: Folder) {
    await api(`/api/assets/folders/${f.id}`, { method: "DELETE" });
    notify("Folder deleted.");
    folders.reload();
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline"
              onClick={() => setNewFolderOpen(true)}
            >
              + Folder
            </Button>
            <Button type="button"
              onClick={() => fileRef.current?.click()}
            >
              Upload file
            </Button>
            <Input aria-label="Upload" ref={fileRef} type="file" hidden onChange={upload} />
          </div>
        }
      />

      {/* Breadcrumb */}
      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <Button type="button" variant="link" size="sm"
          onClick={() => goTo(-1)}
        >
          <Home data-icon="inline-start" aria-hidden="true" /> Home
        </Button>
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            <span className="text-muted-foreground">/</span>
            <Button type="button" variant="link" size="sm"
              onClick={() => goTo(i)}
            >
              {c.name}
            </Button>
          </span>
        ))}
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 border border-primary/20 bg-primary/10 px-4 py-2.5 text-sm">
          <strong>{selected.size} selected</strong>
          <span className="flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={() => bulk("share")}>
            <Share2 data-icon="inline-start" /> Share
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => bulk("unshare")}>
            <Lock data-icon="inline-start" /> Make private
          </Button>
          <Button type="button" variant="destructive" size="sm"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 data-icon="inline-start" /> Delete
          </Button>
        </div>
      )}

      <Card className="py-0">
        <CardContent className="p-0">
        {folders.loading || assets.loading ? (
          <div className="p-4">
            <ListSkeleton rows={6} />
          </div>
        ) : (folders.data?.length ?? 0) + (assets.data?.length ?? 0) === 0 ? (
          <Empty
            icon={<FolderIcon />}
            message="This folder is empty"
            hint="Create a sub-folder or upload a file to get started."
          />
        ) : (
           <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-9"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Client sharing</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {folders.data?.map((f) => (
                <TableRow key={f.id}>
                  <TableCell></TableCell>
                  <TableCell className="max-w-[32rem] whitespace-normal">
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 flex-none place-items-center bg-primary/10 text-lg text-foreground">
                        <FolderIcon aria-hidden="true" />
                      </span>
                       <span className="truncate font-semibold" title={f.name}>{f.name}</span>
                    </div>
                  </TableCell>
                   <TableCell><Badge variant="secondary">Folder</Badge></TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => open(f)}>Open ›</Button>
                      <Button type="button" variant="destructive" size="icon-sm"
                        title="Delete folder"
                        onClick={() => setDeletingFolder(f)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {assets.data?.map((a) => {
                const FileIcon = fileIcon(a.name);
                return (
                <TableRow key={a.id} data-state={selected.has(a.id) ? "selected" : undefined}>
                   <TableCell>
                    <Checkbox aria-label={`Select ${a.name}`}
                      checked={selected.has(a.id)}
                      onCheckedChange={() => toggle(a.id)}
                    />
                  </TableCell>
                   <TableCell className="max-w-[32rem] whitespace-normal">
                    <div className="flex items-center gap-3">
                      {isPdf(a.name) ? (
                        <PdfThumb url={`/api/assets/${a.id}/download`} size={40} />
                      ) : isImage(a.name) ? (
                        <AuthImage
                          path={`/api/assets/${a.id}/download`}
                          alt={a.name}
                          width={40}
                          height={40}
                          style={{ width: 40, height: 40, objectFit: "cover", flex: "none" }}
                        />
                      ) : (
                        <span className="grid size-10 flex-none place-items-center bg-primary/10 text-lg text-foreground">
                           <FileIcon aria-hidden="true" />
                        </span>
                      )}
                      <div className="min-w-0">
                         <div className="truncate font-medium" title={a.name}>{a.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {bytes(a.size_bytes)}
                          {a.version > 1 && ` · v${a.version}`}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {(a.name.split(".").pop() ?? "file").toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button type="button" size="sm" onClick={() => setViewing(a)} title={`View ${a.name}`}>
                        <Eye data-icon="inline-start" /> View
                      </Button>
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => setVersioning(a)}
                        title="Version history / upload new version"
                      >
                        <History data-icon="inline-start" /> v{a.version}
                      </Button>
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => downloadFile(`/api/assets/${a.id}/download`, a.name)}
                      >
                        Download
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
           </Table>
        )}
        </CardContent>
      </Card>

      {viewing && isPdf(viewing.name) && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 grid place-items-center bg-background/80" role="status" aria-live="polite">
              Loading document viewer…
            </div>
          }
        >
          <FlipbookModal
            url={`/api/assets/${viewing.id}/download`}
            name={viewing.name}
            onClose={() => setViewing(null)}
          />
        </Suspense>
      )}
      {viewing && !isPdf(viewing.name) && (
        <AssetPreviewModal asset={viewing} onClose={() => setViewing(null)} />
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
          onConfirm={createFolder}
          onClose={() => setNewFolderOpen(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete files"
          message={`Delete ${selected.size} file(s)? This can't be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => bulk("delete")}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {deletingFolder && (
        <ConfirmDialog
          title="Delete folder"
          message={`Delete "${deletingFolder.name}" and everything inside it? This can't be undone.`}
          confirmLabel="Delete folder"
          danger
          onConfirm={() => deleteFolder(deletingFolder)}
          onClose={() => setDeletingFolder(null)}
        />
      )}
    </div>
  );
}
