import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSurface,
} from "@/components/ui/table";
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setVersions(await api<DocVersion[]>(`${base}/versions`));
  }
  useEffect(() => {
    let cancelled = false;
    void api<DocVersion[]>(`${base}/versions`)
      .then((nextVersions) => {
        if (!cancelled) setVersions(nextVersions);
      })
      .catch(() => {
        if (!cancelled) setVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function upload(file: File) {
    setIsSubmitting(true);
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
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={`Versions — ${name}`} onClose={onClose} maxWidth={520}>
      <div className="mb-4 flex flex-col items-start justify-between gap-3 border border-border bg-muted p-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-sm">
          <History className="text-foreground" />
          Current version <strong>v{currentVersion}</strong>
        </div>
        <Button type="button"
          disabled={isSubmitting}
          onClick={() => fileRef.current?.click()}
        >
          <Upload data-icon="inline-start" /> Upload new version
        </Button>
        <Input aria-label="Target"
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
        <p className="text-muted-foreground">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="text-muted-foreground">No previous versions yet. v1 is the current file.</p>
      ) : (
        <TableSurface>
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead>Replaced</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-semibold">v{v.version}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">{bytes(v.size_bytes)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(v.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      downloadFile(
                        `${base}/versions/${v.version}/download`,
                        `${name}-v${v.version}`,
                      )
                    }
                  >
                    <Download data-icon="inline-start" /> Download
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          </Table>
        </TableSurface>
      )}
    </Modal>
  );
}
