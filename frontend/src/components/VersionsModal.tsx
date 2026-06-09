import { useEffect, useRef, useState } from "react";
import { Download, History, Upload } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { DocVersion } from "../api/types";
import { Modal, bytes, useToast } from "./ui";

/**
 * Version history + "upload new version" for a shareable document. `base` is the
 * endpoint root (e.g. `/api/products/brochures/:id` or `/api/assets/:id`).
 * Replacing the file keeps the same share link / QR live.
 */
export default function VersionsModal({
  base,
  name,
  currentVersion,
  onClose,
  onReplaced,
}: {
  base: string;
  name: string;
  currentVersion: number;
  onClose: () => void;
  onReplaced: () => void;
}) {
  const { notify } = useToast();
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setVersions(await api<DocVersion[]>(`${base}/versions`));
  }
  useEffect(() => {
    load().catch(() => setVersions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api(`${base}/version`, { method: "POST", form });
      notify("New version uploaded — the share link stays the same.");
      onReplaced();
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Versions — ${name}`} onClose={onClose} maxWidth={520}>
      <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-slate-50 p-3">
        <div className="flex items-center gap-2 text-sm">
          <History size={16} className="text-brand-600" />
          Current version <strong>v{currentVersion}</strong>
        </div>
        <button
          className="btn-primary inline-flex items-center gap-1.5"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={14} /> Upload new version
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>

      {versions === null ? (
        <p className="muted">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="muted">No previous versions yet. v1 is the current file.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Size</th>
              <th>Replaced</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td className="font-semibold">v{v.version}</td>
                <td className="muted">{bytes(v.size_bytes)}</td>
                <td className="muted">
                  {new Date(v.created_at).toLocaleDateString()}
                </td>
                <td className="text-right">
                  <button
                    className="btn-sm inline-flex items-center gap-1.5"
                    onClick={() =>
                      downloadFile(
                        `${base}/versions/${v.version}/download`,
                        `${name}-v${v.version}`,
                      )
                    }
                  >
                    <Download size={14} /> Download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
