import { useRef, useState } from "react";
import { Camera, Download, Paperclip, X } from "lucide-react";
import { api, downloadFile } from "../api/client";
import type { Attachment } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { bytes, useToast } from "./ui";
import CameraCapture, { canUseLiveCamera } from "./CameraCapture";

/** Reusable file attachments list + uploader for any office-ops entity. */
export default function Attachments({
  entityType,
  entityId,
  compact,
  accept,
  capture,
  camera,
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
  /** Offer a live in-app viewfinder ("Take photo") alongside the file picker. */
  camera?: boolean;
  label?: string;
  heading?: string;
  onChanged?: () => void;
}) {
  const { notify } = useToast();
  const { data, reload } = useFetch<Attachment[]>(
    `/api/attachments/by/${entityType}/${entityId}`,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [shooting, setShooting] = useState(false);

  async function send(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    await api(`/api/attachments/by/${entityType}/${entityId}`, { method: "POST", form: fd });
    notify("Photo attached.");
    reload();
    onChanged?.();
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await send(file);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed", "error");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Live viewfinder where the browser allows it; the camera app otherwise. */
  function takePhoto() {
    if (canUseLiveCamera()) setShooting(true);
    else fileRef.current?.click();
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
        <span className="flex flex-none items-center gap-1.5">
          {camera && (
            <button
              className="btn-sm btn-primary inline-flex items-center gap-1"
              style={{ flex: "0 0 auto" }}
              onClick={takePhoto}
            >
              <Camera size={13} /> Take photo
            </button>
          )}
          <button className="btn-sm" style={{ flex: "0 0 auto" }} onClick={() => fileRef.current?.click()}>
            {label}
          </button>
        </span>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={accept}
          capture={capture}
          onChange={upload}
        />
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
      {shooting && (
        <CameraCapture
          onClose={() => setShooting(false)}
          onCapture={async (file) => {
            try {
              await send(file);
            } catch (err) {
              notify(err instanceof Error ? err.message : "Upload failed", "error");
              throw err; // keep the viewfinder open so the shot isn't lost
            }
          }}
        />
      )}
    </div>
  );
}
