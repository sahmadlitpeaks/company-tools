import { useRef } from "react";
import { Camera, Download, Paperclip, X } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { Attachment } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { bytes, useToast } from "./ui";

/** Reusable file attachments list + uploader for any office-ops entity. */
export default function Attachments({
  entityType,
  entityId,
  compact,
  accept,
  capture,
  withCamera,
  label = "+ Attach file",
  heading = "Attachments",
  onChanged,
}: {
  entityType: "approval" | "ticket" | "task" | "task_item";
  entityId: string;
  compact?: boolean;
  /** Restrict the picker, e.g. "image/*" for photo evidence. */
  accept?: string;
  /** On a phone, open the camera straight away instead of the file browser. */
  capture?: "environment" | "user";
  /**
   * Add a separate "Photo" button that opens the camera, keeping the ordinary
   * file picker too. Use this where a photo is common but not the only thing
   * people attach — forcing `capture` would block screenshots and PDFs.
   */
  withCamera?: boolean;
  label?: string;
  heading?: string;
  onChanged?: () => void;
}) {
  const { notify } = useToast();
  const { data, reload } = useFetch<Attachment[]>(
    `/api/attachments/by/${entityType}/${entityId}`,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api(`/api/attachments/by/${entityType}/${entityId}`, {
        method: "POST",
        form: fd,
      });
      notify("File attached.");
      reload();
      onChanged?.();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    e.target.value = "";
  }

  async function remove(id: string) {
    await api(`/api/attachments/${id}`, { method: "DELETE" });
    reload();
    onChanged?.();
  }

  return (
    <div>
      <div className="spread mb-2">
        <h4 className="m-0 inline-flex items-center gap-1.5">
          <Paperclip size={14} /> {heading} {data?.length ? `(${data.length})` : ""}
        </h4>
        {withCamera && (
          <button
            className="btn-sm inline-flex items-center gap-1"
            style={{ flex: "0 0 auto" }}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera size={13} /> Photo
          </button>
        )}
        <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => fileRef.current?.click()}>
          {label}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={accept}
          capture={capture}
          onChange={upload}
        />
        {withCamera && (
          <input
            ref={cameraRef}
            type="file"
            hidden
            accept="image/*"
            capture="environment"
            onChange={upload}
          />
        )}
      </div>
      {!data || data.length === 0 ? (
        !compact && <p className="muted text-sm">No files attached.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {data.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
              style={{ background: "var(--surface-2)" }}
            >
              <span className="truncate text-sm font-medium">{a.name}</span>
              <span className="flex flex-none items-center gap-2">
                <span className="muted text-xs">{bytes(a.size_bytes)}</span>
                <button
                  className="btn-sm"
                  style={{ flex: "0 0 auto" }}
                  title="Download"
                  onClick={() => downloadFile(`/api/attachments/${a.id}/download`, a.name)}
                >
                  <Download size={13} />
                </button>
                <button
                  className="btn-sm btn-danger"
                  style={{ flex: "0 0 auto" }}
                  title="Remove"
                  onClick={() => remove(a.id)}
                >
                  <X size={13} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
