import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRef, useState } from "react";
import { Camera, Download, Paperclip, X } from "lucide-react";
import { api, apiUrl, downloadFile } from "../api/client";
import type { Attachment } from "../api/types";
import { useFetch } from "../hooks/useApi";
import { bytes, ConfirmDialog, useToast } from "./ui";
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
  entityType:
    | "approval"
    | "ticket"
    | "task"
    | "task_item"
    | "idea"
    | "lost_found";
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
  const [pendingRemove, setPendingRemove] = useState<Attachment | null>(null);

  async function send(file: File, successMessage = "File attached.") {
    const fd = new FormData();
    fd.append("file", file);
    await api(`/api/attachments/by/${entityType}/${entityId}`, { method: "POST", form: fd });
    notify(successMessage);
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

  async function removeConfirmed() {
    if (!pendingRemove) return;
    try {
      await api(`/api/attachments/${pendingRemove.id}`, { method: "DELETE" });
      notify(`Removed ${pendingRemove.name}.`);
      setPendingRemove(null);
      reload();
      onChanged?.();
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Remove failed");
      notify(error.message, "error");
      throw error;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0 inline-flex items-center gap-1.5">
          <Paperclip data-icon="inline-start" /> {heading} {data?.length ? `(${data.length})` : ""}
        </h4>
        <span className="flex flex-none items-center gap-1.5">
          {camera && (
            <Button
              type="button"
              size="sm"
              onClick={takePhoto}
            >
              <Camera data-icon="inline-start" /> Take photo
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            {label}
          </Button>
        </span>
        <Input
          aria-label={`Upload ${heading.toLowerCase()}`}
          ref={fileRef}
          type="file"
          hidden
          accept={accept}
          capture={capture}
          onChange={upload}
        />
      </div>
      {!data || data.length === 0 ? (
        !compact && <p className="text-sm text-muted-foreground">No files attached.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {data.map((a) => {
            const isImage = (a.content_type ?? "").startsWith("image/");
            const href = apiUrl(`/api/attachments/${a.id}/download`);
            return (
            <div
              key={a.id}
              className="flex items-center justify-between gap-2 bg-muted px-2 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                {isImage ? (
                  // Inline thumbnail so a checker/reviewer sees the evidence
                  // without downloading. The session cookie authenticates the
                  // <img> request automatically (same-origin). Click to open full.
                  <a href={href} target="_blank" rel="noreferrer" className="flex-none">
                    <img
                      src={href}
                      alt={a.name}
                      loading="lazy"
                      className="h-12 w-12 rounded object-cover ring-1 ring-border"
                    />
                  </a>
                ) : null}
                <span className="truncate text-sm font-medium">{a.name}</span>
              </span>
              <span className="flex flex-none items-center gap-2">
                <span className="text-xs text-muted-foreground">{bytes(a.size_bytes)}</span>
                <Button type="button"
                  size="icon-sm"
                  variant="outline"
                  title="Download"
                  aria-label={`Download ${a.name}`}
                  onClick={() => downloadFile(`/api/attachments/${a.id}/download`, a.name)}
                >
                  <Download />
                </Button>
                <Button type="button"
                  size="icon-sm"
                  variant="destructive"
                  title="Remove"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setPendingRemove(a)}
                >
                  <X />
                </Button>
              </span>
            </div>
            );
          })}
        </div>
      )}
      {shooting && (
        <CameraCapture
          onClose={() => setShooting(false)}
          onCapture={async (file) => {
            try {
              await send(file, "Photo attached.");
            } catch (err) {
              notify(err instanceof Error ? err.message : "Upload failed", "error");
              throw err; // keep the viewfinder open so the shot isn't lost
            }
          }}
        />
      )}
      {pendingRemove && (
        <ConfirmDialog
          title="Remove attachment?"
          message={`Delete “${pendingRemove.name}”? This cannot be undone.`}
          confirmLabel="Remove"
          danger
          onConfirm={removeConfirmed}
          onClose={() => setPendingRemove(null)}
        />
      )}
    </div>
  );
}
